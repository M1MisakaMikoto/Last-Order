import { stripVTControlCharacters } from 'node:util';
import { conversationGroups, eventContent, toolName } from './conversation.js';
import { renderMarkdown, styledWidth } from './markdown.js';

export const clean = text => stripVTControlCharacters(String(text)).replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
export const width = char => /\p{Mark}/u.test(char) ? 0 : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]/u.test(char) ? 2 : 1;
export function fit(text, columns) {
  let used = 0, result = '';
  for (const char of clean(text).replace(/\n/g, ' ')) {
    if (used + width(char) > columns) break;
    result += char; used += width(char);
  }
  return result + ' '.repeat(Math.max(0, columns - used));
}
export function wrap(text, columns) {
  columns = Math.max(1, columns);
  const lines = [];
  for (const paragraph of clean(text).split('\n')) {
    let line = '', used = 0;
    for (const char of paragraph) {
      const size = width(char);
      if (used + size > columns) { lines.push(line); line = ''; used = 0; }
      line += char; used += size;
    }
    lines.push(line);
  }
  return lines;
}
export function border(title, columns, left = '╭', right = '╮') {
  return left + fit(title ? '─ ' + title + ' ' : '', columns - 2).replace(/ +$/, spaces => '─'.repeat(spaces.length)) + right;
}
function messageBox(title, text, columns) {
  const inside = Math.max(1, columns - 6);
  const content = renderMarkdown(text, inside).map(line => {
    const padding = Math.max(0, inside - styledWidth(line));
    return '│  ' + line + ' '.repeat(padding) + '  │';
  });
  return [border(title, columns), ...content, border('', columns, '╰', '╯'), ''];
}
export function messageLabel(event, actor) {
  const role = event.data.role ?? ({ manager_input: 'user', worker_input: event.data.source === 'manager' ? 'manager' : 'user', reported_result: 'result', progress: 'progress' })[event.type];
  const tool = event.data.tool;
  const status = { running: '运行中', started: '运行中', inProgress: '运行中', in_progress: '运行中', completed: '完成', succeeded: '成功', failed: '失败', error: '错误', cancelled: '已取消' }[tool?.status] ?? tool?.status;
  const label = tool
    ? `工具 · ${tool.name ?? tool.type ?? 'call'}${status ? ' · ' + status : ''}${tool.id ? ' · ' + String(tool.id).slice(-8) : ''}`
    : { user: '用户', assistant: actor === 'manager' ? 'Manager' : 'Worker', manager: 'Manager → Worker', tool: '工具', question: '需要答复', error: '错误', warning: '提示', result: '任务结果', progress: '进度', system: '系统' }[role] ?? role ?? event.type;
  const time = event.time ? new Date(event.time) : null;
  return label + (event.seq ? ` · #${event.seq}` : '') + (time && !Number.isNaN(time.valueOf()) ? ' · ' + time.toLocaleTimeString('zh-CN', { hour12: false }) : '');
}

export function renderConversation(events, actor, columns, options = {}) {
  if (!actor) return [];
  const expandedActors = options.expandedActors ?? new Set();
  const expandedGroups = options.expandedGroups ?? new Set();
  const collapsedGroups = options.collapsedGroups ?? new Set();
  let number = 0;
  const lines = conversationGroups(events).flatMap(group => {
    if (group.kind === 'message') return messageBox(messageLabel(group.event, actor), eventContent(group.event), columns);
    number++;
    const key = actor + ':' + group.id;
    const expanded = !collapsedGroups.has(key) && (expandedActors.has(actor) || expandedGroups.has(key));
    const names = [...new Set(group.events.map(toolName).filter(Boolean))].slice(0, 4);
    const title = `${expanded ? '−' : '+'} 后台过程 #${number} · ${group.events.length} 条${names.length ? ' · ' + names.join('/') : ''}`;
    const content = expanded
      ? group.events.map(event => `${messageLabel(event, actor)}\n${String(eventContent(event)).split('\n').map(line => '  ' + line).join('\n')}`).join('\n\n') + `\n\n/collapse ${number} 收起`
      : `已折叠 · /expand ${number} 展开 · F5 展开全部`;
    return messageBox(title, content, columns);
  });
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
