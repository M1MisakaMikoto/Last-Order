// Presentation only: the original event log stays intact for inspection/resume.
export function conversationGroups(events) {
  const groups = [];
  for (const [index, event] of events.entries()) {
    if (!['message', 'manager_input', 'worker_input', 'progress', 'reported_result'].includes(event.type)) continue;
    const role = event.data.role;
    const foreground = ['manager_input', 'worker_input', 'reported_result'].includes(event.type) || ['user', 'question', 'error', 'warning'].includes(role);
    const background = !foreground && (event.data.background || role === 'tool' || event.type === 'progress');
    if (background) {
      const previous = groups.at(-1);
      if (previous?.kind === 'background') previous.events.push(event);
      else groups.push({ kind: 'background', id: String(event.seq ?? index), events: [event] });
    } else groups.push({ kind: 'message', event });
  }
  return groups;
}

export function eventText(event) {
  return `[${event.data.role ?? event.type}] ${eventContent(event)}`;
}

function pretty(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function toolName(event) {
  return event.data.tool?.name ?? event.data.tool?.type;
}

export function eventContent(event) {
  const data = event.data;
  if (data.tool) {
    const tool = data.tool, parts = [];
    if (tool.arguments !== null && tool.arguments !== undefined) parts.push('参数：\n' + pretty(tool.arguments));
    if (tool.exitCode !== null && tool.exitCode !== undefined) parts.push('退出码：' + tool.exitCode);
    if (tool.durationMs !== null && tool.durationMs !== undefined) parts.push('耗时：' + tool.durationMs + ' ms');
    if (tool.result !== null && tool.result !== undefined) parts.push('结果：\n' + pretty(tool.result));
    if (tool.error !== null && tool.error !== undefined) parts.push('错误：\n' + pretty(tool.error));
    if (tool.changes && (tool.result === null || tool.result === undefined)) parts.push('文件变更：\n' + pretty(tool.changes));
    return parts.length ? parts.join('\n\n') : String(data.text ?? '');
  }
  const text = data.text ?? data.message ?? data.summary ?? JSON.stringify(data, null, 2);
  return event.type === 'reported_result' ? `${data.status}\n${text}${data.evidence ? '\n\n验证证据：\n' + data.evidence : ''}` : text;
}
