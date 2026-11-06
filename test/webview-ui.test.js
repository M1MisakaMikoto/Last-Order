import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import builder from '../vscode-extension/ui-runtime.cjs';
import { TerminalUI } from '../src/ui.js';

const read = relative => readFile(new URL(`../vscode-extension/${relative}`, import.meta.url), 'utf8');
const source = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');
function browserController() {
  const context = { TextEncoder, btoa, setTimeout, clearTimeout, setInterval, clearInterval };
  const runtime = builder.buildUiRuntime(source, 'test');
  vm.runInNewContext(runtime, context);
  return { ...context.LastOrderUI, runtime };
}
function fixture() {
  const calls = [];
  const state = {
    workers: { w1: { id: 'w1', title: '实现', status: 'running', provider: 'codex', model: 'test', effort: 'high', kind: 'implement', workspace: '/project/w1', notes: ['验证窄屏'] }, w2: { id: 'w2', title: '验收', status: 'failed', provider: 'claude', kind: 'review', workspace: '/project/w2' } },
    pipelines: {}, manager: { pending: [{ id: 'queued', queued: true, text: '稍后验证' }], active: [] },
    managerBusy: true, approvals: [{ id: 'a1', actor: 'w1', detail: { command: 'npm test' } }], questions: [], notifications: []
  };
  const events = [
    { seq: 1, type: 'manager_input', data: { text: '开始任务' } },
    { seq: 2, type: 'message', data: { role: 'assistant', text: '正在处理' } },
    { seq: 3, type: 'message', data: { role: 'tool', tool: { name: 'exec', arguments: { command: 'npm test' }, exitCode: 0, durationMs: 123, result: 'passed' } } }
  ];
  const service = {
    state, config: {}, projects: [{ code: 'A', root: 'D:\\workspaces\\SA', active: true }, { code: 'B', root: '/workspace/second', active: false }],
    approvals: new Map(state.approvals.map(item => [item.id, item])), questions: new Map(),
    snapshot: () => state, store: { history: () => events },
    git: { root: '/project', files: async () => [{ name: 'src', directory: true }], diff: async () => 'diff content' },
    sendManagerMessage: async (...args) => calls.push(['manager', ...args]),
    sendWorkerMessage: async (...args) => calls.push(['worker', ...args]),
    controlWorker: async (...args) => calls.push(['control', ...args])
  };
  return { service, state, events, calls };
}

test('native DOM retains TUI regions without invented navigation, cards or modal surfaces', async () => {
  const [html, script, css] = await Promise.all([read('webview/manager.html'), read('webview/app.js'), read('webview/style.css')]);
  for (const id of ['tui-header', 'manager-pane', 'workers-pane', 'worker-list', 'worker-detail-heading', 'manager-messages', 'worker-messages', 'auxiliary-pane', 'pending-requests', 'pending-queue', 'notice', 'composer-input']) assert.ok(html.includes(`id="${id}"`), id);
  assert.doesNotMatch(html, /<nav\b|<select\b|data-tab|sheet-overlay|project-select|composer-actions|activity-panel|xterm/i);
  assert.equal((html.match(/<button\b/g) || []).length, 0, 'image attachment has no standalone button');
  assert.match(script, /new TerminalUI\(service/);
  assert.match(script, /addEventListener\('paste'/);
  assert.match(script, /post\('pasteImages', \{ images \}\)/);
  assert.doesNotMatch(script, /#attach-image|pickImages/);
  assert.match(script, /ui\.headerLines\(/);
  assert.match(script, /ui\.pendingRequestLines\(/);
  assert.match(script, /ui\.inputPresentation\(/);
  assert.match(script, /node\('span', 'ghost', line\.ghost\)/);
  assert.match(script, /node\('span', 'completion-note', line\.note\)/);
  assert.match(script, /ui\.key\(text, key\)/);
  assert.doesNotMatch(script, /async function runSlashCommand|function statusLabel|\.split\(\/\[\/\\\\\]/);
  assert.match(css, /\.app-shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(css, /--suggestion:\s*var\(--vscode-editorSuggestWidget-foreground/);
  assert.match(css, /--user-border:\s*var\(--vscode-editorWarning-foreground/);
  assert.match(css, /\.message\.user\s*\{[^}]*border-color:\s*var\(--user-border\)/s);
  assert.match(css, /\.message-intermediate\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/s);
  assert.match(css, /\.combined-message > \.message-final-label\s*\{[^}]*position:\s*static/s);
  assert.match(css, /\.message-final-body\s*\{[^}]*padding-top:/s);
  assert.match(css, /\.input-ghost \.ghost\s*\{[^}]*color:\s*var\(--suggestion\)[^}]*text-decoration-style:\s*dotted/s);
  assert.match(css, /\.input-ghost \.completion-note\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(css, /content-visibility:\s*auto/);
  assert.doesNotThrow(() => new Function(script));
});

test('browser adapter uses the unchanged TUI command, keyboard and presentation methods', async () => {
  const { TerminalUI: BrowserUI, runtime } = browserController();
  assert.doesNotMatch(runtime, /process\.stdout|TerminalInput|emitKeypressEvents/);
  for (const method of ['command', 'key', 'headerLines', 'workerListPresentation', 'workerDetailPresentation', 'pendingRequestLines', 'queuedMessageLines', 'inputPresentation', 'settingsKey', 'settingsFieldDefs']) {
    assert.equal(BrowserUI.prototype[method].toString(), TerminalUI.prototype[method].toString(), method);
  }
  const nativeFixture = fixture(), browserFixture = fixture();
  const native = new TerminalUI(nativeFixture.service), browser = new BrowserUI(browserFixture.service);
  native.render = browser.render = () => {};
  for (const [text, key] of [
    ['', { name: 'tab', ctrl: true }], ['', { name: 'down' }], ['', { name: 'f6' }],
    ['', { name: 'right' }], ['', { name: 'f4' }], ['', { name: 'escape' }]
  ]) {
    await native.key(text, key); await browser.key(text, key);
    assert.equal(JSON.stringify([browser.screen, browser.panel, browser.selected, browser.workerFocus, browser.preview]), JSON.stringify([native.screen, native.panel, native.selected, native.workerFocus, native.preview]));
  }
  for (const text of ['普通请求', '/workers', '/msg w1 请继续', '/pause', '/help', '/approval a1']) {
    await native.command(text); await browser.command(text);
    assert.equal(browser.preview, native.preview, text);
  }
  assert.equal(JSON.stringify(browserFixture.calls), JSON.stringify(nativeFixture.calls));
  for (const columns of [24, 38, 80, 140]) {
    assert.equal(JSON.stringify(browser.headerLines(browserFixture.state, columns, 30)), JSON.stringify(native.headerLines(nativeFixture.state, columns, 30)));
    assert.equal(JSON.stringify(browser.queuedMessageLines(browserFixture.state, columns)), JSON.stringify(native.queuedMessageLines(nativeFixture.state, columns)));
  }
});

test('Webview bridge correlates approval, question, worker control and interrupt payloads', async () => {
  const [script, extension] = await Promise.all([read('webview/app.js'), read('extension.js')]);
  const messages = [];
  const { api, requestQueue } = vm.runInNewContext(script.slice(0, script.indexOf('function post(')) + '\n;({ api, requestQueue });', {
    LastOrderUI: { DEFAULT_CONFIG: {} }, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) })
  });
  const requests = [];
  const source = extension.slice(extension.indexOf('  async api(message) {'), extension.indexOf('  async message(message) {'));
  const provider = vm.runInNewContext(`({ ${source} })`, {
    client: { request: async (...args) => { requests.push(args); return { ok: true }; } }, workerById: id => ({ id })
  });
  provider.attachments = [];
  provider.afterMutation = async () => {};
  provider.post = message => {
    if (message.type !== 'apiResult') return;
    const pending = requestQueue.get(message.id);
    assert.ok(pending, 'response has original request ID'); requestQueue.delete(message.id);
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
  };
  for (const [action, payload, endpoint, body] of [
    ['approval', { approvalId: 'approval/1', allowed: false }, '/approval/approval%2F1', { allowed: false }],
    ['question', { questionId: 'question/2', answer: '单列' }, '/question/question%2F2', { answer: '单列' }],
    ['controlWorker', { workerId: 'worker/3', workerAction: 'pause' }, '/worker/worker%2F3/control', { action: 'pause', reason: '' }],
    ['sendManager', { text: '紧急请求', interrupt: true, quotes: [] }, '/manager/message', { text: '紧急请求', interrupt: true, quotes: [], attachments: [] }]
  ]) {
    const response = api(action, payload), message = messages.at(-1);
    assert.equal(typeof message.id, 'number'); assert.equal(message.action, action);
    await provider.api(message); await response;
    assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify(['POST', endpoint, body]));
  }
  assert.equal(requestQueue.size, 0);
});
