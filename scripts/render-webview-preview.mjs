import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtimeBuilder from '../vscode-extension/ui-runtime.cjs';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(root, 'vscode-extension', 'webview');
const out = path.join(root, '.tmp');
await mkdir(out, { recursive: true });

const [template, css, app, manifest] = await Promise.all([
  readFile(path.join(webview, 'manager.html'), 'utf8'),
  readFile(path.join(webview, 'style.css'), 'utf8'),
  readFile(path.join(webview, 'app.js'), 'utf8'),
  readFile(path.join(root, 'vscode-extension', 'package.json'), 'utf8').then(JSON.parse)
]);

const now = new Date().toISOString();
const managerHistory = [
  { seq: 1, time: now, type: 'manager_input', data: { role: 'user', text: '实现一个简单的计算器，并给移动端做一版交互预览。' } },
  { seq: 2, time: now, type: 'message', data: { role: 'assistant', text: '我会把实现和独立验收拆成两个 worker，并保持需求判断与最终验收由 manager 负责。' } },
  { seq: 3, time: now, type: 'message', data: { role: 'tool', text: 'start_worker', tool: { name: 'start_worker', arguments: { title: 'Calculator UI', kind: 'implement' }, result: { worker_id: 'worker_a1' } } } },
  { seq: 4, time: now, type: 'message', data: { role: 'assistant', text: '实现 worker 已启动，正在独立 worktree 中开发。' } },
  { seq: 5, time: now, type: 'message', data: { role: 'tool', text: 'worker finished', tool: { name: 'inspect_worker', arguments: { id: 'worker_a1' }, result: { status: 'succeeded' } } } },
  { seq: 6, time: now, type: 'reported_result', data: { status: 'succeeded', summary: '计算器主流程已完成', evidence: 'unit tests: 12 passed' } },
  { seq: 7, time: now, type: 'message', data: { role: 'assistant', text: '初版实现已完成。验收 worker 正在检查除零、键盘输入和窄屏布局。' } }
];

const workerHistory = [
  { seq: 11, time: now, type: 'worker_input', data: { role: 'user', text: '实现计算器并运行验证。' } },
  { seq: 12, time: now, type: 'message', data: { role: 'assistant', text: '先检查仓库结构，然后实现自包含页面。' } },
  { seq: 13, time: now, type: 'message', data: { role: 'tool', text: 'command execution', tool: { name: 'commandExecution', arguments: { command: 'npm test' }, result: '12 tests passed', exitCode: 0, durationMs: 1200 } } },
  { seq: 14, time: now, type: 'reported_result', data: { status: 'succeeded', summary: '计算器实现并验证完成', evidence: '12 tests passed; browser smoke checked' } }
];

const status = {
  snapshot: {
    workers: {
      worker_a1: { id: 'worker_a1', title: 'Calculator UI', provider: 'codex', model: 'deepseek-flash', effort: 'high', kind: 'implement', status: 'running', pipelineId: 'p1', workspace: '/workspace/worktrees/worker_a1', notes: ['Check mobile layout'] },
      worker_b2: { id: 'worker_b2', title: 'Adversarial review', provider: 'codex', kind: 'review', status: 'queued', pipelineId: 'p2', workspace: '/workspace/worktrees/worker_b2' }
    },
    pipelines: { p1: { title: 'Calculator UI' }, p2: { title: 'Adversarial review' } },
    requests: {}, notifications: [],
    manager: { active: [], pending: [{ id: 'm2', text: '再检查一下手机横屏布局', queued: true }], memoryEpoch: 0, sessionId: 'thread-demo' },
    approvals: [{ id: 'approval_demo', actor: 'worker_a1', detail: { reason: '允许运行无头浏览器测试以检查计算器布局' } }],
    questions: [],
    managerBusy: false,
    managerError: null
  },
  config: { manager: 'codex', worker: 'codex', managerModel: 'deepseek-flash', managerEffort: 'high', workerModel: 'deepseek-flash', workerEffort: 'high', codexApprovals: 'auto_review', silenceMs: 600000 },
  project_root: '/workspace/rebuildv3/AgentSupport'
};
const projects = [
  { code: 'A', name: 'AgentSupport', root: '/workspace/rebuildv3/AgentSupport', active: true, connected: true, error: null },
  { code: 'B', name: 'MobilePreview', root: '/workspace/mobile-preview', active: false, connected: false, error: null }
];

const mock = `
const previewStatus = ${JSON.stringify(status)};
const previewManagerHistory = ${JSON.stringify(managerHistory)};
const previewWorkerHistory = ${JSON.stringify(workerHistory)};
const previewProjects = ${JSON.stringify(projects)};
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'default';
const theme = params.get('theme') || 'dark';
document.body.classList.add('vscode-' + theme);
const themes = {
  light: { 'editor-background': '#ffffff', 'editor-foreground': '#242424', 'descriptionForeground': '#616161', 'panel-border': '#e5e5e5', 'sideBar-background': '#f8f8f8', 'editorWidget-background': '#ffffff', 'input-background': '#f4f4f4', 'input-foreground': '#242424', 'textCodeBlock-background': '#f4f4f4', 'textLink-foreground': '#006ab1' },
  'high-contrast': { 'editor-background': '#000000', 'editor-foreground': '#ffffff', 'descriptionForeground': '#ffffff', 'contrastBorder': '#ffffff', 'panel-border': '#ffffff', 'sideBar-background': '#000000', 'editorWidget-background': '#000000', 'input-background': '#000000', 'input-foreground': '#ffffff', 'focusBorder': '#f38518' }
};
for (const [name, value] of Object.entries(themes[theme] || {})) document.documentElement.style.setProperty('--vscode-' + name, value);
if (params.has('font')) document.documentElement.style.setProperty('--vscode-font-size', params.get('font') + 'px');
if (['empty', 'connecting', 'fatal', 'idle'].includes(scenario)) {
  previewManagerHistory.length = 0;
  previewStatus.snapshot.workers = {};
  previewStatus.snapshot.approvals = [];
  previewStatus.snapshot.manager.pending = [];
}
if (scenario === 'idle') {
  previewStatus.project_root = 'D:/workspaces/SA';
  previewProjects.splice(0, previewProjects.length, { code: 'A', name: 'SA', root: 'D:/workspaces/SA', active: true, connected: true });
}
if (scenario === 'no-hints') previewStatus.config.showShortcutHints = false;
if (scenario === 'projects') {
  for (let index = 2; index < 6; index++) previewProjects.push({ code: String.fromCharCode(65 + index), root: '/workspace/project-' + index, name: 'project-' + index, active: false });
}
if (scenario === 'worker-empty') previewWorkerHistory.length = 0;
if (scenario === 'no-workspace') delete previewStatus.snapshot.workers.worker_a1.workspace;
if (scenario === 'archived') previewStatus.snapshot.workers.worker_b2.archivedAt = '${now}';
if (scenario === 'worker-mixed') {
  previewStatus.snapshot.workers.worker_b2.status = 'failed';
  for (const [index, status] of ['paused', 'succeeded', 'interrupted', 'review_failed', 'waiting_approval'].entries()) {
    const id = 'worker_extra_' + index;
    previewStatus.snapshot.workers[id] = { id, title: '任务 ' + index, status, provider: 'codex', model: 'test-model', effort: 'high', kind: 'review', workspace: '/workspace/' + id };
  }
}
if (scenario === 'epoch') {
  previewStatus.snapshot.manager.memoryEpoch = 1;
  previewManagerHistory.push({ seq: 100, type: 'message', data: { role: 'assistant', memoryEpoch: 1, text: '当前 epoch 的对话' } });
}
if (scenario === 'long-prompt') previewStatus.config.managerPrompt = '保留原来的工作规范与验收要求。\\n'.repeat(40);
if (scenario === 'busy') {
  previewStatus.snapshot.managerBusy = true;
  previewStatus.snapshot.manager.active = ['m1'];
}
if (scenario === 'interrupted') previewStatus.snapshot.manager.hold = true;
if (scenario === 'error') previewStatus.snapshot.managerError = 'Provider connection lost. Refresh or send a new request to continue.';
if (scenario === 'long') {
  for (let i = 0; i < 80; i++) previewManagerHistory.push({ seq: 100 + i, time: '${now}', type: 'message', data: { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'Checked src/core/control-server.js and the worker conversation.\\n\\nThe update is ready for review.\\n\\n\`\`\`js\\nconst ready = true;\\n\`\`\`' : 'Continue checking the next state, including very-long-file-and-project-names-that-must-wrap-within-the-conversation.' } });
}
if (scenario === 'approvals') {
  previewStatus.snapshot.approvals.push({ id: 'approval_long', actor: 'manager', detail: { command: 'node scripts/verify-layout.mjs --project /workspace/a-very-long-project-name '.repeat(12) } });
}
if (scenario === 'questions') {
  previewStatus.snapshot.approvals = [];
  previewStatus.snapshot.questions = [{ id: 'question_1', actor: 'manager', detail: { question: 'Which layout should the mobile calculator use?' } }, { id: 'question_2', actor: 'worker_b2', detail: { question: 'Should keyboard shortcuts be included? '.repeat(8) } }];
}
window.__previewMessages = [];
let previewAttachments = [];
window.addEventListener('error', event => {
  document.body.dataset.error = JSON.stringify({ message: event.message, line: event.lineno, column: event.colno });
});
window.acquireVsCodeApi = () => ({
  postMessage(message) {
    window.__previewMessages.push(message);
    if (message.type === 'pasteImages') {
      previewAttachments = (message.images || []).map((image, index) => ({
        path: '/tmp/pasted-' + index + '-' + image.name,
        name: image.name,
        mime: image.mime,
        size: image.size,
        preview: 'data:' + image.mime + ';base64,' + image.data
      }));
      window.postMessage({ type: 'attachments', attachments: previewAttachments }, '*');
    }
    if (message.type === 'removeAttachment') {
      previewAttachments = previewAttachments.filter(item => item.path !== message.path);
      window.postMessage({ type: 'attachments', attachments: previewAttachments }, '*');
    }
    if (message.type === 'ready') {
      if (scenario === 'connecting') return;
      if (scenario === 'fatal') {
        setTimeout(() => window.postMessage({ type: 'fatal', message: 'Cannot reach the project backend.' }, '*'), 10);
        return;
      }
      setTimeout(() => window.postMessage({ type: 'state', status: previewStatus, history: previewManagerHistory, projects: previewProjects, attachments: [] }, '*'), 10);
    }
    if (message.type === 'api') {
      const values = {
        history: message.actor && message.actor !== 'manager' ? { events: previewWorkerHistory } : { events: previewManagerHistory },
        version: { version: '${manifest.version}', protocol: 2, pid: 4242, started_at: previewStatus.snapshot.manager.sessionId, node: 'v24.22.1', platform: 'linux', arch: 'x64', project_root: previewStatus.project_root, codex_command: '' },
        files: { path: message.path || '', files: scenario === 'files-empty' ? [] : message.path?.endsWith('.js') ? 'export const sum = (a, b) => a + b;' : [{ name: 'app.js', directory: false }, { name: 'styles', directory: true }, { name: 'README.md', directory: false }] },
        diff: { diff: scenario === 'git-empty' ? '' : ('diff --git a/src/app.js b/src/app.js\\n@@ -1,3 +1,4 @@\\n-old\\n+new\\n+reviewed' + (scenario === 'git-large' ? '\\n+line'.repeat(200) : '')) },
        content: { content: 'export function calculate(a, b) {\\n  return a + b;\\n}' },
        turns: { turns: { data: [{ id: 'turn-1', status: 'completed', createdAt: '2026-11-06T12:00:00Z' }, { id: 'turn-2', status: 'completed', createdAt: '2026-11-06T12:03:00Z' }] } },
        checkpoints: { checkpoints: [{ id: 'checkpoint-demo', label: 'Before responsive polish', createdAt: '2026-11-06T11:55:00Z' }] },
        skills: { skills: { data: [{ skills: [{ name: 'frontend-design', description: 'Build and review web interfaces', path: '/workspace/.agents/skills/frontend-design/SKILL.md', scope: 'repo', enabled: true }, { name: 'playwright', description: 'Browser verification', path: '/home/user/.agents/skills/playwright/SKILL.md', scope: 'user', enabled: true }] }] } },
        createCheckpoint: { checkpoint: { id: 'checkpoint-new', label: message.label || '' } },
        restoreCheckpointById: { restoredFiles: ['worker_a1'], forkedConversations: ['manager'] },
        forkConversation: { thread: { id: 'thread-forked' } },
        clearMemory: { cleared: true },
        interruptManager: { interrupted: true },
        archiveWorker: { already_archived: false },
        saveConfig: { config: message.config || previewStatus.config }
      };
      if (message.action === 'approval') previewStatus.snapshot.approvals = previewStatus.snapshot.approvals.filter(item => item.id !== message.approvalId);
      if (message.action === 'question') previewStatus.snapshot.questions = previewStatus.snapshot.questions.filter(item => item.id !== message.questionId);
      if (message.action === 'switchProject') {
        previewProjects.forEach(item => { item.active = item.root === message.root; });
        previewStatus.project_root = message.root;
        values.switchProject = previewProjects.find(item => item.active);
        window.postMessage({ type: 'state', status: previewStatus, projects: previewProjects, history: [] }, '*');
      }
      setTimeout(() => {
        const failure = ({ 'send-failure': 'sendManager', 'files-error': 'files', 'git-error': 'diff', 'skills-error': 'skills', 'turns-error': 'turns' })[scenario] === message.action;
        window.postMessage({ type: 'apiResult', id: message.id, value: values[message.action] ?? { ok: true }, error: failure ? 'Request failed: ' + message.action : undefined }, '*');
        if (message.action === 'sendManager' && !failure) { previewAttachments = []; window.postMessage({ type: 'attachments', attachments: [] }, '*'); }
        if (['approval', 'question'].includes(message.action)) window.postMessage({ type: 'state', status: previewStatus }, '*');
      }, message.action === 'sendManager' ? 200 : 10);
    }
  },
  getState() { return {}; },
  setState() {}
});
setTimeout(async () => {
  try {
    const commands = { '#workers': '/workers', '#worker': '/workers', '#files': '/open src', '#git': '/diff task', '#commands': '/help', '#settings': '/settings', '#skills': '/skills', '#version': '/version', '#turns': '/turns', '#checkpoints': '/checkpoints' };
    if (commands[location.hash]) {
      ui.input = commands[location.hash];
      await runKey('', { name: 'return' });
      await drainPending();
      await loadWorkerHistory();
    }
    if (location.hash === '#quote') ui.input = '> 已确认的需求\\n\\n请继续验证。';
    renderNative();
    document.body.dataset.previewReady = 'true';
  } catch (error) { document.body.dataset.error = error.stack; }
}, 40);
`;

const preview = template
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="__STYLE__">', `<style>${css}</style>`)
  .replace('<script nonce="__NONCE__">__UI_RUNTIME__</script>', () => `<script>${runtimeBuilder.buildUiRuntime(relative => readFileSync(path.join(root, relative), 'utf8'), manifest.version).replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace('<script nonce="__NONCE__" src="__SCRIPT__"></script>', () => `<script>${mock}\n${app}</script>`);

await writeFile(path.join(out, 'webview-preview.html'), preview);
console.log(path.join(out, 'webview-preview.html'));
export { status, managerHistory, workerHistory, projects, preview };
