// Native DOM adapter. Commands, keys and displayed content come from src/ui.js.
const vscode = acquireVsCodeApi();
const { TerminalUI, DEFAULT_CONFIG, conversationPresentation,
  renderMarkdown, stripFormatting, fit, clean } = LastOrderUI;
const state = {
  snapshot: { workers: {}, pipelines: {}, requests: {}, notifications: [], manager: { pending: [], active: [] }, approvals: [], questions: [] },
  config: { ...DEFAULT_CONFIG }, projects: [], projectRoot: '', histories: new Map(), attachments: [],
  connected: false, connectionError: '', runtime: null, historyRequest: null, historyVersion: 0,
  pending: new Set(), commandErrors: [], dimensions: { columns: 80, rows: 30, cell: 8, line: 20 }, scroll: new Map()
};
const requestQueue = new Map();
let requestSequence = 0;
let renderFrame;
let keyChain = Promise.resolve();
const $ = selector => document.querySelector(selector);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
const PASTED_IMAGE_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'], ['image/webp', 'webp']
]);
const PASTED_IMAGE_EXTENSIONS = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']
]);
const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
function pastedImageMime(file) {
  if (PASTED_IMAGE_TYPES.has(file.type)) return file.type;
  const extension = /\.([^.]+)$/.exec(file.name ?? '')?.[1].toLowerCase();
  return PASTED_IMAGE_EXTENSIONS.get(extension) ?? '';
}
function clipboardImageFiles(data) {
  const files = Array.from(data?.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean);
  const candidates = files.length ? files : Array.from(data?.files ?? []);
  return candidates
    .map(file => ({ file, mime: pastedImageMime(file) }))
    .filter(candidate => candidate.mime);
}
function readPastedImage(candidate, index) {
  const { file, mime } = candidate;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('无法读取剪贴板图片'));
    reader.onload = () => {
      const data = String(reader.result ?? '').split(',', 2)[1];
      if (!data) return reject(new Error('剪贴板图片为空'));
      const extension = PASTED_IMAGE_TYPES.get(mime);
      const name = file.name?.trim() || `pasted-image-${Date.now()}-${index + 1}.${extension}`;
      resolve({ name, mime, size: file.size, data });
    };
    reader.readAsDataURL(file);
  });
}
async function addPastedImages(candidates) {
  const slots = Math.max(0, 8 - state.attachments.length);
  if (!slots) {
    ui.notice = '最多同时添加 8 张图片';
    scheduleRender();
    return;
  }
  if (candidates.length > slots) ui.notice = '最多同时添加 8 张图片';
  const images = [];
  for (const [index, candidate] of candidates.slice(0, slots).entries()) {
    const { file } = candidate;
    if (file.size > MAX_PASTED_IMAGE_BYTES) {
      ui.notice = '单张图片不能超过 20 MB';
      continue;
    }
    try { images.push(await readPastedImage(candidate, index)); }
    catch (error) { ui.notice = error.message; }
  }
  if (images.length) post('pasteImages', { images });
  scheduleRender();
}
function api(action, payload = {}) {
  const id = ++requestSequence;
  return new Promise((resolve, reject) => {
    requestQueue.set(id, { resolve, reject });
    vscode.postMessage({ ...payload, type: 'api', id, action });
  });
}
function post(type, payload = {}) { vscode.postMessage({ type, ...payload }); }
function track(promise) {
  state.pending.add(promise);
  promise.then(() => state.pending.delete(promise), error => {
    state.pending.delete(promise);
    state.commandErrors.push(error);
    ui.notice = error.message;
    scheduleRender();
  });
  return promise;
}
const service = {
  get state() { return state.snapshot; }, get config() { return state.config; },
  get projects() { return state.projects.length ? state.projects : [{ code: '', root: state.projectRoot, active: true }]; },
  get info() { return state.runtime || {}; },
  get approvals() { return new Map(state.snapshot.approvals.map(item => [item.id, item])); },
  get questions() { return new Map(state.snapshot.questions.map(item => [item.id, item])); },
  store: { history: actor => state.histories.get(actor) || [] },
  snapshot: () => state.snapshot,
  git: {
    get root() { return state.projectRoot; },
    files: async (worker, path = '') => {
      const result = await api('files', { workerId: worker.id, path });
      return result.files;
    },
    diff: async (worker, mode) => (await api('diff', { workerId: worker.id, mode })).diff
  },
  routeInput(text) {
    const match = /^-([A-Za-z]{1,2})(?:\s+([\s\S]*))?$/.exec(text);
    return match ? { project: match[1].toUpperCase(), text: match[2]?.trim() || '' } : null;
  },
  async switchProject(selector) {
    const project = service.projects.find(item => item.code === selector || item.root === selector);
    if (!project) throw new Error(`Unknown project: ${selector}`);
    const value = await api('switchProject', { root: project.root });
    return { ...project, ...value };
  },
  sendManagerMessage: (text, interrupt = false, quotes = [], attachments = []) => track(api('sendManager', { text, interrupt, quotes, attachments })),
  interruptManager: () => track(api('interruptManager')),
  clearManagerMemory: () => track(api('clearMemory')),
  sendWorkerMessage: (workerId, text) => track(api('sendWorker', { workerId, text })),
  controlWorker: (workerId, workerAction, reason) => track(api('controlWorker', { workerId, workerAction, reason })),
  archiveWorker: (workerId, reason) => track(api('archiveWorker', { workerId, reason })),
  conversationEvent: async (actor, seq) => {
    const cached = service.store.history(actor).find(event => event.seq === seq);
    return cached || (await api('conversationEvent', { actor, seq })).event;
  },
  listSkills: (actor, forceReload) => api('skills', { actor, forceReload }),
  conversationTurns: async (actor, limit) => (await api('turns', { actor, limit })).turns,
  forkConversation: async (actor, options) => (await api('forkConversation', { actor, ...options })).thread,
  revertConversation: (actor, beforeTurnId) => track(api('revertConversation', { actor, beforeTurnId })),
  listCheckpoints: async () => (await api('checkpoints')).checkpoints,
  createCheckpoint: async label => (await api('createCheckpoint', { label })).checkpoint,
  restoreCheckpoint: (checkpointId, options) => track(api('restoreCheckpointById', {
    checkpointId, mode: options.files === false ? 'conversation' : options.conversation === false ? 'files' : 'all'
  })),
  respondApproval: (approvalId, allowed) => track(api('approval', { approvalId, allowed })),
  answerQuestion: (questionId, answer) => track(api('question', { questionId, answer })),
  shutdown: () => track(api('shutdown'))
};
const ui = new TerminalUI(service, {
  quit: () => api('closeView'), reload: () => api('reloadWindow'),
  saveSettings: async config => {
    const result = await api('saveConfig', { config });
    return result.config || config;
  },
  openMonitor: async worker => { await api('monitorWorker', { workerId: worker.id }); },
  takeAttachments: () => state.attachments.map(({ preview, ...attachment }) => attachment),
  copyText: text => post('copyText', { text })
});
ui.render = scheduleRender;

function measure() {
  const cell = $('#cell-measure').getBoundingClientRect().width / 10 || 8;
  const shell = $('.app-shell');
  const style = getComputedStyle(shell);
  const available = shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const line = parseFloat(getComputedStyle(document.body).lineHeight) || 20;
  state.dimensions = { columns: Math.max(24, Math.floor(available / cell)), rows: Math.max(12, Math.floor(innerHeight / line)), cell, line };
  return state.dimensions;
}
function scheduleRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = null; renderNative(); });
}
function ansiFragment(source) {
  const fragment = document.createDocumentFragment();
  const pattern = /\x1b\[([0-9;]*)m|\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  const styles = new Set();
  let target = '', position = 0, match;
  const append = text => {
    if (!text) return;
    const element = target ? node('a', [...styles].join(' '), text) : node('span', [...styles].join(' '), text);
    if (target) { element.href = '#'; element.dataset.external = target; }
    fragment.append(element);
  };
  while ((match = pattern.exec(source))) {
    append(source.slice(position, match.index));
    if (match[2] !== undefined) target = match[2];
    else for (const value of (match[1] || '0').split(';').map(Number)) {
      if (value === 0) styles.clear();
      else if (value === 1) styles.add('bold');
      else if (value === 2 || value === 90) styles.add('dim');
      else if (value === 3) styles.add('italic');
      else if (value === 4) styles.add('underline');
      else if (value === 36) styles.add('code');
    }
    position = pattern.lastIndex;
  }
  append(source.slice(position));
  return fragment;
}
function reconcile(container, desired) {
  for (const child of [...container.childNodes]) if (child.nodeType === Node.TEXT_NODE) child.remove();
  desired.forEach((element, index) => {
    if (container.children[index] !== element) container.insertBefore(element, container.children[index] || null);
  });
  while (container.children.length > desired.length) container.lastElementChild.remove();
}
function currentScroller() {
  if (['help', 'request'].includes(ui.panel)) return $('#auxiliary-preview');
  if (ui.panel === 'settings') return $('#settings-view');
  if (ui.panel === 'manager') return $('#manager-messages');
  return ui.panel === 'chat' ? $('#worker-messages') : $('#worker-preview');
}
function scrollMetrics() {
  const scroller = currentScroller();
  const line = state.dimensions.line;
  const normalMax = Math.max(0, ui.scrollState.total - ui.scrollState.height);
  const pixels = Math.max(0, scroller.scrollHeight - tailPadding(scroller) - scroller.clientHeight);
  const offset = scroller.scrollTop - pixels;
  ui.scrollState.top = Math.abs(offset) < line / 2 ? null
    : offset > 0 ? normalMax + Math.round(offset / line)
      : pixels ? Math.round(scroller.scrollTop / pixels * normalMax) : 0;
}
function tailPadding(scroller) { return parseFloat(scroller.style.getPropertyValue('--tail-padding')) || 0; }
function followBottom(scroller) { return Math.max(0, scroller.scrollHeight - tailPadding(scroller) - scroller.clientHeight); }
ui.scrollBy = delta => {
  const scroller = currentScroller();
  scroller.scrollTop += delta * state.dimensions.line;
  scrollMetrics();
};
ui.scrollTo = position => {
  const scroller = currentScroller();
  scroller.scrollTop = position === 'top' ? 0 : followBottom(scroller);
  ui.scrollState.top = position === 'top' ? 0 : null;
};

function renderConversation(container, actor, columns) {
  const events = ui.visibleConversationEvents(actor);
  const signature = JSON.stringify([actor, columns, events, [...ui.expandedActors], [...ui.expandedGroups], [...ui.collapsedGroups]]);
  if (container.dataset.signature === signature) return;
  const previousActor = container.dataset.actor;
  const following = Math.abs(followBottom(container) - container.scrollTop) < state.dimensions.line * 2;
  if (previousActor && previousActor !== actor) state.scroll.set(previousActor, { top: container.scrollTop, following });
  const old = new Map([...container.children].map(element => [element.dataset.key, element]));
  const desired = [];
  for (const group of conversationPresentation(events, actor, ui)) {
    const key = `${actor}:${group.kind === 'background' ? 'background:' + group.id : 'message:' + group.event.seq}`;
    const contents = JSON.stringify([
      columns,
      group.kind === 'message' ? group.event
        : group.kind === 'combined' ? [group.event, group.intermediate]
          : group.events,
      group.number
    ]);
    let element = old.get(key);
    if (element?.dataset.contents !== contents) {
      if (group.kind === 'message') {
        const event = group.event;
        element = node('article', `message ${event.data.role || event.type}`);
        element.append(node('div', 'message-label', group.title));
        const body = node('div', 'message-body');
        body.append(ansiFragment(renderMarkdown(group.content, Math.max(8, columns - 6)).join('\n')));
        element.append(body);
      } else if (group.kind === 'combined') {
        const event = group.event;
        element = node('article', `message combined-message ${event.data.role || event.type}`);
        const intermediate = node('details', 'message-intermediate');
        intermediate.open = group.intermediate.expanded;
        intermediate.append(
          node('summary', '', group.intermediate.title),
          node('div', 'background-collapsed', group.intermediate.collapsedContent)
        );
        const intermediateBody = node('div', 'background-content');
        intermediateBody.append(ansiFragment(renderMarkdown(group.intermediate.expandedContent, Math.max(8, columns - 6)).join('\n')));
        intermediate.append(intermediateBody);
        intermediate.addEventListener('toggle', () => {
          if (intermediate.open) { ui.expandedGroups.add(`${actor}:${group.intermediate.id}`); ui.collapsedGroups.delete(`${actor}:${group.intermediate.id}`); }
          else { ui.collapsedGroups.add(`${actor}:${group.intermediate.id}`); ui.expandedGroups.delete(`${actor}:${group.intermediate.id}`); }
          scheduleRender();
        });
        const body = node('div', 'message-body message-final-body');
        body.append(ansiFragment(renderMarkdown(group.content, Math.max(8, columns - 6)).join('\n')));
        element.append(intermediate, node('div', 'message-label message-final-label', group.title), body);
      } else {
        element = node('details', 'background-group');
        element.append(node('summary'), node('div', 'background-collapsed', group.collapsedContent));
        const body = node('div', 'background-content');
        body.append(ansiFragment(renderMarkdown(group.expandedContent, Math.max(8, columns - 6)).join('\n')));
        element.append(body);
        element.addEventListener('toggle', () => {
          if (element.open) { ui.expandedGroups.add(`${actor}:${group.id}`); ui.collapsedGroups.delete(`${actor}:${group.id}`); }
          else { ui.collapsedGroups.add(`${actor}:${group.id}`); ui.expandedGroups.delete(`${actor}:${group.id}`); }
          scheduleRender();
        });
      }
      element.dataset.key = key;
      element.dataset.contents = contents;
    }
    if (group.kind === 'background') {
      element.open = group.expanded;
      setText(element.querySelector('summary'), group.title);
    } else if (group.kind === 'combined') {
      const intermediate = element.querySelector('.message-intermediate');
      intermediate.open = group.intermediate.expanded;
      setText(intermediate.querySelector('summary'), group.intermediate.title);
    }
    desired.push(element);
  }
  const previousScroll = container.scrollTop;
  reconcile(container, desired);
  container.dataset.signature = signature;
  container.dataset.actor = actor;
  const saved = previousActor !== actor ? state.scroll.get(actor) : null;
  if (saved && !saved.following) container.scrollTop = saved.top;
  else if (following || previousActor !== actor) requestAnimationFrame(() => { container.scrollTop = followBottom(container); });
  else container.scrollTop = previousScroll;
}
function renderWorkers() {
  const model = ui.workerListPresentation();
  setText($('#worker-list-title'), model.title);
  const list = $('#worker-list');
  const signature = JSON.stringify([model.items, ui.selected, state.dimensions.columns < 80]);
  if (list.dataset.signature !== signature) {
    const old = new Map([...list.children].map(element => [element.dataset.workerId, element]));
    const desired = model.items.map((item, index) => {
      const text = JSON.stringify(item);
      let element = old.get(item.id);
      if (element?.dataset.contents !== text) {
        element = node('div', 'worker-row');
        element.dataset.workerId = item.id;
        element.dataset.contents = text;
        element.id = `worker-${item.id}`;
        element.setAttribute('role', 'option');
        element.append(node('div', 'worker-name'), node('div', 'worker-meta', `  ${item.status} · ${item.description}`), node('div', 'worker-id', '  ' + item.id));
      }
      const compact = state.dimensions.columns < 80;
      setText(element.firstChild, compact ? `${index === ui.selected ? '▶' : ' '} ${item.status} · ${item.title}` : `${index === ui.selected ? '▶' : ' '} ${item.title}`);
      element.setAttribute('aria-selected', String(index === ui.selected));
      return element;
    });
    if (!desired.length) desired.push(node('div', 'dim', '尚无 worker'));
    reconcile(list, desired);
    list.dataset.signature = signature;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  if (ui.worker) list.setAttribute('aria-activedescendant', `worker-${ui.worker.id}`);
  const detail = ui.workerDetailPresentation();
  setText($('#worker-detail-heading'), [detail.title, detail.views, ...detail.metadata].join('\n'));
  const chat = ui.panel === 'chat';
  $('#worker-messages').classList.toggle('hidden', !chat);
  $('#worker-preview').classList.toggle('hidden', chat);
  if (chat && ui.worker) {
    renderConversation($('#worker-messages'), ui.worker.id, workerColumns());
    if (!$('#worker-messages').children.length) setText($('#worker-messages'), '等待 worker 对话…');
  }
  else if (chat) setText($('#worker-messages'), '尚无 worker，Ctrl+Tab 返回 Manager 发送需求。');
  else setText($('#worker-preview'), ui.worker ? ui.preview || '输入 /refresh 加载当前视图。' : '尚无 worker，Ctrl+Tab 返回 Manager 发送需求。');
}
function workerColumns() {
  return Math.max(12, Math.floor($('#worker-messages').clientWidth / state.dimensions.cell) - 2);
}
function renderSettings() {
  const container = $('#settings-view');
  const fields = ui.settingsFieldDefs();
  const signature = JSON.stringify([fields, ui.settingsIndex, ui.settingsEditing]);
  if (container.dataset.signature === signature) return;
  const editorFocused = document.activeElement.id === 'settings-editor';
  const desired = [node('div', 'settings-title', '设置 · 保存后重启生效')];
  fields.forEach((field, index) => {
    const row = node('div', `settings-field${index === ui.settingsIndex ? ' selected' : ''}`);
    row.dataset.setting = field.key;
    row.append(node('span', '', index === ui.settingsIndex ? '▶' : ' '), node('span', '', field.label));
    if (ui.settingsEditing === field.key) {
      let editor = $('#settings-editor');
      if (!editor) { editor = node('textarea'); editor.id = 'settings-editor'; }
      if (editor.value !== (ui.settingsDraft[field.key] || '')) editor.value = ui.settingsDraft[field.key] || '';
      editor.setAttribute('aria-label', field.label);
      row.append(editor);
    } else row.append(node('span', 'settings-value', field.type === 'text' ? field.value || '（空）' : field.value));
    desired.push(row);
  });
  desired.push(node('div', 'settings-hint', '↑↓ 选择 · ←→ 修改 · Enter 编辑/保存 · Ctrl+J 换行 · Ctrl+S 保存 · Esc 取消'));
  container.replaceChildren(...desired);
  container.dataset.signature = signature;
  container.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  if (ui.settingsEditing) { $('#settings-editor').focus(); if (!editorFocused) $('#settings-editor').setSelectionRange($('#settings-editor').value.length, $('#settings-editor').value.length); }
}
function renderInput() {
  const input = $('#composer-input');
  const active = document.activeElement === input;
  if (input.value !== ui.input) {
    input.value = ui.input;
    const position = Array.from(ui.input).slice(0, ui.cursor).join('').length;
    input.setSelectionRange(position, position);
  }
  const maxRows = Math.max(1, Math.floor(state.dimensions.rows / 3));
  const presentation = ui.inputPresentation(state.dimensions.columns, maxRows);
  const ghost = $('#input-ghost');
  const ghostSignature = JSON.stringify(presentation.lines.map(line => [line.plain, line.text]));
  if (ghost.dataset.signature !== ghostSignature) {
    const overlay = document.createDocumentFragment();
    presentation.lines.forEach((line, index) => {
      if (index) overlay.append(document.createTextNode('\n'));
      overlay.append(document.createTextNode(line.text));
      if (ui.input && line.ghost) overlay.append(node('span', 'ghost', line.ghost));
      if (ui.input && line.note) overlay.append(node('span', 'completion-note', line.note));
    });
    ghost.replaceChildren(overlay);
    ghost.dataset.signature = ghostSignature;
  }
  const sizeKey = ui.input + ':' + input.clientWidth + ':' + state.dimensions.line;
  if (input.dataset.sizeKey !== sizeKey) {
    input.style.height = 'auto';
    input.style.height = Math.min(maxRows * state.dimensions.line, Math.max(state.dimensions.line, input.scrollHeight)) + 'px';
    input.dataset.sizeKey = sizeKey;
  }
  ghost.scrollTop = input.scrollTop;
  if (active) input.focus({ preventScroll: true });
}
function renderAttachments() {
  const tray = $('#attachment-tray');
  const signature = JSON.stringify(state.attachments);
  if (tray.dataset.signature === signature) return;
  tray.replaceChildren(...state.attachments.map(attachment => {
    const item = node('div', 'attachment');
    const image = node('img'); image.src = attachment.preview || ''; image.alt = attachment.name;
    const name = node('span', '', attachment.name); name.title = attachment.path;
    const remove = node('button', '', '×'); remove.type = 'button'; remove.title = 'Remove image';
    remove.dataset.removeAttachment = attachment.path;
    item.append(image, name, remove);
    return item;
  }));
  tray.dataset.signature = signature;
}
function renderNative() {
  const { columns, rows } = measure();
  const wide = columns >= 80;
  $('.workers-layout').classList.toggle('compact', !wide);
  $('.workers-layout').style.gridTemplateColumns = wide ? `${Math.min(38, Math.floor(columns * .36)) * state.dimensions.cell}px minmax(0, 1fr)` : '';
  ui.selected = Math.max(0, Math.min(ui.selected, ui.workers.length - 1));
  const header = ui.headerLines(service.state, columns, rows).slice(0, -1).map(line => line.trimEnd()).join('\n');
  setText($('#tui-header'), header);
  $('#tui-header').title = service.projects.map(project => `${project.code ? '-[' + project.code + '] ' : ''}${project.root}${project.active ? ' *' : ''}`).join('\n');
  const auxiliary = ['help', 'request', 'settings'].includes(ui.panel);
  $('#manager-pane').classList.toggle('active', !auxiliary && ui.screen === 'manager');
  $('#workers-pane').classList.toggle('active', !auxiliary && ui.screen === 'workers');
  $('#auxiliary-pane').classList.toggle('active', auxiliary);
  if (auxiliary) {
    $('#auxiliary-preview').classList.toggle('hidden', ui.panel === 'settings');
    $('#settings-view').classList.toggle('hidden', ui.panel !== 'settings');
    if (ui.panel === 'settings') renderSettings();
    else setText($('#auxiliary-preview'), ui.preview);
  } else if (ui.screen === 'manager') renderConversation($('#manager-messages'), 'manager', columns);
  else renderWorkers();
  const requests = ui.pendingRequestLines().slice(0, Math.min(5, Math.max(1, rows - 12)));
  const requestSignature = JSON.stringify(requests);
  if ($('#pending-requests').dataset.signature !== requestSignature) {
    $('#pending-requests').replaceChildren(...requests.map(line => node('div', 'pending-request', line)));
    $('#pending-requests').dataset.signature = requestSignature;
  }
  const queue = ui.queuedMessageLines(service.state, columns, Math.max(1, Math.min(5, Math.floor(rows / 6))));
  $('#pending-queue').classList.toggle('hidden', !queue.length);
  setText($('#pending-queue'), queue.map(line => line.trimEnd()).join('\n'));
  renderInput();
  renderAttachments();
  // The original layout computes the same line counts and available viewport as CLI.
  // Only its notice is read; frame strings are never painted into the DOM or sent over IPC.
  const layout = ui.frame(columns, rows);
  const inputRows = ui.lastInputPresentation.lines.length;
  setText($('#notice'), layout[layout.length - inputRows - 2].trimEnd());
  const scroller = currentScroller();
  scroller.style.setProperty('--tail-padding', `${Math.min(12, Math.max(3, Math.floor(ui.scrollState.height / 3))) * state.dimensions.line}px`);
  document.body.dataset.screen = ui.screen;
  document.body.dataset.panel = ui.panel;
  document.body.dataset.connected = String(state.connected);
  if (document.body.dataset.postedScreen !== ui.screen) {
    post('tabChanged', { tab: ui.screen });
    document.body.dataset.postedScreen = ui.screen;
  }
}
function syncInput() {
  const input = $('#composer-input');
  ui.inputValue = input.value;
  ui.cursor = Array.from(input.value.slice(0, input.selectionEnd)).length;
  ui.inputSelection = input.selectionStart !== input.selectionEnd ? {
    anchor: Array.from(input.value.slice(0, input.selectionStart)).length,
    focus: Array.from(input.value.slice(0, input.selectionEnd)).length
  } : null;
}
async function loadWorkerHistory(force = false) {
  const worker = ui.worker;
  if (ui.screen !== 'workers' || ui.panel !== 'chat' || !worker || (!force && state.historyRequest === worker.id)) return;
  state.historyRequest = worker.id;
  const version = ++state.historyVersion;
  try {
    const result = await api('history', { actor: worker.id, limit: 400 });
    if (version === state.historyVersion) state.histories.set(worker.id, result.events || []);
  } catch (error) { ui.notice = error.message; }
  finally { if (version === state.historyVersion) state.historyRequest = null; scheduleRender(); }
}
async function drainPending() {
  while (state.pending.size) await Promise.allSettled([...state.pending]);
  if (state.commandErrors.length) { ui.notice = state.commandErrors.at(-1).message; state.commandErrors = []; }
}
async function runKey(text, key) {
  const inputFocused = document.activeElement === $('#composer-input');
  const previousPanel = ui.panel;
  const previousWorker = ui.worker?.id;
  try {
    if (key.name === 'return' && !key.ctrl && !['settings'].includes(ui.panel) && !ui.input.startsWith('/') && (!state.connected || state.connectionError)) {
      ui.notice = state.connectionError || '正在连接项目…';
    } else if (ui.input.trim() === '/refresh' && key.name === 'return' && state.connectionError) {
      await api('refresh'); ui.input = ''; ui.notice = '已重新连接';
    } else await ui.key(text, key);
    await drainPending();
    if (ui.worker?.id !== previousWorker || ui.panel !== previousPanel) await loadWorkerHistory();
  } catch (error) { ui.notice = error.message; }
  renderNative();
  if (ui.panel !== 'settings' && (inputFocused || ['f1', 'f2', 'f3', 'f4', 'tab', 'escape'].includes(key.name))) $('#composer-input').focus({ preventScroll: true });
  if (key.name === 'f6' && ui.screen === 'workers') (ui.workerFocus === 'list' ? $('#worker-list') : currentScroller()).focus();
}
function enqueueKey(text, key) {
  const task = runKey(text, key);
  keyChain = Promise.allSettled([keyChain, task]);
  return task;
}
$('#composer-input').addEventListener('input', () => {
  syncInput();
  ui.historyIndex = ui.history.length;
  ui.historyDraft = '';
  ui.notice = '';
  scheduleRender();
  void ui.loadCompletionFiles();
  void ui.loadSkillCompletions();
});
$('#composer-input').addEventListener('scroll', () => { $('#input-ghost').scrollTop = $('#composer-input').scrollTop; });
$('#composer-input').addEventListener('paste', event => {
  const files = clipboardImageFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  void addPastedImages(files);
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.defaultPrevented) return;
  const name = ({ Enter: 'return', Escape: 'escape', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown' })[event.key] || event.key.toLowerCase();
  const key = { name, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, alt: event.altKey };
  const input = $('#composer-input');
  const editing = event.target.id === 'settings-editor';
  if (editing) {
    if (event.ctrlKey && name === 'j') {
      event.preventDefault(); event.target.setRangeText('\n', event.target.selectionStart, event.target.selectionEnd, 'end');
      ui.settingsDraft[ui.settingsEditing] = event.target.value; return;
    }
    if (!['return', 'escape'].includes(name) && !(event.ctrlKey && name === 's')) return;
  }
  if (ui.panel === 'settings') {
    if (!editing && event.target !== input && !['up', 'down', 'left', 'right', 'return', 'escape'].includes(name) && !(key.ctrl && name === 's')) return;
    event.preventDefault();
    void enqueueKey('', key);
    return;
  }
  if (event.target === input) syncInput();
  if (key.ctrl && name === 'q') {
    const selected = window.getSelection()?.toString();
    if (selected) {
      event.preventDefault();
      const quote = selected.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      input.setRangeText(quote, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); return;
    }
  }
  if (key.ctrl && name === 'c') {
    const selected = window.getSelection()?.toString() || input.value.slice(input.selectionStart, input.selectionEnd);
    if (selected) return;
    event.preventDefault(); ui.notice = 'Ctrl+C 不退出 TUI；使用 /quit 或 Ctrl+D 退出'; scheduleRender(); return;
  }
  if ((key.ctrl || key.meta) && ['v', 'a', 'x', 'z', 'y'].includes(name)) return;
  const nativeEditing = event.target === input && (
    (!key.ctrl && !key.alt && !key.meta && (event.key.length === 1 || ['backspace', 'delete', 'home', 'end'].includes(name))) ||
    (ui.input && ['left', 'right'].includes(name) && !key.ctrl)
  );
  if (nativeEditing) return;
  const handled = ['return', 'escape', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'].includes(name)
    || name === 'tab' || (key.ctrl && ['p', 'n', 'u', 'q', 'd'].includes(name))
    || ((key.ctrl && ['home', 'end'].includes(name))) || (event.target !== input && !key.ctrl && !key.alt && event.key.length === 1);
  if (!handled) return;
  event.preventDefault();
  if (key.ctrl && ['home', 'end'].includes(name)) {
    ui.scrollTo(name === 'home' ? 'top' : 'bottom'); scheduleRender(); return;
  }
  void enqueueKey(event.key.length === 1 && !key.ctrl && !key.alt ? event.key : '', key);
});
document.addEventListener('input', event => {
  if (event.target.id === 'settings-editor' && ui.settingsEditing) ui.settingsDraft[ui.settingsEditing] = event.target.value;
});
$('#settings-view').addEventListener('click', event => {
  const row = event.target.closest('[data-setting]');
  if (!row || ui.settingsEditing) return;
  ui.settingsIndex = ui.settingsFieldDefs().findIndex(field => field.key === row.dataset.setting);
  scheduleRender();
});
$('#worker-list').addEventListener('click', event => {
  const row = event.target.closest('[data-worker-id]');
  if (!row) return;
  ui.selected = ui.workers.findIndex(worker => worker.id === row.dataset.workerId);
  ui.workerFocus = 'list';
  void ui.refresh().then(() => loadWorkerHistory()).then(scheduleRender);
});
document.addEventListener('click', event => {
  const link = event.target.closest('[data-external]');
  if (link) { event.preventDefault(); post('openExternal', { url: link.dataset.external }); }
  const remove = event.target.closest('[data-remove-attachment]');
  if (remove) post('removeAttachment', { path: remove.dataset.removeAttachment });
});
document.querySelectorAll('.message-scroll, .content-preview').forEach(element => element.addEventListener('scroll', () => {
  if (element === currentScroller()) { scrollMetrics(); setText($('#notice'), fit(ui.notice || ui.scrollHint() + ' | Enter → Manager · Shift+Enter → 换行', state.dimensions.columns).trimEnd()); }
}, { passive: true }));
window.addEventListener('resize', () => { ui.conversationCache.clear(); scheduleRender(); });
window.addEventListener('focus', () => post('focusChanged', { focused: true }));
window.addEventListener('blur', () => post('focusChanged', { focused: false }));
document.addEventListener('visibilitychange', () => post('focusChanged', { focused: !document.hidden }));
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'apiResult') {
    const pending = requestQueue.get(message.id); requestQueue.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
    return;
  }
  if (message.type === 'state') {
    const previousConfig = JSON.stringify(state.config);
    const wasConnected = state.connected;
    if (message.status?.project_root && state.projectRoot && message.status.project_root !== state.projectRoot) {
      state.histories.clear(); state.scroll.clear(); state.historyVersion++;
      state.historyRequest = null; state.runtime = null;
    }
    if (!state.connected && (ui.notice === '正在连接项目…' || ui.notice === state.connectionError)) ui.notice = '';
    state.snapshot = message.status?.snapshot || state.snapshot;
    state.snapshot.manager ||= { pending: [], active: [] };
    state.snapshot.approvals ||= []; state.snapshot.questions ||= [];
    state.config = { ...DEFAULT_CONFIG, ...(message.status?.config || state.config) };
    state.projectRoot = message.status?.project_root || state.projectRoot;
    state.projects = message.projects || state.projects;
    if (message.history) state.histories.set('manager', message.history);
    const previews = new Map(state.attachments.map(item => [item.path, item.preview]));
    state.attachments = (message.attachments || state.attachments).map(item => ({ ...item, preview: item.preview || previews.get(item.path) }));
    state.connected = true; state.connectionError = '';
    if (!wasConnected || previousConfig !== JSON.stringify(state.config)) ui.settings = { ...state.config };
    if (!state.runtime) void api('version').then(info => { state.runtime = info; LastOrderUI.setRuntime(info); }).catch(error => { ui.notice = error.message; });
    scheduleRender(); void loadWorkerHistory(); return;
  }
  if (message.type === 'attachments') { state.attachments = message.attachments || []; scheduleRender(); }
  if (message.type === 'toast') { ui.notice = message.message; scheduleRender(); }
  if (message.type === 'fatal') { state.connectionError = message.message; state.connected = false; ui.notice = message.message; scheduleRender(); }
  if (message.type === 'switchTab') void ui.showPanel(message.tab === 'manager' ? 'manager' : ui.workerPanel).then(() => loadWorkerHistory()).then(scheduleRender);
  if (message.type === 'openWorker') {
    ui.selected = Math.max(0, ui.workers.findIndex(worker => worker.id === message.workerId));
    void ui.showPanel('chat').then(() => loadWorkerHistory()).then(scheduleRender);
  }
});
ui.notice = '正在连接项目…';
renderNative();
post('ready');
