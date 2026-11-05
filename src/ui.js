import { emitKeypressEvents } from 'node:readline';
import path from 'node:path';
import { conversationGroups, eventContent } from './conversation.js';
import { clean, fit, wrap, width, border, renderConversation } from './conversation-view.js';
export { clean, fit, wrap };
import { TerminalInput } from './terminal-input.js';
import { commandCompletions, fileQuery } from './commands.js';
import { PROVIDERS } from './core/tools.js';
import { DEFAULT_CONFIG, validateConfig } from './core/config.js';
import { copyText, readClipboard } from './clipboard.js';
import { PRODUCT_NAME } from './core/identity.js';

const statusLabel = status => ({ queued: '排队', starting: '启动中', running: '运行中', waiting_approval: '等待审批', paused: '已暂停', cancelled: '已取消', failed: '失败', blocked: '阻塞', blocked_requirements: '等待澄清', blocked_technical: '技术阻塞', review_failed: '验收未通过', succeeded: '已完成', interrupted: '已中断' })[status] ?? status;
const ARCHIVABLE_WORKER_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'interrupted', 'paused', 'blocked_requirements', 'blocked_technical', 'review_failed']);
function labeledLines(label, value, columns) {
  const prefix = '  ' + fit(label, 4) + '  ';
  const continuation = ' '.repeat(Array.from(prefix).reduce((sum, char) => sum + width(char), 0));
  const available = Math.max(1, columns - width(prefix));
  return wrap(value, available).map((line, index) => fit((index ? continuation : prefix) + line, columns));
}
function compactLabeledLine(label, value, columns) {
  const prefix = '  ' + fit(label, 4) + '  ';
  return fit(prefix + tail(value, Math.max(4, columns - width(prefix))), columns);
}
function tail(text, columns) { let used = 0, result = ''; for (const c of Array.from(text).reverse()) { if (used + width(c) > columns) break; result = c + result; used += width(c); } return result; }
function sliceColumns(text, start, end) {
  let used = 0, result = '';
  for (const char of clean(text)) {
    const next = used + width(char);
    if (next > start && used < end) result += char;
    used = next;
  }
  return result;
}
function highlightColumns(text, start, end) {
  let used = 0, active = false, result = '';
  for (const char of text) {
    const next = used + width(char), selected = next > start && used < end;
    if (selected !== active) { result += selected ? '\x1b[7m' : '\x1b[0m'; active = selected; }
    result += char; used = next;
  }
  return result + (active ? '\x1b[0m' : '');
}
function filterSelection(text) {
  return clean(text).split('\n').map(line => line
    .replace(/^[╭├]─\s*/, '')
    .replace(/^│\s?/, '')
    .replace(/\s*─*[╮┤]$/, '')
    .replace(/\s*│$/, '')
  ).filter(line => !/^[\s╭╮╰╯─│├┤┬┴┼]+$/u.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export class TerminalUI {
  constructor(service, options = {}) {
    this.service = service; this.options = options; this.screen = 'manager'; this.workerPanel = 'chat'; this.panel = 'manager'; this.selected = 0; this.inputValue = ''; this.cursor = 0; this.inputSelection = null; this.preview = ''; this.filePath = ''; this.diffMode = 'task'; this.notice = ''; this.history = []; this.historyIndex = 0; this.historyDraft = ''; this.previewVersion = 0;
    this.expandedActors = new Set(); this.expandedGroups = new Set(); this.collapsedGroups = new Set();
    this.workerFocus = 'list'; this.scrollViews = new Map();
    this.completionIndex = 0; this.completionInput = ''; this.fileCompletionVersion = 0;
    this.skillCompletion = null; this.skillCompletionPending = null; this.skillCompletionVersion = 0;
    this.settings = { ...DEFAULT_CONFIG, ...service.config, ...options.settings }; this.settingsDraft = null; this.settingsIndex = 0; this.settingsEditing = null;
    this.selection = null; this.lastFrameLines = []; this.lastSize = { columns: 80, rows: 24 }; this.lastConversationView = null;
    this.selectionAutoTimer = null; this.selectionEdge = 0; this.selectionPointer = null; this.renderDelay = 50;
    this.showArchivedOnce = false;
    this.projectScroll = 0;
   
  }
  get allWorkers() { return Object.values(this.service.state.workers); }
  get workers() {
    const workers = this.allWorkers;
    return this.showArchivedOnce ? workers : workers.filter(worker => !worker.archivedAt);
  }
  get worker() { return this.workers[this.selected]; }
  get input() { return this.inputValue; }
  set input(value) { this.inputValue = String(value ?? ''); this.cursor = this.inputCharacters.length; this.inputSelection = null; }
  get inputCharacters() { return Array.from(this.inputValue); }
  setInput(value, cursor = Array.from(String(value ?? '')).length) {
    this.inputValue = String(value ?? '');
    this.cursor = Math.max(0, Math.min(this.inputCharacters.length, cursor));
    this.inputSelection = null;
  }
  inputSelectionRange() {
    if (!this.inputSelection) return null;
    const anchor = Math.max(0, Math.min(this.inputCharacters.length, this.inputSelection.anchor));
    const focus = Math.max(0, Math.min(this.inputCharacters.length, this.inputSelection.focus));
    return anchor === focus ? null : { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }
  selectedInputText() {
    const range = this.inputSelectionRange();
    return range ? this.inputCharacters.slice(range.start, range.end).join('') : '';
  }
  clearInputSelection() { this.inputSelection = null; }
  insertInput(value) {
    const text = String(value ?? '').replace(/\r\n?/g, '\n');
    const chars = this.inputCharacters;
    const insertion = Array.from(text);
    const range = this.inputSelectionRange();
    if (range) {
      chars.splice(range.start, range.end - range.start);
      this.cursor = range.start;
      this.inputSelection = null;
    }
    this.cursor = Math.max(0, Math.min(chars.length, this.cursor));
    chars.splice(this.cursor, 0, ...insertion);
    this.inputValue = chars.join('');
    this.cursor += insertion.length;
  }
  insertNewline() {
    this.insertInput('\n');
    this.notice = '';
    this.historyIndex = this.history.length;
    this.historyDraft = '';
    this.render();
  }
  insertPaste(value) {
    const text = clean(String(value ?? '')).replace(/\r\n?/g, '\n');
    if (!text) return;
    this.insertInput(text);
    this.notice = `已粘贴 ${Array.from(text).length} 字符`;
    this.historyIndex = this.history.length;
    this.historyDraft = '';
    this.render();
  }
  backspaceInput() {
    const chars = this.inputCharacters;
    const range = this.inputSelectionRange();
    if (range) {
      chars.splice(range.start, range.end - range.start);
      this.inputValue = chars.join('');
      this.cursor = range.start;
      this.inputSelection = null;
      return;
    }
    this.cursor = Math.max(0, Math.min(chars.length, this.cursor));
    if (!this.cursor) return;
    chars.splice(this.cursor - 1, 1);
    this.inputValue = chars.join('');
    this.cursor--;
  }
  deleteInput() {
    const chars = this.inputCharacters;
    const range = this.inputSelectionRange();
    if (range) {
      chars.splice(range.start, range.end - range.start);
      this.inputValue = chars.join('');
      this.cursor = range.start;
      this.inputSelection = null;
      return;
    }
    this.cursor = Math.max(0, Math.min(chars.length, this.cursor));
    if (this.cursor >= chars.length) return;
    chars.splice(this.cursor, 1);
    this.inputValue = chars.join('');
  }
  moveInputCursor(delta, extend = false) {
    const max = this.inputCharacters.length;
    if (extend) {
      if (!this.inputSelection) this.inputSelection = { anchor: this.cursor, focus: this.cursor };
      this.cursor = Math.max(0, Math.min(max, this.cursor + delta));
      this.inputSelection.focus = this.cursor;
      if (this.inputSelection.anchor === this.cursor) this.inputSelection = null;
      return;
    }
    const range = this.inputSelectionRange();
    if (range) {
      this.cursor = delta < 0 ? range.start : range.end;
      this.inputSelection = null;
      return;
    }
    this.cursor = Math.max(0, Math.min(max, this.cursor + delta));
  }
  get conversationActor() { return this.panel === 'manager' ? 'manager' : this.panel === 'chat' ? this.worker?.id : undefined; }
  get completion() {
    if (this.completionInput !== this.input) { this.completionInput = this.input; this.completionIndex = 0; this.completionNavigated = false; }
    const query = fileQuery(this.input), fileKey = query ? this.worker?.id + ':' + query.directory : null;
    const files = this.fileCompletion?.key === fileKey ? this.fileCompletion : null;
    const result = commandCompletions(this.input, {
      worker: this.worker, workers: this.workers, pipelines: this.service.state.pipelines,
      approvals: this.service.approvals ? [...this.service.approvals.values()] : this.service.state.approvals,
      questions: this.service.questions ? [...this.service.questions.values()] : this.service.state.questions,
      groups: /^\/(?:expand|collapse)\s/.test(this.input) && this.conversationActor ? conversationGroups(this.service.store.history(this.conversationActor)).filter(g => g.kind === 'background') : [],
      files: files?.entries, fileHint: query ? !this.worker?.workspace ? '需先选择已有工作区的 worker' : files?.error ?? (files ? '' : '正在读取目录…') : '',
      skills: this.skillCompletion?.actor === (this.conversationActor || 'manager') ? this.skillCompletion.entries : [],
      skillHint: this.skillCompletion?.error,
      projects: this.service.projects ?? [{ code: '-', root: this.service.git?.root ?? '', active: true }]
    });
    this.completionIndex = Math.min(this.completionIndex, Math.max(0, result.items.length - 1));
    return { ...result, active: this.input.startsWith('/') && this.dismissedCompletion !== this.input, open: result.items.length > 0 && this.dismissedCompletion !== this.input };
  }
  async loadCompletionFiles() {
    const query = fileQuery(this.input), worker = this.worker;
    if (!query || !worker?.workspace) return;
    const key = worker.id + ':' + query.directory;
    if (this.fileCompletion?.key === key && Date.now() - this.fileCompletion.time < 1000) return;
    if (this.fileCompletionPending?.key === key) return this.fileCompletionPending.promise;
    const version = ++this.fileCompletionVersion;
    const promise = (async () => {
      let entries, error;
      try {
        entries = await this.service.git.files(worker, query.directory);
        if (!Array.isArray(entries)) { entries = []; error = '请输入目录或文件相对路径'; }
        entries.sort((a, b) => Number(Boolean(b.directory)) - Number(Boolean(a.directory)) || a.name.localeCompare(b.name));
      } catch { entries = []; error = '目录不可用'; }
      if (version !== this.fileCompletionVersion || this.worker?.id !== worker.id || fileQuery(this.input)?.directory !== query.directory) return;
      this.fileCompletion = { key, entries, error, time: Date.now() }; this.render();
    })();
    this.fileCompletionPending = { key, promise };
    try { await promise; } finally { if (this.fileCompletionPending?.promise === promise) this.fileCompletionPending = null; }
  }
  async loadSkillCompletions() {
    const match = /^(.*?)\$([^\s]*)$/s.exec(this.input);
    if (!match || typeof this.service.listSkills !== 'function') return;
    const actor = this.conversationActor || 'manager';
    if (this.skillCompletion?.actor === actor && Date.now() - this.skillCompletion.time < 5000) return;
    if (this.skillCompletionPending?.actor === actor) return this.skillCompletionPending.promise;
    const version = ++this.skillCompletionVersion;
    const promise = (async () => {
      let entries = [], error = '';
      try {
        const result = await this.service.listSkills(actor, false);
        const groups = result.skills?.data ?? result.data ?? [];
        entries = groups.flatMap(entry => entry.skills ?? []);
      } catch (caught) {
        error = caught.message;
      }
      if (version !== this.skillCompletionVersion || (this.conversationActor || 'manager') !== actor) return;
      this.skillCompletion = { actor, entries, error, time: Date.now() };
      this.render();
    })();
    this.skillCompletionPending = { actor, promise };
    try { await promise; } finally {
      if (this.skillCompletionPending?.promise === promise) this.skillCompletionPending = null;
    }
  }
  async fillCompletion() {
    const item = this.completion.items[this.completionIndex];
    if (!item) return;
    this.input = item.value; this.notice = '';
    this.historyIndex = this.history.length; this.historyDraft = '';
    this.dismissedCompletion = this.input.endsWith(' ') || (fileQuery(this.input) && this.input.endsWith('/')) ? undefined : this.input;
    this.render(); await this.loadCompletionFiles();
  }
  inputPresentation(columns, maxRows = Number.POSITIVE_INFINITY) {
    const completion = this.completion;
    const length = text => Array.from(text).reduce((sum, char) => sum + width(char), 0);
    const raw = clean(this.input).replace(/\r\n?/g, '\n');
    const chars = Array.from(raw), cursorIndex = Math.max(0, Math.min(chars.length, this.cursor));
    const lineWidth = Math.max(1, columns - 2);
    const ranges = [];
    let start = 0, used = 0;
    for (let index = 0; index < chars.length; index++) {
      if (chars[index] === '\n') {
        ranges.push({ start, end: index, newlineAt: index });
        start = index + 1; used = 0;
        continue;
      }
      const size = width(chars[index]);
      if (index > start && used + size > lineWidth) {
        ranges.push({ start, end: index, newlineAt: null });
        start = index; used = 0;
      }
      used += size;
    }
    ranges.push({ start, end: chars.length, newlineAt: null });

    let cursorLine = ranges.length - 1;
    for (let index = 0; index < ranges.length; index++) {
      const range = ranges[index];
      if (cursorIndex < range.end || (cursorIndex === range.end && range.newlineAt === range.end)) {
        cursorLine = index; break;
      }
    }
    const rowLimit = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : ranges.length;
    const windowStart = Math.max(0, Math.min(cursorLine - Math.floor(rowLimit / 2), ranges.length - rowLimit));
    const visible = ranges.slice(windowStart, windowStart + rowLimit);

    let ghost = '', note = '';
    if (completion.open) {
      const item = completion.items[this.completionIndex];
      const normalize = text => text.replaceAll('\\', '/').replace(/^(\S+)\s+/, '$1 ');
      const prefix = normalize(this.input), candidate = normalize(item.value);
      if (candidate.toLowerCase().startsWith(prefix.toLowerCase())) ghost = candidate.slice(prefix.length);
      note = `  [${this.completionIndex + 1}/${completion.items.length}] ${item.description} · Tab 填入 · ↑↓ 切换 · Esc 收起`;
    } else if (completion.active) {
      const command = completion.command;
      const argument = /^\/\S+\s+(.*)$/s.exec(this.input)?.[1];
      if (command?.usage && argument === '') ghost = command.usage;
      else if (command?.name === 'answer' && /^\S+\s+$/.test(argument ?? '')) ghost = '答复';
      note = '  · ' + completion.hint;
    } else if (!this.input) ghost = '输入消息，或 / 查看命令';

    const selection = this.inputSelectionRange();
    const lines = visible.map((range, visibleIndex) => {
      const lineIndex = windowStart + visibleIndex;
      const prefix = lineIndex === 0 ? '> ' : '  ';
      const text = chars.slice(range.start, range.end).join('');
      let cursorColumn = null;
      if (lineIndex === cursorLine) cursorColumn = 2 + length(chars.slice(range.start, cursorIndex).join(''));
      let highlightStart = null, highlightEnd = null;
      if (selection) {
        const selectedStart = Math.max(selection.start, range.start);
        const selectedEnd = Math.min(selection.end, range.end);
        if (selectedStart < selectedEnd) {
          highlightStart = 2 + length(chars.slice(range.start, selectedStart).join(''));
          highlightEnd = 2 + length(chars.slice(range.start, selectedEnd).join(''));
        }
      }
      let lineGhost = '', lineNote = '';
      if (lineIndex === ranges.length - 1) {
        let remaining = Math.max(0, lineWidth - length(text));
        lineGhost = fit(ghost, remaining).trimEnd(); remaining -= length(lineGhost);
        lineNote = fit(note, remaining).trimEnd();
      }
      const plain = fit(prefix + text + lineGhost + lineNote, columns);
      const styled = prefix + text + (lineGhost ? '\x1b[90m' + lineGhost + '\x1b[0m' : '') + (lineNote ? '\x1b[2;90m' + lineNote + '\x1b[0m' : '');
      return { plain, styled, highlightStart, highlightEnd, cursorColumn, text };
    });
    const cursorVisibleLine = Math.max(0, cursorLine - windowStart);
    const cursorLineData = lines[cursorVisibleLine];
    return {
      lines,
      cursorRow: cursorVisibleLine,
      cursor: Math.min(columns, (cursorLineData?.cursorColumn ?? 2) + 1),
      ghost, note,
      plain: lines[0]?.plain ?? fit('> ', columns),
      styled: lines[0]?.styled ?? fit('> ', columns)
    };
  }

  settingsFieldDefs() {
    const draft = this.settingsDraft ?? this.settings;
    return [
      { key: 'manager', label: 'Manager 载体', type: 'provider', value: draft.manager },
      { key: 'managerModel', label: 'Manager 模型', type: 'text', value: draft.managerModel },
      { key: 'managerEffort', label: 'Manager effort', type: 'text', value: draft.managerEffort },
      { key: 'managerPrompt', label: 'Manager 提示词', type: 'text', value: draft.managerPrompt },
      { key: 'worker', label: 'Worker 载体', type: 'provider', value: draft.worker },
      { key: 'workerModel', label: 'Worker 模型', type: 'text', value: draft.workerModel },
      { key: 'workerEffort', label: 'Worker effort', type: 'text', value: draft.workerEffort },
      { key: 'workerPrompt', label: 'Worker 提示词', type: 'text', value: draft.workerPrompt },
      { key: 'codexApprovals', label: 'Codex 审批', type: 'toggle', value: draft.codexApprovals === 'user' ? '手动审批' : '自动审批' },
      { key: 'maxWorkers', label: '最大并发', type: 'number', value: String(draft.maxWorkers) },
      { key: 'silenceMs', label: '静默阈值', type: 'number', value: `${Math.round(draft.silenceMs / 60_000)} 分钟` },
      { key: 'mouseSelection', label: '鼠标拖选', type: 'toggle', value: draft.mouseSelection === 'app' ? '应用层（Ctrl+C 复制）' : '原生' },
      { key: 'showShortcutHints', label: '快捷键提示', type: 'toggle', value: draft.showShortcutHints ? '显示' : '隐藏' }
    ];
  }
  settingsFields() {
    return this.settingsFieldDefs().map(field => [
      field.label,
      field.type === 'text' && this.settingsEditing === field.key ? (field.value ?? '') + '▌' : field.type === 'text' ? field.value || '（空）' : field.value
    ]);
  }
  settingsView(columns, height) {
    if (!this.settingsDraft) this.settingsDraft = { ...this.settings };
    const fields = this.settingsFieldDefs();
    const fieldHeight = Math.max(1, height - 3);
    const first = Math.max(0, Math.min(this.settingsIndex - fieldHeight + 1, fields.length - fieldHeight));
    const lines = [border('设置 · 保存后重启生效', columns)];
    const add = text => lines.push('│ ' + fit(text, columns - 4) + ' │');
    fields.slice(first, first + fieldHeight).forEach((field, offset) => {
      const index = first + offset;
      const value = field.type === 'text' && this.settingsEditing === field.key ? (field.value ?? '') + '▌' : field.type === 'text' ? field.value || '（空）' : field.value;
      add(`${index === this.settingsIndex ? '▶' : ' '} ${fit(field.label, 18)} ${value}`);
    });
    add('');
    add('↑↓ 选择 · ←→ 修改 · Enter 编辑/保存 · Ctrl+J 换行 · Ctrl+S 保存 · Esc 取消');
    while (lines.length < height - 1) add('');
    if (height > 0) lines.push(border('', columns, '╰', '╯'));
    return lines.slice(0, height);
  }
  async saveSettings() {
    try {
      validateConfig(this.settingsDraft);
      if (typeof this.options.saveSettings !== 'function') throw new Error('设置持久化不可用');
      const saved = await this.options.saveSettings({ ...this.settingsDraft });
      this.settings = { ...(saved ?? this.settingsDraft) };
      this.settingsDraft = null; this.settingsEditing = null; this.panel = 'manager'; this.screen = 'manager';
      this.notice = `设置已保存，重启 ${PRODUCT_NAME} 后生效`;
    } catch (error) {
      this.notice = '保存设置失败：' + error.message;
    }
    this.render();
  }
  async settingsKey(text, key = {}) {
    if (!this.settingsDraft) this.settingsDraft = { ...this.settings };
    const fields = this.settingsFieldDefs(), count = fields.length;
    if (this.settingsEditing) {
      const field = fields.find(item => item.key === this.settingsEditing);
      if (key.ctrl && key.name === 's') { this.settingsEditing = null; return this.saveSettings(); }
      if (key.name === 'escape') { this.settingsEditing = null; this.notice = '已取消字段编辑'; this.render(); return; }
      if (key.name === 'return') { this.settingsEditing = null; this.notice = '字段已修改 · Ctrl+S 保存'; this.render(); return; }
      if (key.ctrl && (key.name === 'j' || key.name === 'return')) { this.settingsDraft[field.key] = (this.settingsDraft[field.key] ?? '') + '\n'; this.render(); return; }
      if (key.name === 'backspace') { this.settingsDraft[field.key] = Array.from(this.settingsDraft[field.key] ?? '').slice(0, -1).join(''); this.render(); return; }
      if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) {
        this.settingsDraft[field.key] = (this.settingsDraft[field.key] ?? '') + clean(text).replace(/[\r\n]/g, ' ');
        this.render();
      }
      return;
    }
    if (key.ctrl && key.name === 's') return this.saveSettings();
    if (key.name === 'escape') {
      this.settingsDraft = null; this.settingsEditing = null; this.panel = 'manager'; this.screen = 'manager';
      this.notice = '已取消设置修改'; this.render(); return;
    }
    if (key.name === 'return') {
      const field = fields[this.settingsIndex];
      if (field?.type === 'text') {
        this.settingsEditing = field.key; this.notice = `编辑 ${field.label} · Enter 完成`; this.render(); return;
      }
      return this.saveSettings();
    }
    if (['up', 'down'].includes(key.name)) {
      this.settingsIndex = (this.settingsIndex + (key.name === 'up' ? count - 1 : 1)) % count;
      this.render(); return;
    }
    if (!['left', 'right'].includes(key.name)) return;
    const step = key.name === 'left' ? -1 : 1;
    const field = fields[this.settingsIndex];
    if (field.type === 'provider') {
      const index = PROVIDERS.indexOf(this.settingsDraft[field.key]);
      this.settingsDraft[field.key] = PROVIDERS[(index + step + PROVIDERS.length) % PROVIDERS.length];
    } else if (field.key === 'codexApprovals') {
      this.settingsDraft.codexApprovals = this.settingsDraft.codexApprovals === 'auto_review' ? 'user' : 'auto_review';
    } else if (field.key === 'maxWorkers') {
      this.settingsDraft.maxWorkers = Math.max(1, Math.min(32, Number(this.settingsDraft.maxWorkers) + step));
    } else if (field.key === 'silenceMs') {
      const minutes = Math.max(1, Math.min(1440, Math.round(Number(this.settingsDraft.silenceMs) / 60_000) + step));
      this.settingsDraft.silenceMs = minutes * 60_000;
    } else if (field.key === 'mouseSelection') {
      this.settingsDraft.mouseSelection = this.settingsDraft.mouseSelection === 'app' ? 'native' : 'app';
    } else if (field.key === 'showShortcutHints') {
      this.settingsDraft.showShortcutHints = !this.settingsDraft.showShortcutHints;
    }
    this.notice = '';
    this.render();
  }
  get scrollKey() { return `${this.panel}:${this.panel === 'manager' ? 'manager' : this.worker?.id ?? ''}:${this.panel === 'files' ? this.filePath : this.panel === 'git' ? this.diffMode : this.panel === 'request' ? this.requestId : ''}`; }
  get scrollState() {
    if (!this.scrollViews.has(this.scrollKey)) this.scrollViews.set(this.scrollKey, { top: null, total: 0, height: 1 });
    return this.scrollViews.get(this.scrollKey);
  }
  bottomPadding() {
    const height = this.scrollState.height;
    return Math.min(12, Math.max(3, Math.floor(height / 3)));
  }
  scrollBy(delta) {
    const state = this.scrollState, normalMax = Math.max(0, state.total - state.height);
    const max = normalMax + this.bottomPadding();
    const top = Math.max(0, Math.min(max, (state.top ?? normalMax) + delta));
    state.top = delta > 0 && top === normalMax ? null : top;
  }
  scrollWheel(delta) {
    this.scrollBy(delta);
    this.render();
  }
  scrollTo(position) { this.scrollState.top = position === 'top' ? 0 : null; }
  clearSelection() {
    clearInterval(this.selectionAutoTimer); this.selectionAutoTimer = null; this.selectionEdge = 0; this.selectionPointer = null;
    this.selection = null;
  }
  stopSelectionAutoScroll() {
    clearInterval(this.selectionAutoTimer); this.selectionAutoTimer = null; this.selectionEdge = 0;
  }
  scrollHint() {
    const state = this.scrollState;
    const normalMax = Math.max(0, state.total - state.height);
    const top = Math.min(normalMax + this.bottomPadding(), state.top ?? normalMax);
    const padding = Math.max(0, top - normalMax);
    return `${state.total ? Math.min(state.total, top + 1) : 0}–${Math.min(state.total, top + state.height)}/${state.total}${padding ? ` · 底部留白 ${padding} 行` : ''} · ${state.top === null ? '跟随最新' : '历史 · End 回到底部'}`;
  }
  foldDetails(expand, number = 'all') {
    const actor = this.conversationActor;
    if (!actor) throw new Error('请先打开 Manager 或 worker 对话。');
    const groups = conversationGroups(this.service.store.history(actor)).filter(group => group.kind === 'background');
    if (number === 'all' || !number) {
      if (expand) this.expandedActors.add(actor); else this.expandedActors.delete(actor);
      for (const keys of [this.expandedGroups, this.collapsedGroups]) for (const key of keys) if (key.startsWith(actor + ':')) keys.delete(key);
    } else {
      const group = /^[1-9]\d*$/.test(number) ? groups[Number(number) - 1] : undefined;
      if (!group) throw new Error('后台过程组号不存在；使用 /expand all 或 /collapse all。');
      const key = actor + ':' + group.id;
      if (expand) { this.expandedGroups.add(key); this.collapsedGroups.delete(key); }
      else { this.collapsedGroups.add(key); this.expandedGroups.delete(key); }
    }
  }
  async start() {
    if (!this.options.virtualTerminal && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('TUI requires an interactive terminal for messages and native CLI approvals.');
    this.virtualSize = this.options.virtualSize ?? { columns: 100, rows: 30 };
    this.terminalInput = new TerminalInput(delta => this.scrollWheel(delta), event => this.handleMouse(event), text => this.insertPaste(text));
    emitKeypressEvents(this.terminalInput, { escapeCodeTimeout: 30 }); this.onData = data => this.terminalInput.write(data);
    if (!this.options.virtualTerminal) {
      process.stdin.setRawMode(true); process.stdin.on('data', this.onData); process.stdin.resume();
    }
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1000l\x1b[?1003l' + (this.settings.mouseSelection === 'app' ? '\x1b[?1002h\x1b[?1006h' : '\x1b[?1002l\x1b[?1006l'));
    this.onKey = (text, key) => this.key(text, key).catch(error => { this.notice = error.message; this.render(); });
    this.onChange = () => { if (this.selection && !this.selection.dragging) this.clearSelection(); this.scheduleRender(); }; this.onResize = () => { this.clearSelection(); this.render(); };
    this.terminalInput.on('keypress', this.onKey);
    if (!this.options.virtualTerminal) process.stdout.on('resize', this.onResize);
    this.service.on('change', this.onChange); this.service.on('activity', this.onChange);
    this.scheduleRender();
  }
  feed(data) { this.terminalInput?.write(data); }
  resize(columns, rows) {
    this.virtualSize = { columns: Math.max(24, columns), rows: Math.max(12, rows) };
    this.clearSelection();
    this.render();
  }
  scheduleRender(delay = 50) {
    if (this.stopped || (this.renderTimer && delay >= this.renderDelay)) return;
    clearTimeout(this.renderTimer);
    this.renderDelay = delay;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.renderDelay = 50; this.render(); }, delay);
  }
  async showPanel(panel) {
    this.panel = panel; this.screen = panel === 'manager' ? 'manager' : 'workers';
    if (panel === 'manager') this.showArchivedOnce = false;
    if (this.screen === 'workers') this.workerPanel = panel;
    await this.refresh();
  }
  async switchScreen() {
    await this.showPanel(this.screen === 'manager' ? this.workerPanel : 'manager');
  }
  async switchProject(selector) {
    if (typeof this.service.switchProject !== 'function') throw new Error('This session supports only one project');
    const project = await this.service.switchProject(selector);
    this.settings = { ...DEFAULT_CONFIG, ...this.service.config };
    this.selected = 0; this.showArchivedOnce = false;
    this.history = []; this.historyIndex = 0; this.historyDraft = '';
    this.scrollViews.clear(); this.expandedActors.clear(); this.expandedGroups.clear(); this.collapsedGroups.clear();
    const active = (this.service.projects ?? []).findIndex(item => item.active);
    this.projectScroll = Math.max(0, Math.min(active - 1, (this.service.projects?.length ?? 1) - 3));
    this.panel = 'manager'; this.screen = 'manager';
    this.notice = `当前项目 -[${project.code}] ${project.root}`;
    this.render();
  }
  async quoteMessage(args) {
    const match = /^(?:([^:\s]+):)?#?(\d+)\s+([\s\S]+)$/.exec(String(args ?? '').trim());
    if (!match) throw new Error('Usage: /quote [actor:]#seq 指令');
    const actor = match[1] || (this.screen === 'workers' && this.worker ? this.worker.id : 'manager');
    const seq = Number(match[2]);
    const instruction = match[3].trim();
    if (!instruction) throw new Error('Usage: /quote [actor:]#seq 指令');
    const event = await this.service.conversationEvent(actor, seq);
    if (!event) throw new Error(`No event #${seq} for ${actor}`);
    const text = String(eventContent(event)).trim();
    if (!text) throw new Error('Quoted event has no text content');
    const project = (this.service.projects ?? []).find(item => item.active)?.code ?? '';
    const role = event.data.role ?? event.type;
    const quote = { project, actor, seq, role, time: event.time, text };
    const quoted = text.split('\n').map(line => '> ' + line).join('\n');
    const message = `> 引用 ${actor} · #${seq} · ${role}${event.time ? ' · ' + event.time : ''}\n${quoted}\n\n${instruction}`;
    await this.service.sendManagerMessage(message, false, [quote]);
    this.panel = 'manager'; this.screen = 'manager';
    this.notice = `已引用 ${actor} #${seq} 并发送给 Manager`;
    this.scrollTo('bottom'); this.render();
  }
  navigateHistory(direction) {
    if (!this.history.length) return;
    if (this.historyIndex >= this.history.length) this.historyDraft = this.input;
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
    this.input = this.historyIndex === this.history.length ? this.historyDraft : this.history[this.historyIndex];
    this.notice = '';
  }
  async key(text, key = {}) {
    if (this.stopped) return;
    if ((key.meta || key.alt) && ['up', 'down'].includes(key.name)) {
      const count = this.service.projects?.length ?? 1;
      this.projectScroll = Math.max(0, Math.min(this.projectScroll + (key.name === 'up' ? -1 : 1), Math.max(0, count - 3)));
      this.render(); return;
    }
    if (key.ctrl && key.name === 'tab') {
      await this.switchScreen();
      this.render();
      return;
    }
    if (key.ctrl && key.name === 'a' && this.panel !== 'settings') {
      this.clearSelection();
      if (this.input) {
        this.inputSelection = { anchor: 0, focus: this.inputCharacters.length };
        this.cursor = this.inputCharacters.length;
        this.notice = '已全选输入框内容';
      }
      this.render();
      return;
    }
    if (key.ctrl && key.name === 'q') {
      const mouseSelected = this.settings.mouseSelection === 'app' ? filterSelection(this.selectedText()) : '';
      const selected = mouseSelected || this.selectedInputText();
      if (selected) {
        this.insertInput(selected.split('\n').map(line => '> ' + line).join('\n') + '\n\n');
        this.clearSelection(); this.clearInputSelection();
        this.notice = '已插入引用，输入要补充的消息后按 Enter 发送';
        this.historyIndex = this.history.length; this.historyDraft = '';
        this.render();
      } else {
        this.notice = '先选择 Manager/Worker 历史文本，再按 Ctrl+Q 引用';
        this.render();
      }
      return;
    }
    if (key.ctrl && key.name === 'c') {
      const mouseSelected = this.settings.mouseSelection === 'app' ? filterSelection(this.selectedText()) : '';
      const inputSelected = this.selectedInputText();
      const selected = mouseSelected || inputSelected;
      if (selected) {
        try {
          await (this.options.copyText ?? copyText)(selected);
          this.notice = `已复制选区 · ${Array.from(selected).length} 字符`;
          this.clearSelection();
          this.clearInputSelection();
        } catch (error) {
          this.notice = `复制选区失败：${error.message}`;
        }
        this.render();
        return;
      }
      this.notice = 'Ctrl+C 不退出 TUI；使用 /quit 或 Ctrl+D 退出';
      this.render();
      return;
    }
    if (key.ctrl && key.name === 'd') return this.options.quit();
    if (key.ctrl && key.name === 'v' && this.panel !== 'settings') {
      this.clearSelection();
      try {
        const value = clean(await (this.options.readClipboard ?? readClipboard)()).replace(/\r\n?/g, '\n');
        this.insertInput(value); this.historyIndex = this.history.length; this.historyDraft = '';
        this.notice = value ? '已粘贴剪贴板内容' : '剪贴板为空';
      } catch (error) {
        this.notice = `粘贴失败：${error.message}`;
      }
      this.render();
      return;
    }
    const preserveSelection = ((key.shift || key.ctrl) && ['up', 'down'].includes(key.name))
      || (['up', 'down'].includes(key.name) && ((this.screen === 'workers' && this.workerFocus === 'detail') || ['files', 'git'].includes(this.panel)))
      || ['pageup', 'pagedown'].includes(key.name);
    if (!preserveSelection) this.clearSelection();
    if (this.panel === 'settings') return this.settingsKey(text, key);
    const completion = this.completion;
    if (key.name === 'escape' && completion.active) { this.dismissedCompletion = this.input; this.render(); return; }
    if (key.name === 'escape' && (this.screen === 'workers' || ['help', 'request'].includes(this.panel))) {
      await this.showPanel('manager');
      this.render();
      return;
    }
    if (key.ctrl && key.name === 'return') { this.insertNewline(); return; }
    if (completion.open && ['up', 'down'].includes(key.name) && !key.ctrl && !key.shift && this.historyIndex >= this.history.length) {
      this.completionIndex = (this.completionIndex + (key.name === 'up' ? completion.items.length - 1 : 1)) % completion.items.length;
      this.completionNavigated = true; this.render(); return;
    }
    if (completion.open && key.name === 'tab' && !key.shift) { await this.fillCompletion(); return; }
    if (key.name === 'return') {
      await this.submitInput();
    } else if (key.name === 'backspace') { this.backspaceInput(); this.notice = ''; this.historyIndex = this.history.length; this.historyDraft = ''; }
    else if (key.name === 'delete') { this.deleteInput(); this.notice = ''; this.historyIndex = this.history.length; this.historyDraft = ''; }
    else if (key.ctrl && key.name === 'u') { this.setInput('', 0); this.notice = ''; this.historyIndex = this.history.length; this.historyDraft = ''; }
    else if (key.name === 'home' && !key.ctrl) {
      if (key.shift) this.moveInputCursor(-this.cursor, true);
      else { this.cursor = 0; this.clearInputSelection(); }
    }
    else if (key.name === 'end' && !key.ctrl) {
      if (key.shift) this.moveInputCursor(this.inputCharacters.length - this.cursor, true);
      else { this.cursor = this.inputCharacters.length; this.clearInputSelection(); }
    }
    else if (this.input && key.name === 'left') { this.moveInputCursor(-1, key.shift); }
    else if (this.input && key.name === 'right') { this.moveInputCursor(1, key.shift); }
    else if (key.name === 'f5' && this.conversationActor) this.foldDetails(!this.expandedActors.has(this.conversationActor));
    else if (key.name === 'f6' && this.screen === 'workers' && ['chat', 'files', 'git'].includes(this.panel)) this.workerFocus = this.workerFocus === 'list' ? 'detail' : 'list';
    else if (/^f[1-4]$/.test(key.name)) await this.showPanel(['manager', 'chat', 'files', 'git'][Number(key.name.slice(1)) - 1]);
    else if (['left', 'right'].includes(key.name) && !this.input && ['chat', 'files', 'git'].includes(this.panel)) {
      const panels = ['chat', 'files', 'git'];
      await this.showPanel(panels[(panels.indexOf(this.panel) + (key.name === 'left' ? 2 : 1)) % panels.length]);
    } else if (['up', 'down'].includes(key.name)) {
      if (key.ctrl && !key.shift) this.scrollBy(key.name === 'up' ? -1 : 1);
      else if (key.shift && !key.ctrl) this.scrollTo(key.name === 'up' ? 'top' : 'bottom');
      else if (this.screen === 'manager' && this.panel === 'manager') this.navigateHistory(key.name === 'up' ? -1 : 1);
      else if (this.screen === 'workers' && this.workerFocus === 'list' && !key.ctrl && !this.input && ['chat', 'files', 'git'].includes(this.panel)) {
        this.selected = Math.max(0, Math.min(this.workers.length - 1, this.selected + (key.name === 'up' ? -1 : 1))); this.filePath = ''; await this.refresh();
      } else this.scrollBy(key.name === 'up' ? -1 : 1);
    } else if (key.name === 'pageup') this.scrollBy(-Math.max(1, this.scrollState.height - 1));
    else if (key.name === 'pagedown') this.scrollBy(Math.max(1, this.scrollState.height - 1));
    else if (key.ctrl && key.name === 'p') this.navigateHistory(-1);
    else if (key.ctrl && key.name === 'n') this.navigateHistory(1);
    else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) { this.insertInput(text); this.notice = ''; this.historyIndex = this.history.length; this.historyDraft = ''; }
    this.render();
    await this.loadCompletionFiles();
    await this.loadSkillCompletions();
  }
  async submitInput() {
    const command = this.input.trim();
    if (!command) return;
    this.setInput('', 0);
    this.history.push(command); this.historyIndex = this.history.length; this.historyDraft = '';
    try { await this.command(command); }
    catch (error) { this.notice = error.message; }
    finally { this.render(); }
  }
  async command(text) {
    this.notice = '';
    if (!text.startsWith('/')) {
      const routed = this.service.routeInput?.(text);
      if (routed?.project) {
        await this.switchProject(routed.project);
        if (routed.text) {
          const attachments = this.options.takeAttachments?.() ?? [];
          await this.service.sendManagerMessage(routed.text, false, [], attachments);
        }
        return;
      }
      if (this.panel === 'manager') this.scrollTo('bottom');
      const attachments = this.options.takeAttachments?.() ?? [];
      await this.service.sendManagerMessage(text, false, [], attachments);
      return;
    }
    const [command, ...parts] = text.slice(1).split(' '); const args = parts.join(' ').trim();
    if (command === 'quit') return this.options.quit();
    if (command === 'shutdown') {
      await this.service.shutdown();
      return this.options.quit();
    }
    if (command === 'reload') {
      if (typeof this.options.reload !== 'function') throw new Error('重启功能不可用');
      this.notice = `正在重启 ${PRODUCT_NAME}…`; this.render();
      await this.options.reload(); return;
    }
    if (command === 'interrupt') {
      if (args) return this.service.sendManagerMessage(args, true);
      const result = await this.service.interruptManager();
      this.notice = result.interrupted ? '已停止 Manager 当前工作；发送下一条消息后继续' : 'Manager 当前没有正在执行的工作';
      this.render(); return;
    }
    if (command === 'memory') {
      const action = args.trim();
      if (action === 'clear') {
        const result = await this.service.clearManagerMemory();
        this.notice = result.cleared
          ? '已为 Manager 开启新的原生会话；工作规范、AGENTS 和任务状态仍保留'
          : 'Manager 当前已使用新的原生会话';
      } else if (!action || action === 'status') {
        const sessionId = this.service.state.manager?.sessionId;
        this.notice = sessionId
          ? `Manager native thread: ${sessionId} · /memory clear 可清空`
          : 'Manager 当前使用新的 native 对话 thread';
      } else {
        throw new Error('Usage: /memory status|clear');
      }
      this.render(); return;
    }
    if (command === 'skills') {
      const actor = args || 'manager';
      const result = await this.service.listSkills(actor, true);
      const entries = result.skills?.data ?? result.data ?? [];
      const skills = entries.flatMap(entry => entry.skills ?? []);
      const errors = entries.flatMap(entry => entry.errors ?? []);
      this.previewVersion++; this.panel = 'help'; this.scrollTo('top');
      this.preview = [
        `Skills for ${actor}`,
        '',
        ...(skills.length ? skills.map(skill => `${skill.enabled === false ? '[disabled] ' : ''}$${skill.name} · ${skill.scope ?? ''}\n  ${skill.description}\n  ${skill.path}`) : ['No skills discovered.']),
        ...(errors.length ? ['', 'Discovery errors:', ...errors.map(error => JSON.stringify(error))] : [])
      ].join('\n');
      return;
    }
    if (command === 'checkpoint') {
      const checkpoint = await this.service.createCheckpoint(args);
      this.notice = `Checkpoint ${checkpoint.id} · ${checkpoint.label}`;
      this.render(); return;
    }
    if (command === 'checkpoints') {
      const checkpoints = await this.service.listCheckpoints();
      this.notice = checkpoints.length
        ? checkpoints.map(cp => `${cp.id} · ${cp.label}`).slice(-4).join(' | ')
        : 'No checkpoints';
      this.render(); return;
    }
    if (command === 'turns') {
      const actor = args || this.conversationActor || 'manager';
      const page = await this.service.conversationTurns(actor, 20);
      const turns = page?.data ?? page?.turns?.data ?? [];
      this.notice = turns.length
        ? turns.slice(0, 5).map(turn => `${turn.id} · ${turn.status ?? ''}`).join(' | ')
        : `No native turns for ${actor}`;
      this.render(); return;
    }
    if (command === 'fork') {
      const [turnId, requestedActor] = parts;
      if (!turnId) throw new Error('Usage: /fork turn_id [manager|worker_id]');
      const actor = requestedActor || this.conversationActor || 'manager';
      const thread = await this.service.forkConversation(actor, { lastTurnId: turnId });
      this.notice = `Forked ${actor} · ${thread?.id ?? thread?.thread?.id ?? 'new thread'}`;
      this.render(); return;
    }
    if (command === 'revert') {
      const [turnId, ...rest] = parts;
      if (!turnId || !rest.includes('--yes')) throw new Error('Usage: /revert turn_id --yes [manager|worker_id]. This changes conversation history only.');
      const actor = rest.find(item => item !== '--yes') || this.conversationActor || 'manager';
      await this.service.revertConversation(actor, turnId);
      this.notice = `Reverted ${actor} before native turn ${turnId}`;
      this.render(); return;
    }
    if (command === 'restore') {
      const [checkpointId, ...options] = parts;
      if (!checkpointId) throw new Error('Usage: /restore checkpoint_id [files|conversation|all] confirm');
      const mode = options.find(item => ['files', 'conversation', 'all'].includes(item)) || 'all';
      if (!options.includes('confirm')) {
        this.notice = `Restore ${checkpointId} (${mode}) changes Last Order-managed state. Re-run with confirm.`;
        this.render(); return;
      }
      const result = await this.service.restoreCheckpoint(checkpointId, {
        files: mode !== 'conversation', conversation: mode !== 'files'
      });
      this.notice = `Restored ${checkpointId} · files=${result.restoredFiles.join(',') || '-'} · conversations=${result.forkedConversations.join(',') || '-'}`;
      this.render(); return;
    }
    if (command === 'expand' || command === 'collapse') return this.foldDetails(command === 'expand', args || 'all');
    if (command === 'settings') {
      this.panel = 'settings'; this.screen = 'manager'; this.settingsDraft = { ...this.settings }; this.settingsIndex = 0; this.settingsEditing = null;
      this.notice = `设置保存后需重启 ${PRODUCT_NAME} 生效`; this.render(); return;
    }
    if (command === 'monitor') {
      const requested = args || this.worker?.id;
      const worker = requested && this.workers.find(item => item.id === requested || item.id.startsWith(requested));
      if (!worker) throw new Error('请选择 worker 或提供有效的 worker_id');
      if (typeof this.options.openMonitor !== 'function') throw new Error('独立监视窗口不可用');
      const pid = await this.options.openMonitor(worker);
      this.notice = `已在独立窗口打开 ${worker.id} 监视${pid ? ' · PID ' + pid : ''}`;
      return;
    }
    if (command === 'help') {
      this.previewVersion++; this.panel = 'help'; this.scrollTo('top');
      this.preview = [
        '/ 在输入框内显示浅色补全；↑↓ 切候选，Tab 填入，Esc 收起',
        '补全仅填入文本；Enter 发送，Ctrl+Enter 在输入框内换行。',
        'F5: 展开 / 折叠当前对话的全部后台过程',
        '/monitor [worker_id]: 在独立窗口监视 worker',
        '/settings: 配置 staff provider/model/effort 等；Ctrl+S 保存，重启生效',
        `/reload: 快速重启 ${PRODUCT_NAME}，应用最新配置`,
        '/expand 组号 或 /collapse 组号: 展开 / 折叠一组',
        '/expand all 或 /collapse all: 展开 / 折叠全部',
        'Ctrl+Tab: Manager 与 Workers 两个主界面切换',
        'Workers: 左侧列表 + 右侧详情；窄终端上下排列',
        'Manager ↑↓: 历史输入；Ctrl+↑↓: 逐行滚动对话',
        'Workers F6: 切换列表 / 详情焦点；↑↓: 选择 worker 或滚动详情',
        'Ctrl+↑↓ / PgUp / PgDn: 逐行或翻页滚动；Shift+↑: 顶部；Shift+↓: 底部',
        '输入框 ←→: 移动光标；Home / End: 行首 / 行尾',
        'Shift+←→: 选择输入内容；Ctrl+A: 全选；输入/Delete 替换选区',
        '/memory status: 查看 Manager native thread；/memory clear: 清空记忆并开启新的原生会话',
        '/skills [actor]: 列出 Codex 可见 skills；在消息中输入 $skill-name 可显式调用',
        '/archive [worker_id]: 手动归档已停止 worker；/workers all 一次性查看归档项',
        '输入为空时 ←→: 切换对话 / 工作区 / Git；Ctrl+Home / Ctrl+End: 滚动内容',
        'F1: Manager；F2: Worker 对话；F3: 工作区；F4: Git',
        '/manager 或 /workers: 直接进入主界面',
        'Enter: 发送给 manager；Ctrl+Enter: 换行', '/interrupt [消息]: 停止 manager 当前工作；带消息时优先处理新消息',
        '/w 消息: 给选中的 worker 发消息', '/pause /resume /cancel /retry: 控制选中的 worker',
        '/select worker_id: 按 ID 选中 worker 并打开详情',
        '/approval ID: 查看完整审批请求', '/approve ID 或 /deny ID: 批准或拒绝',
        '/question ID: 查看完整问题', '/answer ID 答复: 回答问题',
        '/open 相对路径: 查看文件或目录', '/back: 上一级目录',
        '/diff task 或 /diff uncommitted: 切换 Git 比较范围', '/refresh: 刷新工作区或 Git',
        '鼠标拖选: native 由终端处理；app 模式支持滚动跟随、拖到边缘自动滚动，Ctrl+C 复制并过滤边框',
        'PgUp/PgDn: 滚动详情', 'Ctrl+P / Ctrl+N: 历史输入前后切换', 'Ctrl+U: 清空输入',
        'Ctrl+C: 应用模式有选区时复制；无选区不退出 TUI。Ctrl+Q: 将选中文本插入为引用。Ctrl+V: 粘贴剪贴板',
        '/checkpoint [名称]: 创建当前 workspace 与原生会话 checkpoint',
        '/checkpoints: 查看 checkpoint 列表',
        '/turns [actor]: 查看原生会话 turns',
        '/quote [actor:]#seq 指令: 引用 Manager 或 Worker 历史消息并发送给 Manager',
        '/fork turn_id [actor]: 从原生 turn fork 对话',
        '/revert turn_id --yes [actor]: 删除 turn 及后续历史，不改文件',
        '/restore id [files|conversation|all] confirm: 恢复 checkpoint',
        '/quit: 只退出 TUI，后台任务继续运行',
        '/shutdown: 关闭 Last Order 和后台任务；Ctrl+C 始终不退出，Ctrl+D 或 /quit 退出 TUI'
      ].join('\n'); return;
    }
    if (command === 'approval' || command === 'question') {
      const item = (command === 'approval' ? this.service.approvals : this.service.questions).get(args);
      if (!item) throw new Error('Request is no longer pending');
      this.previewVersion++; this.panel = 'request'; this.requestId = args; this.scrollTo('top'); this.preview = `${command} ${args} [${item.actor}]\n${JSON.stringify(item.detail, null, 2)}\n\n${command === 'approval' ? '/approve ID 或 /deny ID' : '/answer ID 答复'}`; return;
    }
    if (command === 'approve' || command === 'deny') { this.service.respondApproval(args, command === 'approve'); return; }
    if (command === 'answer') { const [questionId, ...answer] = parts; this.service.answerQuestion(questionId, answer.join(' ')); return; }
    if (command === 'manager') return this.showPanel('manager');
    if (command === 'workers') {
      this.showArchivedOnce = args.trim() === 'all';
      return this.showPanel(this.workerPanel);
    }
    if (command === 'quote') {
      await this.quoteMessage(args);
      return;
    }
    if (command === 'archive') {
      if (this.screen !== 'workers') throw new Error('/archive is only available in the Workers view');
      if (args.trim() === 'all') {
        const targets = this.allWorkers.filter(worker => !worker.archivedAt && ARCHIVABLE_WORKER_STATUSES.has(worker.status));
        for (const worker of targets) await this.service.archiveWorker(worker.id, 'archive-all');
        this.notice = targets.length ? `已归档 ${targets.length} 个停止的 worker` : '没有可归档的停止 worker';
        this.selected = Math.max(0, Math.min(this.selected, this.workers.length - 1));
        this.render();
        return;
      }
      const target = args ? this.allWorkers.find(worker => worker.id === args || worker.id.startsWith(args)) : this.worker;
      if (!target) throw new Error('Unknown worker');
      const result = await this.service.archiveWorker(target.id);
      this.notice = `Worker ${target.id} 已归档${result.already_archived ? '（此前已归档）' : ''}`;
      this.selected = Math.max(0, Math.min(this.selected, this.workers.length - 1));
      this.render();
      return;
    }
    if (command === 'select') { const index = this.workers.findIndex(w => w.id === args || w.id.startsWith(args)); if (index < 0) throw new Error('Unknown worker'); this.selected = index; this.filePath = ''; return this.showPanel(this.workerPanel); }
    if (command === 'refresh') return this.refresh();
    if (!this.worker) throw new Error('Select a worker first');
    if (command === 'w') return this.service.sendWorkerMessage(this.worker.id, args);
    if (['pause', 'resume', 'cancel', 'retry'].includes(command)) return this.service.controlWorker(this.worker.id, command, args);
    if (command === 'open') { this.filePath = args; return this.showPanel('files'); }
    if (command === 'back') { this.filePath = this.filePath ? path.dirname(this.filePath) : ''; if (this.filePath === '.') this.filePath = ''; return this.showPanel('files'); }
    if (command === 'diff') { if (!['task', 'uncommitted'].includes(args)) throw new Error('Use /diff task or /diff uncommitted'); this.diffMode = args; return this.showPanel('git'); }
    throw new Error('Unknown command. Type /help');
  }
  screenPoint(event) {
    return {
      row: Math.max(0, Math.min(this.lastFrameLines.length - 1, event.y - 1)),
      col: Math.max(0, Math.min(this.lastSize.columns - 1, event.x - 1))
    };
  }
  contentPoint(event, clamp = false) {
    const view = this.lastConversationView;
    if (!view?.lines?.length) return null;
    const row = event.y - 1, col = event.x - 1;
    if (!clamp && (row < view.rowStart || row >= view.rowStart + view.height || col < view.colStart || col > view.colEnd)) return null;
    const screenRow = Math.max(view.rowStart, Math.min(view.rowStart + view.height - 1, row));
    return { contentRow: view.top + screenRow - view.rowStart, col: Math.max(0, Math.min(view.colEnd - view.colStart, col - view.colStart)) };
  }
  contentRange() {
    if (this.selection?.kind !== 'content') return null;
    const { anchor, focus } = this.selection;
    return anchor.contentRow < focus.contentRow || (anchor.contentRow === focus.contentRow && anchor.col <= focus.col)
      ? { start: anchor, end: focus }
      : { start: focus, end: anchor };
  }
  selectionRange() {
    if (!this.selection || this.selection.kind === 'screen') {
      if (!this.selection) return null;
      const { anchor, focus } = this.selection;
      return anchor.row < focus.row || (anchor.row === focus.row && anchor.col <= focus.col)
        ? { start: anchor, end: focus }
        : { start: focus, end: anchor };
    }
    const view = this.lastConversationView, range = this.contentRange();
    if (!view || view.actor !== this.selection.actor || !range) return null;
    const first = Math.max(range.start.contentRow, view.top);
    const last = Math.min(range.end.contentRow, view.top + view.height - 1);
    if (first > last) return null;
    return {
      start: {
        row: view.rowStart + first - view.top,
        col: view.colStart + (range.start.contentRow === first ? range.start.col : 0)
      },
      end: {
        row: view.rowStart + last - view.top,
        col: view.colStart + (range.end.contentRow === last ? range.end.col : view.colEnd - view.colStart)
      }
    };
  }
  selectedText() {
    if (!this.selection) return '';
    if (this.selection.kind === 'content') {
      const range = this.contentRange();
      if (!range) return '';
      return this.selection.lines.slice(range.start.contentRow, range.end.contentRow + 1).map((line, index) => {
        const contentRow = range.start.contentRow + index;
        const start = contentRow === range.start.contentRow ? range.start.col : 0;
        const end = contentRow === range.end.contentRow ? range.end.col + 1 : Number.MAX_SAFE_INTEGER;
        return sliceColumns(line, start, end).trimEnd();
      }).join('\n').replace(/\n+$/, '');
    }
    const range = this.selectionRange();
    return this.lastFrameLines.slice(range.start.row, range.end.row + 1).map((line, index) => {
      const row = range.start.row + index;
      const start = row === range.start.row ? range.start.col : 0;
      const end = row === range.end.row ? range.end.col + 1 : Number.MAX_SAFE_INTEGER;
      return sliceColumns(line, start, end).trimEnd();
    }).join('\n').replace(/\n+$/, '');
  }
  updateSelectionEdge(event) {
    if (this.selection?.kind !== 'content' || !this.selection.dragging || !this.lastConversationView) {
      this.stopSelectionAutoScroll(); return;
    }
    const view = this.lastConversationView, row = event.y - 1;
    const edge = row <= view.rowStart ? -1 : row >= view.rowStart + view.height - 1 ? 1 : 0;
    if (!edge) { this.stopSelectionAutoScroll(); return; }
    if (this.selectionAutoTimer) return;
    this.selectionEdge = edge;
    this.selectionAutoTimer = setInterval(() => {
      if (!this.selection?.dragging || !this.selectionEdge || !this.lastConversationView) return this.stopSelectionAutoScroll();
      const state = this.scrollState, before = state.top ?? Math.max(0, state.total - state.height);
      this.scrollBy(this.selectionEdge);
      const after = state.top ?? Math.max(0, state.total - state.height);
      if (after === before) return this.stopSelectionAutoScroll();
      const view = this.lastConversationView;
      view.top = after;
      const point = this.contentPoint(this.selectionPointer, true);
      if (point) this.selection.focus = point;
      this.render();
    }, 80);
  }
  async handleMouse(event) {
    if (this.settings.mouseSelection !== 'app' || event.shift) return;
    if (event.type === 'down') {
      if (event.button !== 0) return;
      this.clearSelection();
      const point = this.contentPoint(event);
      this.selectionPointer = { x: event.x, y: event.y };
      this.selection = point && this.lastConversationView
        ? { kind: 'content', actor: this.lastConversationView.actor, lines: this.lastConversationView.lines.slice(), anchor: point, focus: point, dragging: true }
        : { kind: 'screen', anchor: this.screenPoint(event), focus: this.screenPoint(event), dragging: true };
      this.scheduleRender(16);
      return;
    }
    if (!this.selection?.dragging) return;
    if (event.type === 'drag') {
      this.selectionPointer = { x: event.x, y: event.y };
      this.selection.focus = this.selection.kind === 'content' ? this.contentPoint(event, true) : this.screenPoint(event);
      this.updateSelectionEdge(event);
      this.scheduleRender(16);
      return;
    }
    if (event.type !== 'up') return;
    this.stopSelectionAutoScroll();
    if (this.selection.kind === 'content') {
      const point = this.contentPoint(event, true);
      if (point) this.selection.focus = point;
    } else this.selection.focus = this.screenPoint(event);
    this.selection.dragging = false;
    const text = filterSelection(this.selectedText());
    if (!text) { this.clearSelection(); this.scheduleRender(16); return; }
    this.notice = `已选择 ${Array.from(text).length} 字符 · Ctrl+C 复制 · Esc 清除`;
    this.render();
  }
  async refresh() {
    const worker = this.worker, panel = this.panel, version = ++this.previewVersion;
    if (!['files', 'git'].includes(panel)) return;
    if (!worker?.workspace) { this.preview = '工作区尚未创建。'; return; }
    this.preview = '正在加载…';
    try {
      const output = panel === 'git' ? await this.service.git.diff(worker, this.diffMode) : await this.service.git.files(worker, this.filePath);
      if (this.worker?.id !== worker.id || this.panel !== panel || this.previewVersion !== version) return;
      this.preview = Array.isArray(output) ? `Workspace: ${worker.workspace}\nPath: ${this.filePath || '.'}\n\n${output.map(e => (e.directory ? '[dir] ' : e.symlink ? '[link] ' : '      ') + e.name).join('\n')}\n\n/open relative/path 查看文件或目录` : output;
    } catch (error) { if (this.previewVersion === version && this.panel === panel) this.preview = error.message; }
  }
  conversation(actor, columns) {
    if (!actor) return [];
    const manager = this.service.state.manager;
    const active = new Set(manager.active ?? []);
    const queued = new Set((manager.pending ?? [])
      .filter(item => item.queued && !active.has(item.id))
      .map(item => item.id));
    let events = this.service.store.history(actor).filter(event =>
      !(event.type === 'manager_input' && event.data.queued && queued.has(event.data.messageId))
    );
    if (actor === 'manager') {
      const memoryEpoch = manager.memoryEpoch ?? 0;
      events = events.filter(event => {
        if ((event.data.memoryEpoch ?? 0) !== memoryEpoch) return false;
        if (event.type === 'manager_input') return true;
        if (event.type !== 'message') return false;
        if (['question', 'error', 'warning'].includes(event.data.role)) return true;
        if (event.data.background) return false;
        return ['user', 'assistant'].includes(event.data.role);
      });
    }
    return renderConversation(events, actor, columns, {
      expandedActors: this.expandedActors,
      expandedGroups: this.expandedGroups,
      collapsedGroups: this.collapsedGroups
    });
  }
  queuedMessageLines(state, columns, limit = 5) {
    if (!state.managerBusy && !state.manager.hold) return [];
    const active = new Set(state.manager.active ?? []);
    const messages = (state.manager.pending ?? []).filter(item => item.queued && !active.has(item.id));
    if (!messages.length) return [];
    const shown = messages.slice(0, Math.max(1, limit));
    const lines = [border(`排队发送 · ${messages.length} 条`, columns)];
    for (let index = 0; index < shown.length; index++) {
      const text = clean(shown[index].text).replace(/\s+/g, ' ').trim();
      lines.push('│ ' + fit(`${index + 1}. ${text}`, columns - 4) + ' │');
    }
    if (messages.length > shown.length) lines.push('│ ' + fit(`另有 ${messages.length - shown.length} 条排队消息`, columns - 4) + ' │');
    lines.push(border('', columns, '╰', '╯'));
    return lines;
  }
  viewport(content, height) {
    height = Math.max(0, height);
    const state = this.scrollState;
    state.total = content.length; state.height = Math.max(0, height);
    const normalMax = Math.max(0, content.length - height);
    if (state.top !== null) state.top = Math.min(state.top, normalMax + this.bottomPadding());
    const top = state.top ?? normalMax;
    const visible = content.slice(top, top + height);
    // Keep the sender visible when a long message begins above the viewport.
    if (height > 1 && top > 0 && content[top]?.startsWith('│')) {
      const heading = content.slice(0, top).findLast(line => line.startsWith('╭─ '));
      if (heading) {
        const title = heading.slice(3).replace(/─*╮$/, '').trim();
        const columns = Array.from(heading).reduce((sum, char) => sum + width(char), 0);
        visible[0] = border(title + ' · 续', columns);
      }
    }
    return [...visible, ...Array(Math.max(0, height - visible.length)).fill('')];
  }
  workerList(state, columns, height, compact = false) {
    const title = `Worker 列表 ${this.workers.length ? this.selected + 1 : 0}/${this.workers.length}${this.showArchivedOnce ? ' · 含归档' : ''}${this.workerFocus === 'list' ? ' ·' : ''}`;
    if (height <= 2) {
      const summary = this.worker ? `${this.worker.archivedAt ? '已归档' : statusLabel(this.worker.status)} ${this.worker.title ?? state.pipelines[this.worker.pipelineId]?.title ?? this.worker.id}` : '尚无 worker';
      return [border(title, columns), border(summary, columns, '╰', '╯')].slice(0, height);
    }
    const lines = [border(title, columns)];
    const add = text => lines.push('│ ' + fit(text, columns - 4) + ' │');
    if (!this.workers.length) add('尚无 worker');
    const itemHeight = compact ? 1 : 3;
    const count = Math.max(1, Math.floor((height - 2) / itemHeight));
    const first = Math.max(0, Math.min(this.selected - count + 1, this.workers.length - count));
    for (let i = first; i < Math.min(this.workers.length, first + count); i++) {
      const w = this.workers[i], title = w.title ?? state.pipelines[w.pipelineId]?.title ?? w.id;
      const workerStatus = w.archivedAt ? '已归档' : statusLabel(w.status);
      const marker = i === this.selected ? '▶' : ' ';
      if (compact) add(`${marker} ${workerStatus} · ${title}`);
      else {
        add(`${marker} ${title}`);
        add(`  ${workerStatus} · ${w.provider}${w.model ? '/' + w.model : ''} / ${w.kind}${w.effort ? ' [' + w.effort + ']' : ''}`);
        add(`  ${w.id}`);
      }
    }
    while (lines.length < height - 1) add('');
    return [...lines.slice(0, height - 1), border('', columns, '╰', '╯')];
  }
  workerView(state, columns, height, rowOffset = 0, colOffset = 0) {
    if (height < 1) return [];
    const labels = { chat: '对话', files: '工作区', git: 'Git' };
    const lines = [border(`Worker 详情 · ${labels[this.panel]}${this.workerFocus === 'detail' ? ' ●' : ''}`, columns)];
    const add = text => lines.push('│ ' + fit(text, columns - 4) + ' │');
    if (height >= 7) add(Object.entries(labels).map(([panel, label]) => panel === this.panel ? `[${label}]` : ` ${label} `).join(' ') + '  ←→');
    const worker = this.worker;
    if (worker && height >= 8) {
      add(`${worker.id} · ${statusLabel(worker.status)} · ${worker.provider} / ${worker.kind}`);
      add(`任务：${worker.title ?? state.pipelines[worker.pipelineId]?.title ?? worker.id}${this.panel === 'git' ? ' [' + this.diffMode + ']' : ''}`);
    }
    if (worker && height >= 9 && worker.notes?.length) add(`备注：${worker.notes.join(' · ')}`);
    const contentWidth = columns - 4;
    const content = !worker ? wrap('尚无 worker，Ctrl+Tab 返回 Manager 发送需求。', contentWidth)
      : this.panel === 'chat' ? this.conversation(worker.id, contentWidth)
      : wrap(this.preview || '输入 /refresh 加载当前视图。', contentWidth);
    const viewContent = content.length ? content : ['等待 worker 对话…'];
    const viewHeight = Math.max(0, height - lines.length - 1);
    const visible = this.viewport(viewContent, viewHeight);
    const top = this.scrollState.top ?? Math.max(0, viewContent.length - viewHeight);
    this.lastConversationView = {
      actor: worker?.id ?? null, lines: viewContent, top, height: viewHeight,
      rowStart: rowOffset + lines.length, colStart: colOffset + 2, colEnd: colOffset + columns - 3
    };
    for (const line of visible) add(line);
    if (height > 1) lines.push(border('', columns, '╰', '╯'));
    return lines.slice(0, height);
  }
  headerLines(state, columns, rows) {
    const compact = columns < 60 || rows < 18, tiny = columns < 40 || rows < 14;
    const managerState = state.managerError ? '错误，发送消息重试'
      : state.manager.hold ? '已中断，发送消息继续'
        : state.managerBusy ? ((state.manager.active?.length ?? 0) ? '正在与用户对话' : '正在处理后台事件')
          : '就绪';
    const activeWorkers = this.workers.filter(worker => ['starting', 'running'].includes(worker.status)).length;
    const active = new Set(state.manager.active ?? []);
    const queued = (state.manager.pending ?? []).filter(item => !active.has(item.id)).length;
    const status = `Manager ${managerState} · ${queued} 个任务待处理 · ${activeWorkers} 个 Worker 正在工作`;
    const hint = this.screen === 'manager'
      ? compact ? '↑↓ 历史 · Alt+↑↓ 项目 · Ctrl+↑↓ 滚动 · Ctrl+Tab · /help' : '↑↓ 历史 · Alt+↑↓ 项目 · Ctrl+↑↓ 滚动 · Shift+↑↓ 顶部/底部 · PgUp/PgDn · Ctrl+Tab · F5 · /help'
      : compact ? 'F6 焦点 · ↑↓ 选择/滚动 · Alt+↑↓ 项目 · Ctrl+Tab · /help' : 'F6 焦点 · ↑↓ 选择/滚动 · Ctrl+↑↓/PgUp/PgDn 滚详情 · Shift+↑↓ 顶部/底部 · Alt+↑↓ 项目 · Ctrl+Tab · /help';
    const lines = [fit(`${PRODUCT_NAME} · ${this.screen === 'manager' ? 'Manager' : 'Workers'}`, columns)];
    const add = (label, value) => {
      if (tiny) lines.push(compactLabeledLine(label, value, columns));
      else lines.push(...labeledLines(label, value, columns));
    };
    const projects = this.service.projects ?? [{ code: '', root: this.service.git?.root ?? '', active: true }];
    this.projectScroll = Math.max(0, Math.min(this.projectScroll, Math.max(0, projects.length - 3)));
    const windowProjects = projects.slice(this.projectScroll, this.projectScroll + 3);
    for (let index = 0; index < windowProjects.length; index++) {
      const project = windowProjects[index];
      const label = index === 0 ? '项目' : '    ';
      const value = `${project.code ? `-[${project.code}] ` : ''}${tiny ? tail(project.root, Math.max(8, columns - 12)) : project.root}${project.active ? ' *' : ''}`;
      if (tiny) lines.push(compactLabeledLine(label, value, columns));
      else lines.push(...labeledLines(label, value, columns));
    }
    add('状态', status);
    if (this.settings.showShortcutHints) add('提示', hint);
    lines.push('─'.repeat(columns));
    return lines;
  }
  frame(columns, rows) {
    const state = this.service.snapshot(), lines = [];
    this.lastConversationView = null;
    const add = text => lines.push(fit(text, columns));
    for (const line of this.headerLines(state, columns, rows)) add(line);
    const pending = [...state.approvals.map(a => `审批 ${a.id} [${a.actor}] · /approval ${a.id} 查看`), ...state.questions.map(q => `问题 ${q.id} [${q.actor}] · /question ${q.id} 查看`)];
    const pendingLines = pending.slice(0, Math.min(5, Math.max(1, rows - 12)));
    const queuedLines = this.queuedMessageLines(state, columns, Math.max(1, Math.min(5, Math.floor(rows / 6))));
    const input = this.inputPresentation(columns, Math.max(1, Math.floor(rows / 3)));
    this.lastInputPresentation = input;
    const available = Math.max(0, rows - lines.length - pendingLines.length - queuedLines.length - 3 - (input.lines.length - 1));
    if (this.panel === 'settings') {
      for (const line of this.settingsView(columns, available)) add(line);
    } else if (['help', 'request'].includes(this.panel)) {
      const content = wrap(this.preview, columns);
      const visible = this.viewport(content, available);
      const top = this.scrollState.top ?? Math.max(0, content.length - available);
      this.lastConversationView = { actor: '__panel__', lines: content, top, height: available, rowStart: lines.length, colStart: 0, colEnd: columns - 1 };
      for (const line of visible) add(line);
    } else if (this.screen === 'manager') {
      const content = this.conversation('manager', columns);
      const viewContent = content;
      const visible = this.viewport(viewContent, available);
      const top = this.scrollState.top ?? Math.max(0, viewContent.length - available);
      this.lastConversationView = { actor: 'manager', lines: viewContent, top, height: available, rowStart: lines.length, colStart: 0, colEnd: columns - 1 };
      for (const line of visible) add(line);
    } else if (columns >= 80) {
      const leftWidth = Math.min(38, Math.floor(columns * 0.36)), rightWidth = columns - leftWidth - 3;
      const list = this.workerList(state, leftWidth, available), view = this.workerView(state, rightWidth, available, lines.length, leftWidth + 3);
      for (let i = 0; i < available; i++) add(fit(list[i] ?? '', leftWidth) + ' │ ' + (view[i] ?? ''));
    } else {
      const desired = Math.min(4, Math.max(2, Math.floor(available / 3)));
      const listHeight = Math.max(0, Math.min(available, desired));
      const separator = available > listHeight ? 1 : 0;
      const list = this.workerList(state, columns, listHeight, true);
      for (let i = 0; i < listHeight; i++) add(list[i] ?? '');
      if (separator) add('─'.repeat(columns));
      for (const line of this.workerView(state, columns, available - listHeight - separator, lines.length)) add(line);
    }
    for (const line of pendingLines) add(line);
    for (const line of queuedLines) add(line);
    add(this.notice || this.scrollHint() + ' | Enter → Manager · /w → Worker');
    add('─'.repeat(columns));
    for (const inputLine of input.lines) lines.push(inputLine.plain);
    this.lastFrameLines = lines.slice();
    this.lastSize = { columns, rows };
    return lines;
  }
  render() {
    if (this.stopped || this.service.closed) return;
    const columns = Math.max(24, (this.options.virtualTerminal ? this.virtualSize.columns : process.stdout.columns ?? 100) - 1);
    const rows = Math.max(12, this.options.virtualTerminal ? this.virtualSize.rows : process.stdout.rows ?? 30);
    const inputRows = Math.max(1, Math.floor(rows / 3));
    const lines = this.frame(columns, rows), input = this.lastInputPresentation ?? this.inputPresentation(columns, inputRows);
    const range = this.selectionRange();
    const inputStart = lines.length - input.lines.length;
    const frame = lines.slice(0, rows).map((line, i) => {
      const inputLine = i >= inputStart ? input.lines[i - inputStart] : null;
      const plain = inputLine?.plain ?? line.trimEnd();
      if (inputLine?.highlightStart != null) {
        return `\x1b[${i + 1};1H\x1b[2K` + highlightColumns(plain, inputLine.highlightStart, inputLine.highlightEnd);
      }
      if (!range || i < range.start.row || i > range.end.row) return `\x1b[${i + 1};1H\x1b[2K` + (inputLine ? inputLine.styled : plain);
      const start = i === range.start.row ? range.start.col : 0;
      const end = i === range.end.row ? range.end.col + 1 : columns;
      return `\x1b[${i + 1};1H\x1b[2K` + highlightColumns(plain, start, end);
    }).join('');
    const cursorRow = Math.min(rows, inputStart + input.cursorRow + 1);
    process.stdout.write('\x1b[?25l' + frame + `\x1b[${cursorRow};${input.cursor}H\x1b[?25h`);
  }
  stop() {
    if (this.stopped) return; this.stopped = true; clearTimeout(this.renderTimer);
    this.clearSelection();
    if (!this.options.virtualTerminal) process.stdin.off('data', this.onData);
    this.terminalInput?.off('keypress', this.onKey); this.terminalInput?.destroy();
    if (!this.options.virtualTerminal) process.stdout.off('resize', this.onResize);
    this.service.off('change', this.onChange); this.service.off('activity', this.onChange);
    if (!this.options.virtualTerminal && process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); }
    process.stdout.write('\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[?1049l');
  }
}
