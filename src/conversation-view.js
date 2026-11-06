import { stripVTControlCharacters } from 'node:util';
import { conversationGroups, eventContent, toolName } from './conversation.js';
import { renderMarkdown, styledWidth } from './markdown.js';

const USER_MESSAGE_BORDER = '\x1b[38;5;214m';
const RESET = '\x1b[0m';

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

export function fitStyled(text, columns) {
  const source = String(text ?? '').replace(/\r?\n/g, ' ');
  const escapePattern = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\]8;;[^\x07\x1b]*(?:\x07|\x1b\\))/g;
  let used = 0, result = '', last = 0, match, hasStyle = false, linkOpen = false;
  const appendPlain = value => {
    for (const char of value) {
      const size = width(char);
      if (used + size > columns) return false;
      result += char; used += size;
    }
    return true;
  };
  while ((match = escapePattern.exec(source))) {
    if (!appendPlain(source.slice(last, match.index))) break;
    const escape = match[0];
    result += escape; hasStyle = true;
    if (escape.startsWith('\x1b]8;;')) linkOpen = !escape.startsWith('\x1b]8;;\x1b\\');
    last = escapePattern.lastIndex;
  }
  if (last < source.length) appendPlain(source.slice(last));
  if (hasStyle) {
    result += '\x1b[0m';
    if (linkOpen) result += '\x1b]8;;\x1b\\';
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
function boxedLines(text, inside) {
  return renderMarkdown(text, inside).map(line => {
    const padding = Math.max(0, inside - styledWidth(line));
    return '│  ' + line + ' '.repeat(padding) + '  │';
  });
}
function messageBox(title, text, columns, borderColor = '', intermediate = null) {
  const inside = Math.max(1, columns - 6);
  const color = line => borderColor ? borderColor + line + RESET : line;
  const lines = [];
  if (intermediate) {
    lines.push(color(border(intermediate.title, columns)));
    if (intermediate.expanded) lines.push(...boxedLines(intermediate.expandedContent, inside));
    lines.push('├' + '─'.repeat(Math.max(0, columns - 2)) + '┤');
    lines.push(...boxedLines(`${title}\n${text}`, inside));
  } else {
    lines.push(color(border(title, columns)));
    lines.push(...boxedLines(text, inside));
  }
  lines.push(color(border('', columns, '╰', '╯')), '');
  return lines;
}
export function messageLabel(event, actor) {
  const role = event.data.role ?? ({ manager_input: 'user', worker_input: event.data.source === 'manager' ? 'manager' : 'user', reported_result: 'result', progress: 'progress' })[event.type];
  const tool = event.data.tool;
  const status = { running: '运行中', started: '运行中', inProgress: '运行中', in_progress: '运行中', completed: '完成', succeeded: '成功', failed: '失败', error: '错误', cancelled: '已取消' }[tool?.status] ?? tool?.status;
  const label = tool
    ? `工具 · ${tool.name ?? tool.type ?? 'call'}${status ? ' · ' + status : ''}${tool.id ? ' · ' + String(tool.id).slice(-8) : ''}`
    : { user: '用户', assistant: actor === 'manager' ? 'Manager' : 'Worker', manager: 'Manager → Worker', tool: '工具', question: '需要答复', error: '错误', warning: '提示', result: '任务结果', progress: '进度', system: '系统' }[role] ?? role ?? event.type;
  const time = event.time ? new Date(event.time) : null;
  return label + (event.seq ? ` · #${event.seq}` : '') + (time && !Number.isNaN(time.valueOf()) ? ' · ' + time.toLocaleTimeString('zh-CN', { hour12: false }) : '') + (event.data.streaming ? ' · 生成中' : '');
}

export function conversationPresentation(events, actor, options = {}) {
  if (!actor) return [];
  const expandedActors = options.expandedActors ?? new Set();
  const expandedGroups = options.expandedGroups ?? new Set();
  const collapsedGroups = options.collapsedGroups ?? new Set();
  let number = 0;
  const presented = conversationGroups(events).map(group => {
    if (group.kind === 'message') return { ...group, title: messageLabel(group.event, actor), content: eventContent(group.event) };
    number++;
    const key = actor + ':' + group.id;
    const expanded = !collapsedGroups.has(key) && (expandedActors.has(actor) || expandedGroups.has(key));
    const names = [...new Set(group.events.map(toolName).filter(Boolean))].slice(0, 4);
    const assistantOnly = group.events.every(event => event.data.role === 'assistant');
    const title = `${expanded ? '−' : '+'} ${assistantOnly ? '中间回复' : '后台过程'} #${number} · ${group.events.length} 条${names.length ? ' · ' + names.join('/') : ''}`;
    const expandedContent = group.events.map(event => `${messageLabel(event, actor)}\n${String(eventContent(event)).split('\n').map(line => '  ' + line).join('\n')}`).join('\n\n') + `\n\n/collapse ${number} 收起`;
    const collapsedContent = `已折叠 · /expand ${number} 展开 · F5 展开全部`;
    return { ...group, title, number, expanded, expandedContent, collapsedContent, content: expanded ? expandedContent : collapsedContent };
  });
  const combined = [];
  for (let index = 0; index < presented.length; index++) {
    const group = presented[index], next = presented[index + 1];
    const assistantOnly = group.kind === 'background' && group.events.every(event => event.data.role === 'assistant');
    if (assistantOnly && next?.kind === 'message' && next.event.data.role === 'assistant') {
      combined.push({
        kind: 'combined', id: next.event.seq ?? next.id,
        event: next.event, title: next.title, content: next.content,
        number: group.number, intermediate: group
      });
      index++;
    } else combined.push(group);
  }
  return combined;
}

export function renderConversation(events, actor, columns, options = {}) {
  const lines = conversationPresentation(events, actor, options).flatMap(group => messageBox(
    group.title, group.content, columns,
    group.kind === 'message' && group.event.data.role === 'user' ? USER_MESSAGE_BORDER : '',
    group.kind === 'combined' ? group.intermediate : null
  ));
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
