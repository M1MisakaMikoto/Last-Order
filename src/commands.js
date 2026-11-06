export const COMMANDS = [
  { name: 'help', description: '查看帮助' },
  { name: 'version', description: '查看 Last Order、Mission Control、provider 与运行平台版本' },
  { name: 'reload', description: '快速重启 Last Order 并应用最新配置' },
  { name: 'settings', description: '配置启动参数，保存后重启生效' },
  { name: 'monitor', usage: '[worker_id]', description: '在独立窗口监视 worker', args: 'worker' },
  { name: 'manager', description: '打开 Manager 对话' },
  { name: 'workers', usage: '[all]', description: '打开 Worker 列表；all 一次性显示已归档 worker', args: 'text' },
  { name: 'archive', usage: '[worker_id|all]', description: '在 Workers 页面归档停止的 worker，all 批量归档', args: 'text' },
  { name: 'quote', usage: '[actor:]#seq 指令', description: '引用 Manager 或 Worker 历史消息并发送给 Manager', args: 'text', required: true },
  { name: 'interrupt', usage: '[消息]', description: '中止 Manager 当前工作；带消息时优先处理新消息', args: 'text' },
  { name: 'memory', usage: 'status|clear', description: '查看或清空 Manager 原生会话', args: 'text' },
  { name: 'skills', usage: '[manager|worker_id]', description: '列出当前 Codex 会话可见的 skills', args: 'worker' },
  { name: 'w', description: '打开 Workers 界面' },
  { name: 'msg', usage: 'worker_id 消息', description: '向指定 worker 发消息，操作同步给 manager', args: 'worker-message', required: true },
  { name: 'pause', description: '暂停选中 worker', worker: true },
  { name: 'resume', description: '恢复选中 worker', worker: true },
  { name: 'cancel', description: '取消选中 worker', worker: true },
  { name: 'retry', usage: '[原因]', description: '重试选中 worker', args: 'text', worker: true },
  { name: 'select', usage: 'worker_id', description: '选中 worker 并打开详情', args: 'worker', required: true },
  { name: 'open', usage: '相对路径', description: '查看 worker 的文件或目录', args: 'path', worker: true },
  { name: 'back', description: '工作区上一级目录', worker: true },
  { name: 'diff', usage: 'task|uncommitted', description: '查看累计或未提交改动', args: 'diff', required: true, worker: true },
  { name: 'refresh', description: '刷新当前工作区或 Git' },
  { name: 'approval', usage: 'approval_id', description: '查看完整审批请求', args: 'approval', required: true },
  { name: 'approve', usage: 'approval_id', description: '批准一次权限请求', args: 'approval', required: true },
  { name: 'deny', usage: 'approval_id', description: '拒绝权限请求', args: 'approval', required: true },
  { name: 'question', usage: 'question_id', description: '查看待答问题', args: 'question', required: true },
  { name: 'answer', usage: 'question_id 答复', description: '回答待答问题', args: 'question', required: true },
  { name: 'expand', usage: '[组号|all]', description: '展开后台过程', args: 'group' },
  { name: 'collapse', usage: '[组号|all]', description: '折叠后台过程', args: 'group' },
  { name: 'quit', description: '只退出 TUI，后台任务继续运行' },
  { name: 'shutdown', description: '关闭 TUI 和整个 Last Order 后台任务' }
  ,
  { name: 'checkpoint', usage: '[名称]', description: '创建 workspace 与原生会话 checkpoint', args: 'text' },
  { name: 'checkpoints', description: '列出 Last Order checkpoints' },
  { name: 'restore', usage: 'id [files|conversation|all] confirm', description: '恢复 checkpoint；需要 confirm 二次确认', args: 'text', required: true },
  { name: 'turns', usage: '[manager|worker_id]', description: '列出原生会话 turns', args: 'worker' },
  { name: 'fork', usage: 'turn_id [manager|worker_id]', description: '从原生 turn fork 对话', args: 'text', required: true },
  { name: 'revert', usage: 'turn_id --yes [manager|worker_id]', description: '删除 turn 及后续历史，不改文件', args: 'text', required: true }
];

export const commandUsage = command => '/' + command.name + (command.usage ? ' ' + command.usage : '');
export const MEMORY_ACTIONS = [
  { value: 'status', description: '查看当前 Manager native thread' },
  { value: 'clear', description: '清空 Manager 记忆并开启新的 native 会话' }
];
export function fileQuery(input) {
  const match = /^\/open\s+(.*)$/is.exec(input);
  if (!match) return null;
  const token = match[1].replaceAll('\\', '/'), slash = token.lastIndexOf('/');
  return { directory: token.slice(0, slash + 1), prefix: token.slice(slash + 1) };
}

export function commandCompletions(input, context = {}) {
  if (/^-[A-Za-z]{0,2}$/.test(input)) {
    const prefix = input.slice(1).toLowerCase();
    const items = (context.projects ?? [])
      .filter(project => project.code.toLowerCase().startsWith(prefix))
      .map(project => ({
        value: '-' + project.code + ' ',
        label: '-[' + project.code + ']',
        description: project.root + (project.active ? ' · 当前项目' : '')
      }));
    return { items, hint: items.length ? '↑↓ 选择项目 · Tab 填入 · Esc 收起' : '没有匹配的项目' };
  }
  if (input.includes('$')) {
    const skillMatch = /^(.*?)\$([^\s]*)$/s.exec(input);
    if (!skillMatch) return { items: [], hint: '' };
    const [, before, prefix] = skillMatch;
    const skills = context.skills ?? [];
    const items = skills
      .filter(skill => skill.enabled !== false && skill.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(skill => ({
        value: before + '$' + skill.name + ' ',
        label: '$' + skill.name,
        description: skill.description + (skill.scope ? ` · ${skill.scope}` : '')
      }));
    return { items, hint: context.skillHint || (items.length ? '↑↓ 选择 skill · Tab 填入 · Esc 收起' : '没有匹配的 skill') };
  }
  if (!input.startsWith('/')) return { items: [], hint: '' };
  const match = /^\/(\S*)(?:\s+(.*))?$/s.exec(input);
  if (!match) return { items: [], hint: '输入 /help 查看命令' };
  const [, name, argument] = match;
  const command = COMMANDS.find(c => c.name === name.toLowerCase());
  const description = c => c.description + (c.worker ? context.worker ? ` · ${context.worker.id}` : ' · 需先选择 worker' : '');
  if (argument === undefined) {
    const items = COMMANDS.filter(c => c.name.startsWith(name.toLowerCase()))
      .sort((a, b) => Number(b.name === name.toLowerCase()) - Number(a.name === name.toLowerCase()))
      .map(c => ({ value: '/' + c.name + (c.args ? ' ' : ''), label: commandUsage(c), description: description(c) }));
    return { items, command, hint: items.length ? '↑↓ 选择 · Tab 填入 · Esc 收起' : '没有匹配命令，输入 /help 查看帮助' };
  }
  if (!command) return { items: [], hint: '未知命令，输入 /help 查看帮助' };
  const hint = commandUsage(command) + ' · ' + description(command);
  const prefix = argument.toLowerCase(), values = [];
  if (command.name === 'msg') {
    const target = input.replace(/^\/msg\s*/i, '');
    if (!/\s/.test(target)) {
      const items = (context.workers ?? [])
        .filter(worker => worker.id.toLowerCase().startsWith(target.toLowerCase()))
        .map(worker => ({
          value: '/msg ' + worker.id + ' ',
          label: worker.id,
          description: `${worker.provider ?? ''} / ${worker.kind ?? ''} · ${worker.status ?? ''} · ${worker.title ?? context.pipelines?.[worker.pipelineId]?.title ?? ''}`
        }));
      return { command, hint, items };
    }
    return { command, hint, items: [] };
  }
  if (command.name === 'memory') {
    const items = MEMORY_ACTIONS.filter(item => item.value.startsWith(prefix)).map(item => ({
      value: '/memory ' + item.value,
      label: item.value,
      description: item.description
    }));
    return { command, hint, items };
  }
  if (command.args === 'worker') for (const worker of context.workers ?? []) values.push({ value: worker.id, description: `${worker.provider ?? ''} / ${worker.kind ?? ''} · ${worker.status ?? ''} · ${worker.title ?? context.pipelines?.[worker.pipelineId]?.title ?? ''}` });
  if (['approval', 'question'].includes(command.args) && !/\s/.test(argument)) {
    const requests = command.args === 'approval' ? context.approvals ?? [] : context.questions ?? [];
    for (const request of requests) values.push({ value: request.id, description: `[${request.actor}] ${request.detail?.reason ?? request.detail?.command ?? request.detail?.question ?? ''}` });
  }
  if (command.args === 'diff') values.push({ value: 'task', description: '自任务基础版本以来的累计改动' }, { value: 'uncommitted', description: '当前未提交改动' });
  if (command.args === 'group') {
    values.push({ value: 'all', description: '当前对话的全部后台过程' });
    for (let i = 0; i < (context.groups ?? []).length; i++) values.push({ value: String(i + 1), description: `后台过程 · ${context.groups[i].events.length} 条记录` });
  }
  if (command.args === 'path') {
    const query = fileQuery(input);
    const items = (context.files ?? []).filter(file => !file.symlink && file.name.toLowerCase().startsWith(query.prefix.toLowerCase())).map(file => ({
      value: '/open ' + query.directory + file.name + (file.directory ? '/' : ''),
      label: file.name + (file.directory ? '/' : ''), description: file.directory ? '目录' : '文件'
    }));
    return { command, hint: hint + (context.fileHint ? ' · ' + context.fileHint : ''), items };
  }
  const items = values.filter(value => value.value.toLowerCase().startsWith(prefix)).map(value => ({
    ...value, label: value.value, value: '/' + command.name + ' ' + value.value + (command.name === 'answer' ? ' ' : '')
  }));
  const emptyHint = command.args === 'approval' && !values.length ? ' · 当前无待审批请求'
    : command.args === 'question' && !values.length && !/\s/.test(argument) ? ' · 当前无待答问题' : '';
  return { command, hint: hint + emptyHint, items };
}
