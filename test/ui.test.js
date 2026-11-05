import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, fit, wrap, TerminalUI } from '../src/ui.js';

test('terminal output neutralizes escape sequences and handles Chinese cell widths', () => {
  assert.equal(clean('\x1b[2J\x1b[31mtext\x1b[0m\x07'), 'text');
  assert.equal(fit('中文AB', 5), '中文A');
  assert.deepEqual(wrap('中文AB', 4), ['中文', 'AB']);
});

test('normal send and interrupt are distinct commands; worker control is explicit', async () => {
  const actions = []; const service = { state: { workers: { w: { id: 'w', workspace: '/test' } } }, sendManagerMessage: async (...args) => actions.push(['manager', ...args]), sendWorkerMessage: async (...args) => actions.push(['worker', ...args]), controlWorker: async (...args) => actions.push(['control', ...args]) };
  const ui = new TerminalUI(service);
  await ui.command('普通消息'); await ui.command('/interrupt 紧急消息'); await ui.command('/w 请先检查工作流'); await ui.command('/pause');
  assert.deepEqual(actions, [['manager', '普通消息', false, [], []], ['manager', '紧急消息', true], ['worker', 'w', '请先检查工作流'], ['control', 'w', 'pause', '']]);
});

test('/interrupt without text stops the manager without sending or retrying a message', async () => {
  const { ui } = navigationUI();
  let interrupts = 0;
  ui.service.interruptManager = async () => { interrupts++; return { interrupted: true, discarded: 1 }; };
  await ui.command('/interrupt');
  assert.equal(interrupts, 1);
  assert.match(ui.notice, /已停止 Manager 当前工作/);
});

test('/memory clear opens a new Manager native conversation while keeping status visible', async () => {
  const { ui } = navigationUI();
  let cleared = 0;
  ui.service.state.manager.sessionId = 'old-thread';
  ui.service.clearManagerMemory = async () => { cleared++; ui.service.state.manager.sessionId = null; return { cleared: true, previousSessionId: 'old-thread' }; };
  await ui.command('/memory status');
  assert.match(ui.notice, /old-thread/);
  await ui.command('/memory clear');
  assert.equal(cleared, 1);
  assert.match(ui.notice, /新的原生会话/);
  await assert.rejects(ui.command('/memory new'), /Usage: \/memory status\|clear/);
  await ui.command('/memory status');
  assert.match(ui.notice, /新的 native 对话 thread/);
});

test('/skills lists Codex skills with names, descriptions and paths', async () => {
  const { ui } = navigationUI();
  ui.service.listSkills = async actor => ({
    actor,
    skills: { data: [{ cwd: '/project', errors: [], skills: [
      { name: 'pdf', description: 'Read and extract PDF content', enabled: true, path: '/project/.agents/skills/pdf/SKILL.md', scope: 'repo' }
    ] }] }
  });
  await ui.command('/skills manager');
  assert.equal(ui.panel, 'help');
  assert.match(ui.preview, /\$pdf/);
  assert.match(ui.preview, /Read and extract PDF content/);
  assert.match(ui.preview, /\.agents\/skills\/pdf\/SKILL\.md/);
});

test('dollar-prefixed skills load asynchronously and complete through Tab', async () => {
  const { ui } = navigationUI();
  ui.service.listSkills = async () => ({ skills: { data: [{
    cwd: '/project', errors: [], skills: [
      { name: 'pdf', description: 'Read PDF documents', enabled: true, scope: 'repo', path: '/project/.agents/skills/pdf/SKILL.md' },
      { name: 'pytest', description: 'Run Python tests', enabled: true, scope: 'user', path: '/home/user/.agents/skills/pytest/SKILL.md' }
    ]
  }] } });
  ui.input = '请使用 $p';
  await ui.loadSkillCompletions();
  assert.deepEqual(ui.completion.items.map(item => item.value), ['请使用 $pdf ', '请使用 $pytest ']);
  await ui.key('', { name: 'tab' });
  assert.equal(ui.input, '请使用 $pdf ');
});

test('Manager message box only shows the current memory epoch after starting a new session', () => {
  const { ui, service, state } = navigationUI();
  state.manager.memoryEpoch = 1;
  service.store.history = () => [
    { seq: 1, type: 'manager_input', data: { role: 'user', text: '旧会话用户消息', memoryEpoch: 0 } },
    { seq: 2, type: 'message', data: { role: 'assistant', text: '旧会话回复', memoryEpoch: 0 } },
    { seq: 3, type: 'manager_input', data: { role: 'user', text: '新会话用户消息', memoryEpoch: 1 } },
    { seq: 4, type: 'message', data: { role: 'assistant', text: '新会话回复', memoryEpoch: 1 } }
  ];
  const conversation = ui.conversation('manager', 80).join('\n');
  assert.match(conversation, /新会话用户消息/);
  assert.match(conversation, /新会话回复/);
  assert.doesNotMatch(conversation, /旧会话用户消息|旧会话回复/);
  assert.equal(service.store.history().length, 4, 'audit history remains stored');
});

test('/quit only detaches the TUI while /shutdown stops Last Order', async () => {
  const { ui } = navigationUI();
  let quits = 0, shutdowns = 0;
  ui.options.quit = async () => { quits++; };
  ui.service.shutdown = async () => { shutdowns++; };
  await ui.command('/quit');
  assert.equal(quits, 1);
  assert.equal(shutdowns, 0);
  await ui.command('/shutdown');
  assert.equal(quits, 2);
  assert.equal(shutdowns, 1);
});

test('native conversation and checkpoint commands expose turn fork, revert and restore', async () => {
  const { ui } = navigationUI();
  const calls = [];
  ui.service.createCheckpoint = async label => { calls.push(['checkpoint', label]); return { id: 'cp1', label }; };
  ui.service.listCheckpoints = async () => [{ id: 'cp1', label: 'Before refactor' }];
  ui.service.conversationTurns = async actor => { calls.push(['turns', actor]); return { data: [{ id: 'turn1', status: 'completed' }] }; };
  ui.service.forkConversation = async (actor, options) => { calls.push(['fork', actor, options]); return { id: 'thread2' }; };
  ui.service.revertConversation = async (actor, turnId) => { calls.push(['revert', actor, turnId]); return {}; };
  ui.service.restoreCheckpoint = async (checkpointId, options) => {
    calls.push(['restore', checkpointId, options]);
    return { checkpointId, restoredFiles: ['w1'], forkedConversations: [] };
  };
  await ui.command('/checkpoint Before refactor');
  assert.match(ui.notice, /cp1/);
  await ui.command('/checkpoints');
  assert.match(ui.notice, /Before refactor/);
  await ui.command('/turns manager');
  assert.match(ui.notice, /turn1/);
  await ui.command('/fork turn1 manager');
  assert.match(ui.notice, /thread2/);
  await ui.command('/revert turn1 --yes manager');
  await ui.command('/restore cp1 files');
  assert.match(ui.notice, /Re-run with confirm/);
  await ui.command('/restore cp1 files confirm');
  assert.match(ui.notice, /files=w1/);
  assert.deepEqual(calls, [
    ['checkpoint', 'Before refactor'],
    ['turns', 'manager'],
    ['fork', 'manager', { lastTurnId: 'turn1' }],
    ['revert', 'manager', 'turn1'],
    ['restore', 'cp1', { files: true, conversation: false }]
  ]);
});

test('settings command edits persisted startup options and requires restart', async () => {
  const { ui } = navigationUI();
  const saved = [];
  ui.settings = {
    manager: 'codex', managerModel: '', managerEffort: '', managerPrompt: '',
    worker: 'codex', workerModel: '', workerEffort: '', workerPrompt: '',
    codexApprovals: 'auto_review', maxWorkers: 4, silenceMs: 600_000,
    mouseSelection: 'native', showShortcutHints: true
  };
  ui.options.saveSettings = async config => { saved.push(config); return config; };

  await ui.command('/settings');
  assert.equal(ui.panel, 'settings');
  assert.match(ui.frame(100, 30).join('\n'), /设置 · 保存后重启生效/);
  for (const columns of [24, 60, 100]) {
    const frame = ui.frame(columns, 24);
    assert.equal(frame.length, 24);
    assert.ok(frame.every(line => line === fit(line, columns)));
  }

  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'return' });
  await ui.key('gpt-5.1-codex', {});
  await ui.key('', { name: 'return' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'return' });
  await ui.key('high', {});
  await ui.key('', { name: 'return' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'return' });
  await ui.key('Follow team checklist', {});
  await ui.key('', { name: 'j', ctrl: true });
  await ui.key('Run tests', {});
  await ui.key('', { name: 'return' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'return' });
  await ui.key('deepseek-reasoner', {});
  await ui.key('', { name: 'return' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'return' });
  await ui.key('medium', {});
  await ui.key('', { name: 'return' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 'down' });
  await ui.key('', { name: 'right' });
  await ui.key('', { name: 's', ctrl: true });

  assert.deepEqual(saved, [{
    manager: 'codex', managerModel: 'gpt-5.1-codex', managerEffort: 'high',
    managerPrompt: 'Follow team checklist\nRun tests',
    worker: 'dsh', workerModel: 'deepseek-reasoner', workerEffort: 'medium',
    workerPrompt: '',
    codexApprovals: 'user', maxWorkers: 5, silenceMs: 660_000,
    mouseSelection: 'app', showShortcutHints: false
  }]);
  assert.equal(ui.panel, 'manager');
  assert.match(ui.notice, /重启 Last Order 后生效/);
});

test('top status uses labeled rows and shortcut hints can be hidden', () => {
  const { ui } = navigationUI();
  const withHints = ui.frame(80, 24).join('\n');
  assert.match(withHints, /Last Order/);
  assert.doesNotMatch(withHints, /Mission Control/);
  assert.match(withHints, /项目/);
  assert.match(withHints, /状态/);
  assert.match(withHints, /Last Order · Manager/);
  assert.match(withHints, /Manager 就绪 · 0 个任务待处理/);
  assert.doesNotMatch(withHints, /队列/);
  assert.match(withHints, /提示/);
  assert.match(withHints, /Manager 就绪 · 0 个任务待处理/);
  assert.match(withHints, /12 个 Worker 正在工作/);
  assert.match(withHints, /12 个 Worker 正在工作/);
  assert.doesNotMatch(withHints, /codex|deepseek|模型|载体/i);
  ui.settings.showShortcutHints = false;
  const withoutHints = ui.frame(80, 24).join('\n');
  assert.doesNotMatch(withoutHints, /提示/);
  assert.match(withoutHints, /状态/);
});

test('top status distinguishes foreground conversation, background work and manager queue', () => {
  const { ui, state } = navigationUI();
  state.managerBusy = true; state.manager.active = [];
  assert.match(ui.frame(80, 24).join('\n'), /Manager 正在处理后台事件/);
  state.manager.active = ['m1'];
  assert.match(ui.frame(80, 24).join('\n'), /Manager 正在与用户对话/);
  state.managerBusy = false; state.manager.active = [];
  state.manager.pending = [{ id: 'q1', text: 'queued', queued: true }];
  const frame = ui.frame(80, 24).join('\n');
  assert.match(frame, /Manager 就绪/);
  assert.match(frame, /1 个任务待处理/);
});

test('project list shows a three-row window, scrolls, and routes -A/-B prefixes', async () => {
  const { ui, service } = navigationUI();
  const projects = ['A', 'B', 'C', 'D'].map((code, index) => ({ code, root: `D:/workspaces/p${index + 1}`, active: index === 0 }));
  service.projects = projects.map(project => ({ ...project }));
  const switched = [], sent = [];
  service.switchProject = async code => {
    const project = service.projects.find(item => item.code === code);
    service.projects.forEach(item => { item.active = item.code === code; });
    switched.push(code);
    return { code, root: project.root };
  };
  service.routeInput = text => {
    const match = /^-([A-Za-z]{1,2})(?:\s+([\s\S]*))?$/.exec(text);
    return match ? { project: match[1], text: match[2] ?? '' } : { project: null, text };
  };
  service.sendManagerMessage = async text => sent.push(text);
  let frame = ui.frame(100, 24).join('\n');
  assert.match(frame, /-\[A\] D:\/workspaces\/p1/);
  assert.match(frame, /-\[B\] D:\/workspaces\/p2/);
  assert.match(frame, /-\[C\] D:\/workspaces\/p3/);
  assert.doesNotMatch(frame, /-\[D\] D:\/workspaces\/p4/);
  await ui.key('', { name: 'down', meta: true });
  frame = ui.frame(100, 24).join('\n');
  assert.doesNotMatch(frame, /-\[A\] D:\/workspaces\/p1/);
  assert.match(frame, /-\[D\] D:\/workspaces\/p4/);
  ui.input = '-C next task';
  await ui.key('', { name: 'return' });
  assert.deepEqual(switched, ['C']);
  assert.deepEqual(sent, ['next task']);
  assert.match(ui.notice, /当前项目 -\[C\]/);
});

test('application mouse selection refreshes during drag, filters borders, and copies with Ctrl+C', async () => {
  const copied = [];
  const { ui } = navigationUI();
  ui.settings.mouseSelection = 'app';
  ui.options.copyText = async text => copied.push(text);
  ui.lastFrameLines = ['╭─ Manager · #1 ─╮', '│  abcdef  │', '╰──────────╯'];
  ui.lastSize = { columns: 10, rows: 2 };

  await ui.handleMouse({ type: 'down', button: 0, x: 1, y: 1 });
  await ui.handleMouse({ type: 'drag', button: 0, x: 10, y: 3 });
  assert.deepEqual(ui.selection.anchor, { row: 0, col: 0 });
  assert.deepEqual(ui.selection.focus, { row: 2, col: 9 });
  await ui.handleMouse({ type: 'up', button: 0, x: 10, y: 3 });
  assert.deepEqual(copied, []);
  assert.match(ui.notice, /Ctrl\+C 复制/);

  await ui.key('', { name: 'c', ctrl: true });
  assert.deepEqual(copied, ['Manager · #1\n abcdef']);
  assert.equal(ui.selection, null, 'successful copy clears the selection');

  ui.options.readClipboard = async () => '粘贴\n内容';
  ui.input = '';
  await ui.key('', { name: 'v', ctrl: true });
  assert.equal(ui.input, '粘贴\n内容');
});

test('Ctrl+C never exits the TUI without a selection', async () => {
  const { ui } = navigationUI();
  let quits = 0;
  ui.options.quit = async () => { quits++; };
  ui.settings.mouseSelection = 'app';
  ui.selection = null;
  await ui.key('', { name: 'c', ctrl: true });
  assert.equal(quits, 0);
  assert.match(ui.notice, /Ctrl\+C 不退出/);
  assert.match(ui.notice, /\/quit|Ctrl\+D/);
  await ui.key('', { name: 'd', ctrl: true });
  assert.equal(quits, 1);
});

test('left and right arrows edit text at the input cursor', async () => {
  const { ui } = navigationUI();
  ui.input = 'abcd';
  assert.equal(ui.cursor, 4);
  await ui.key('', { name: 'left' });
  await ui.key('', { name: 'left' });
  assert.equal(ui.cursor, 2);
  await ui.key('X', { name: 'x' });
  assert.equal(ui.input, 'abXcd');
  assert.equal(ui.cursor, 3);
  await ui.key('', { name: 'home' });
  assert.equal(ui.cursor, 0);
  await ui.key('Y', { name: 'y' });
  assert.equal(ui.input, 'YabXcd');
  await ui.key('', { name: 'end' });
  assert.equal(ui.cursor, 6);
  await ui.key('', { name: 'backspace' });
  assert.equal(ui.input, 'YabXc');
  await ui.key('', { name: 'home' });
  await ui.key('', { name: 'delete' });
  assert.equal(ui.input, 'abXc');
  const presentation = ui.inputPresentation(40);
  assert.equal(presentation.cursor, 3);
});

test('Home and End only edit the input cursor and never scroll content', async () => {
  const { ui, service } = navigationUI();
  service.store.history = () => Array.from({ length: 40 }, (_, seq) => ({
    seq: seq + 1, type: 'message', data: { role: 'assistant', text: `home end ${seq}` }
  }));
  ui.frame(100, 30); ui.scrollTo('top'); ui.frame(100, 30);
  ui.input = '';
  await ui.key('', { name: 'home' });
  assert.equal(ui.scrollState.top, 0);
  await ui.key('', { name: 'end' });
  assert.equal(ui.scrollState.top, 0);
  ui.input = 'abcd';
  await ui.key('', { name: 'home' });
  assert.equal(ui.cursor, 0);
  await ui.key('', { name: 'end' });
  assert.equal(ui.cursor, 4);
});

test('Shift arrows and Ctrl+A select input text before replacing or copying it', async () => {
  const copied = [];
  const { ui } = navigationUI();
  ui.options.copyText = async text => copied.push(text);
  ui.input = 'abcd';
  await ui.key('', { name: 'left', shift: true });
  await ui.key('', { name: 'left', shift: true });
  assert.equal(ui.selectedInputText(), 'cd');
  assert.equal(ui.cursor, 2);
  await ui.key('Z', { name: 'z' });
  assert.equal(ui.input, 'abZ');
  assert.equal(ui.inputSelection, null);
  await ui.key('a', { name: 'a', ctrl: true });
  assert.equal(ui.selectedInputText(), 'abZ');
  assert.equal(ui.cursor, 3);
  await ui.key('', { name: 'c', ctrl: true });
  assert.deepEqual(copied, ['abZ']);
  assert.equal(ui.inputSelection, null);
  await ui.key('a', { name: 'a', ctrl: true });
  await ui.key('Q', { name: 'q' });
  assert.equal(ui.input, 'Q');
});

test('long input wraps into multiple visual lines and keeps the cursor visible', () => {
  const { ui } = navigationUI();
  ui.input = 'x'.repeat(70);
  const presentation = ui.inputPresentation(20, 4);
  assert.ok(presentation.lines.length > 1);
  assert.equal(presentation.cursorRow, presentation.lines.length - 1);
  for (const line of presentation.lines) assert.ok(line.plain.length <= 20);
});

test('Ctrl+Enter inserts a hard newline while Enter submits the message', async () => {
  const { ui } = navigationUI();
  const sent = [];
  ui.service.sendManagerMessage = async text => sent.push(text);
  ui.input = '第一行';
  await ui.key('', { name: 'return', ctrl: true });
  assert.equal(ui.input, '第一行\n');
  await ui.key('第二行', {});
  assert.equal(ui.input, '第一行\n第二行');
  const presentation = ui.inputPresentation(40);
  assert.equal(presentation.lines.length, 2);
  assert.match(presentation.lines[0].plain, /第一行/);
  assert.match(presentation.lines[1].plain, /第二行/);
  await ui.key('', { name: 'return' });
  assert.deepEqual(sent, ['第一行\n第二行']);
  assert.equal(ui.input, '');
});

test('wheel scrolling behaves like Ctrl+arrows and never changes worker selection or input history', () => {
  const { ui, service } = navigationUI();
  service.store.history = () => Array.from({ length: 60 }, (_, seq) => ({
    seq: seq + 1, type: 'message', data: { role: 'assistant', text: `wheel ${seq}` }
  }));
  ui.screen = 'workers'; ui.panel = 'chat'; ui.workerFocus = 'list'; ui.selected = 3;
  ui.frame(100, 30);
  ui.scrollTo('top'); ui.frame(100, 30);
  const selected = ui.selected;
  ui.scrollWheel(3);
  assert.equal(ui.selected, selected);
  assert.ok(ui.scrollState.top > 0);

  ui.screen = 'manager'; ui.panel = 'manager';
  ui.history = ['old input']; ui.historyIndex = 1; ui.input = 'draft';
  ui.frame(100, 30); ui.scrollTo('top'); ui.frame(100, 30);
  ui.scrollWheel(3);
  assert.equal(ui.historyIndex, 1);
  assert.equal(ui.input, 'draft');
  assert.ok(ui.scrollState.top > 0);
});

test('queued manager messages render in a separate queue instead of the conversation timeline', () => {
  const { ui, service, state } = navigationUI();
  state.managerBusy = true;
  state.manager.active = ['m1'];
  state.manager.pending = [
    { id: 'm1', text: '正在处理的消息', queued: true },
    { id: 'm2', text: '第一条排队消息', queued: true },
    { id: 'm3', text: '第二条排队消息', queued: true }
  ];
  service.store.history = () => [
    { seq: 1, type: 'manager_input', data: { role: 'user', text: '正在处理的消息', messageId: 'm1', queued: true } },
    { seq: 2, type: 'manager_input', data: { role: 'user', text: '第一条排队消息', messageId: 'm2', queued: true } },
    { seq: 3, type: 'manager_input', data: { role: 'user', text: '第二条排队消息', messageId: 'm3', queued: true } }
  ];
  const conversation = ui.conversation('manager', 80).join('\n');
  assert.match(conversation, /正在处理的消息/);
  assert.doesNotMatch(conversation, /第一条排队消息|第二条排队消息/);
  const frame = ui.frame(80, 30).join('\n');
  assert.match(frame, /排队发送 · 2 条/);
  assert.match(frame, /1\. 第一条排队消息/);
  assert.match(frame, /2\. 第二条排队消息/);

  state.managerBusy = false;
  state.manager.active = [];
  state.manager.pending = [];
  assert.match(ui.conversation('manager', 80).join('\n'), /第一条排队消息/);
});

test('selection follows content when the conversation scrolls', async () => {
  const { ui, service } = navigationUI();
  ui.settings.mouseSelection = 'app';
  service.store.history = () => Array.from({ length: 40 }, (_, seq) => ({
    seq: seq + 1, type: 'message', data: { role: seq % 2 ? 'assistant' : 'user', text: `滚动消息 ${seq}` }
  }));
  ui.frame(100, 30);
  const view = ui.lastConversationView;
  const downY = view.rowStart + 3;
  const dragY = view.rowStart + 6;
  await ui.handleMouse({ type: 'down', button: 0, x: view.colStart + 5, y: downY });
  await ui.handleMouse({ type: 'drag', button: 0, x: view.colStart + 20, y: dragY });
  await ui.handleMouse({ type: 'up', button: 0, x: view.colStart + 20, y: dragY });
  const beforeText = ui.selectedText();
  const beforeRange = ui.selectionRange();

  ui.scrollBy(-2); ui.frame(100, 30);
  const afterRange = ui.selectionRange();
  assert.equal(afterRange.start.row, beforeRange.start.row + 2);
  assert.equal(ui.selectedText(), beforeText);
});

test('dragging at the viewport edge continuously auto-scrolls and extends selection', async () => {
  const { ui, service } = navigationUI();
  ui.settings.mouseSelection = 'app';
  service.store.history = () => Array.from({ length: 60 }, (_, seq) => ({
    seq: seq + 1, type: 'message', data: { role: seq % 2 ? 'assistant' : 'user', text: `边缘滚动消息 ${seq}` }
  }));
  ui.frame(100, 30);
  ui.scrollTo('top'); ui.frame(100, 30);
  const view = ui.lastConversationView;
  await ui.handleMouse({ type: 'down', button: 0, x: view.colStart + 5, y: view.rowStart + 1 });
  await ui.handleMouse({ type: 'drag', button: 0, x: view.colStart + 20, y: view.rowStart + view.height });
  const anchor = ui.selection.anchor.contentRow;
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.ok(ui.scrollState.top > 0);
  assert.ok(ui.selection.focus.contentRow > anchor);
  await ui.handleMouse({ type: 'up', button: 0, x: view.colStart + 20, y: view.rowStart + view.height });
  assert.equal(ui.selectionAutoTimer, null);
});

function navigationUI(count = 12) {
  const workers = Object.fromEntries(Array.from({ length: count }, (_, i) => [`w${i}`, { id: `w${i}`, provider: 'codex', kind: 'implement', status: 'running', workspace: `/workspace/${i}`, pipelineId: `p${i}` }]));
  const state = { workers, pipelines: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { title: `任务 ${i}` }])), manager: { pending: [] }, notifications: [], approvals: [], questions: [] };
  const service = {
    state, snapshot: () => state, config: { manager: 'codex' },
    git: { root: '/project', files: async worker => `files of ${worker.id}`, diff: async worker => `diff of ${worker.id}` },
    store: { history: actor => [{ type: 'message', data: { role: 'assistant', text: `对话记录 ${actor}` } }] }
  };
  const ui = new TerminalUI(service); ui.render = () => {};
  return { ui, service, state };
}

test('Ctrl+Tab toggles only Manager and Workers and retains worker selection, detail view and input', async () => {
  const { ui } = navigationUI();
  await ui.key('', { name: 'tab', ctrl: true });
  assert.equal(ui.panel, 'chat');
  await ui.key('', { name: 'down' });
  assert.equal(ui.worker.id, 'w1');
  await ui.key('', { name: 'right' });
  assert.equal(ui.panel, 'files'); assert.equal(ui.preview, 'files of w1');
  ui.filePath = 'src'; ui.input = '尚未发送的内容';
  await ui.key('', { name: 'tab', ctrl: true });
  assert.equal(ui.panel, 'manager'); assert.equal(ui.screen, 'manager');
  await ui.key('', { name: 'down' });
  assert.equal(ui.worker.id, 'w1', 'Manager navigation must not change worker selection');
  await ui.key('', { name: 'tab', ctrl: true });
  assert.equal(ui.panel, 'files'); assert.equal(ui.screen, 'workers');
  assert.equal(ui.worker.id, 'w1'); assert.equal(ui.filePath, 'src'); assert.equal(ui.input, '尚未发送的内容');
  await ui.key('', { name: 'right' }); assert.equal(ui.panel, 'files', 'typing a draft must not navigate detail views');
  ui.input = '';
  await ui.key('', { name: 'right' }); assert.equal(ui.panel, 'git');
  await ui.key('', { name: 'tab', ctrl: true }); await ui.key('', { name: 'tab', ctrl: true });
  assert.equal(ui.panel, 'git'); assert.equal(ui.preview, 'diff of w1');
  await ui.key('', { name: 'f1' }); assert.equal(ui.screen, 'manager');
  await ui.command('/select w11'); assert.equal(ui.screen, 'workers'); assert.equal(ui.worker.id, 'w11');
});

test('Workers shows the selected task list and conversation together while Manager uses the full view', async () => {
  const { ui } = navigationUI();
  const manager = ui.frame(100, 30).slice(4, -3).join('\n');
  assert.match(manager, /对话记录 manager/); assert.doesNotMatch(manager, /任务 11|Worker 列表/);
  await ui.command('/select w11');
  const frame = ui.frame(100, 30), body = frame.join('\n');
  assert.match(body, /Worker 列表 12\/12/); assert.match(body, /▶ 任务 11/);
  assert.match(body, /运行中 · codex/); assert.match(body, /对话记录 w11/);
  assert.ok(frame.some(line => line.includes('│') && line.includes('对话记录 w11')), 'list and detail share the same row');
  assert.doesNotMatch(body, /对话记录 manager/);
});

test('/monitor opens an independent window for the selected or named worker', async () => {
  const { ui } = navigationUI();
  const opened = [];
  ui.options.openMonitor = async worker => { opened.push(worker.id); return 4321; };
  await ui.command('/monitor w1');
  assert.deepEqual(opened, ['w1']);
  assert.match(ui.notice, /独立窗口打开 w1 监视 · PID 4321/);
  await assert.rejects(ui.command('/monitor missing'), /请选择 worker/);
});

test('reload command delegates a graceful application restart', async () => {
  const { ui } = navigationUI();
  let reloads = 0;
  ui.options.reload = async () => { reloads++; };
  await ui.command('/reload');
  assert.equal(reloads, 1);
  assert.match(ui.notice, /正在重启 Last Order/);
});

test('empty and populated layouts fit small and large terminals with approvals and input visible', async () => {
  for (const count of [0, 12]) {
    const { ui, state } = navigationUI(count);
    state.approvals.push({ id: 'a1', actor: 'w0', detail: { command: 'git commit' } });
    ui.input = '保留输入';
    for (const panel of ['manager', 'chat', 'files', 'git']) {
      await ui.showPanel(panel);
      for (const columns of [24, 60, 79, 80, 120]) for (const rows of [12, 24, 40]) {
        const frame = ui.frame(columns, rows);
        assert.equal(frame.length, rows, `${count} workers, ${panel}, ${columns}x${rows}`);
        assert.ok(frame.every(line => line === fit(line, columns)), 'every row must fit without terminal wrapping');
        assert.match(frame.at(-1), /^> 保留输入/);
        assert.ok(frame.some(line => line.includes('审批 a1')));
        if (columns < 80) assert.ok(frame.every(line => !(line.includes('Worker 列表') && line.includes('Worker 详情'))), 'narrow screens stack the list and detail');
      }
    }
  }
});

test('a late workspace refresh cannot overwrite help or another detail view', async () => {
  const { ui, service } = navigationUI();
  let resolveFiles;
  service.git.files = () => new Promise(resolve => { resolveFiles = resolve; });
  const loading = ui.showPanel('files');
  await ui.command('/help'); const help = ui.preview;
  resolveFiles('stale files'); await loading;
  assert.equal(ui.panel, 'help'); assert.equal(ui.preview, help);
  await ui.key('', { name: 'tab', ctrl: true }); assert.equal(ui.panel, 'manager');
  await ui.showPanel('git'); assert.equal(ui.preview, 'diff of w0');
});

test('adjacent background operations fold together and never hide user-facing questions or errors in Worker detail', async () => {
  const { ui, service } = navigationUI();
  const event = (seq, role, text, background = false) => ({ seq, type: 'message', data: { role, text, background } });
  const events = [
    { seq: 1, type: 'manager_input', data: { role: 'user', text: '做计算器' } },
    event(2, 'assistant', '已安排实现'), event(3, 'tool', 'dynamicToolCall'), event(4, 'tool', 'inspect worker'),
    event(5, 'assistant', 'worker 后台进度', true), event(6, 'question', '需要用户选择', true),
    event(7, 'tool', 'second inspect'), event(8, 'error', '自动审批拒绝原因', true), event(9, 'assistant', '交付完成')
  ];
  service.store.history = () => events;
  await ui.key('', { name: 'tab', ctrl: true });
  const current = () => ui.conversation(ui.worker.id, 120).join('\n');
  const collapsed = current();
  for (const visible of ['做计算器', '已安排实现', '需要用户选择', '自动审批拒绝原因', '交付完成']) assert.ok(collapsed.includes(visible));
  for (const hidden of ['dynamicToolCall', 'inspect worker', 'worker 后台进度', 'second inspect']) assert.ok(!collapsed.includes(hidden));
  assert.match(collapsed, /后台过程 #1 · 3 条/); assert.match(collapsed, /后台过程 #2 · 1 条/);
  await ui.command('/expand 1');
  const expanded = current();
  assert.match(expanded, /inspect worker/); assert.match(expanded, /worker 后台进度/); assert.doesNotMatch(expanded, /second inspect/);
  await ui.command('/collapse 1'); assert.doesNotMatch(current(), /inspect worker/);
});

test('tool events show call status, arguments and complete results when expanded in Worker detail', async () => {
  const { ui, service } = navigationUI();
  const tool = (seq, status, extra = {}) => ({
    seq,
    type: 'message',
    data: {
      role: 'tool',
      background: true,
      tool: { id: 'call_inspect_1', name: 'inspect', status, arguments: { id: 'w0' }, ...extra }
    }
  });
  service.store.history = () => [
    tool(1, 'running'),
    tool(2, 'completed', { result: { worker: { id: 'w0', status: 'running' } } })
  ];
  await ui.key('', { name: 'tab', ctrl: true });
  const current = () => ui.conversation(ui.worker.id, 120).join('\n');
  assert.match(current(), /后台过程 #1 · 2 条 · inspect/);
  await ui.command('/expand 1');
  const expanded = current();
  assert.match(expanded, /工具 · inspect · 运行中 · nspect_1/);
  assert.match(expanded, /工具 · inspect · 完成 · nspect_1/);
  assert.match(expanded, /参数：[\s\S]*"id": "w0"/);
  assert.match(expanded, /结果：[\s\S]*"status": "running"/);
});

test('F5 expansion is scoped to Worker conversations and Manager hides internal tool groups', async () => {
  const { ui, service } = navigationUI();
  const logs = {
    manager: [{ seq: 10, type: 'message', data: { role: 'tool', text: 'manager inspect' } }],
    w0: [{ seq: 20, type: 'message', data: { role: 'tool', text: 'worker command' } }]
  };
  service.store.history = actor => logs[actor] ?? [];
  await ui.key('', { name: 'tab', ctrl: true });
  await ui.command('/expand 1');
  logs.w0.push({ seq: 21, type: 'message', data: { role: 'assistant', text: 'new worker progress', background: true } });
  assert.match(ui.conversation('w0', 120).join('\n'), /new worker progress/);
  await ui.key('', { name: 'tab', ctrl: true });
  assert.doesNotMatch(ui.conversation('manager', 120).join('\n'), /manager inspect/);
  await ui.key('', { name: 'tab', ctrl: true });
  await ui.key('', { name: 'f5' });
  assert.match(ui.conversation('w0', 120).join('\n'), /worker command/);
});

test('Manager Ctrl+arrows scroll, Shift+arrows jump to top/bottom, and drafts remain intact', async () => {
  const { ui, service } = navigationUI();
  const logs = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, type: 'message', data: { role: i % 2 ? 'assistant' : 'user', text: `消息 ${String(i).padStart(2, '0')}` } }));
  service.store.history = () => logs;
  ui.frame(90, 24); assert.equal(ui.scrollState.top, null);
  const bottom = ui.scrollState.total - ui.scrollState.height;
  ui.input = '未发送草稿';
  await ui.key('', { name: 'up', ctrl: true }); ui.frame(90, 24);
  assert.equal(ui.scrollState.top, bottom - 1); assert.equal(ui.input, '未发送草稿');
  await ui.key('', { name: 'pageup' }); ui.frame(90, 24);
  assert.ok(ui.scrollState.top < bottom - 1);
  await ui.key('', { name: 'up', shift: true });
  const before = ui.frame(90, 24).slice(4, -3);
  assert.ok(before.some(line => line.includes('消息 00')));
  logs.push({ seq: 21, type: 'message', data: { role: 'assistant', text: '新到达消息' } });
  assert.deepEqual(ui.frame(90, 24).slice(4, -3), before, 'background output must not move the visible historical text');
  assert.match(ui.scrollHint(), /历史/);
  await ui.key('', { name: 'down', ctrl: true }); assert.equal(ui.scrollState.top, 1);
  await ui.key('', { name: 'down', shift: true });
  assert.ok(ui.frame(90, 24).some(line => line.includes('新到达消息'))); assert.equal(ui.scrollState.top, null);
  logs.push({ seq: 22, type: 'message', data: { role: 'assistant', text: '继续跟随的新消息' } });
  assert.ok(ui.frame(90, 24).some(line => line.includes('继续跟随的新消息')));
});

test('conversation can overscroll past the last message to leave readable bottom padding', () => {
  const { ui, service } = navigationUI();
  service.store.history = () => Array.from({ length: 60 }, (_, i) => ({
    seq: i + 1, type: 'message', data: { role: 'assistant', text: `padding message ${i}` }
  }));
  ui.frame(90, 24);
  const normalMax = Math.max(0, ui.scrollState.total - ui.scrollState.height);
  ui.scrollBy(ui.bottomPadding());
  const frame = ui.frame(90, 24);
  assert.ok(ui.scrollState.top > normalMax);
  assert.equal(ui.scrollState.top - normalMax, ui.bottomPadding());
  assert.match(ui.scrollHint(), /底部留白 \d+ 行/);
  assert.ok(frame.some(line => line.includes('padding message 59')));
  ui.scrollTo('bottom');
  ui.frame(90, 24);
  assert.equal(ui.scrollState.top, null);
});

test('Manager arrows navigate submitted input history and restore the unsent draft', async () => {
  const { ui } = navigationUI();
  ui.history = ['第一条需求', '/help', '第三条需求']; ui.historyIndex = ui.history.length;
  ui.input = '还没发送的草稿';
  await ui.key('', { name: 'up' });
  assert.equal(ui.input, '第三条需求');
  await ui.key('', { name: 'up' });
  assert.equal(ui.input, '/help');
  await ui.key('', { name: 'up' });
  assert.equal(ui.input, '第一条需求');
  await ui.key('', { name: 'up' });
  assert.equal(ui.input, '第一条需求', 'history navigation stops at the oldest item');
  await ui.key('', { name: 'down' });
  assert.equal(ui.input, '/help');
  await ui.key('', { name: 'down' });
  assert.equal(ui.input, '第三条需求');
  await ui.key('', { name: 'down' });
  assert.equal(ui.input, '还没发送的草稿');
  assert.equal(ui.screen, 'manager');
});

test('Escape returns Workers and auxiliary panels to the Manager page', async () => {
  const { ui } = navigationUI();
  await ui.key('', { name: 'tab', ctrl: true });
  assert.equal(ui.screen, 'workers');
  await ui.key('', { name: 'escape' });
  assert.equal(ui.screen, 'manager');
  await ui.command('/help');
  assert.equal(ui.panel, 'help');
  await ui.key('', { name: 'escape' });
  assert.equal(ui.screen, 'manager');
  assert.equal(ui.panel, 'manager');
});

test('Worker list hides archived workers by default and /workers all shows them once', async () => {
  const { ui, state, service } = navigationUI();
  state.workers = {
    w0: { id: 'w0', provider: 'codex', kind: 'implement', status: 'running', title: 'Active', pipelineId: 'p0', epoch: 1 },
    w1: { id: 'w1', provider: 'codex', kind: 'implement', status: 'succeeded', title: 'Archived', pipelineId: 'p1', epoch: 1, archivedAt: '2026-01-01T00:00:00Z' }
  };
  state.pipelines = { p0: { id: 'p0', title: 'Active' }, p1: { id: 'p1', title: 'Archived' } };
  assert.deepEqual(ui.workers.map(worker => worker.id), ['w0']);
  await ui.command('/workers all');
  assert.equal(ui.showArchivedOnce, true);
  assert.deepEqual(ui.workers.map(worker => worker.id), ['w0', 'w1']);
  assert.match(ui.frame(100, 30).join('\n'), /Archived/);
  await ui.command('/workers');
  assert.equal(ui.showArchivedOnce, false);
  assert.deepEqual(ui.workers.map(worker => worker.id), ['w0']);

  const archived = [];
  service.archiveWorker = async id => { archived.push(id); state.workers[id].archivedAt = '2026-01-02T00:00:00Z'; return { worker_id: id }; };
  state.workers.w0.status = 'succeeded';
  ui.selected = 0;
  await ui.command('/manager');
  await assert.rejects(ui.command('/archive w0'), /Workers view/);
  await ui.command('/workers');
  await ui.command('/archive w0');
  assert.deepEqual(archived, ['w0']);
  assert.deepEqual(ui.workers, []);
});

test('/archive all only archives stopped workers and is restricted to Workers view', async () => {
  const { ui, state, service } = navigationUI();
  state.workers = {
    w0: { id: 'w0', provider: 'codex', kind: 'implement', status: 'running', title: 'Active', pipelineId: 'p0', epoch: 1 },
    w1: { id: 'w1', provider: 'codex', kind: 'implement', status: 'succeeded', title: 'Done', pipelineId: 'p1', epoch: 1 },
    w2: { id: 'w2', provider: 'codex', kind: 'implement', status: 'failed', title: 'Failed', pipelineId: 'p2', epoch: 1 }
  };
  state.pipelines = { p0: { id: 'p0', title: 'Active' }, p1: { id: 'p1', title: 'Done' }, p2: { id: 'p2', title: 'Failed' } };
  const archived = [];
  service.archiveWorker = async (id, reason) => {
    archived.push([id, reason]);
    state.workers[id].archivedAt = '2026-01-02T00:00:00Z';
    return { worker_id: id };
  };
  await assert.rejects(ui.command('/archive all'), /Workers view/);
  await ui.command('/workers');
  await ui.command('/archive all');
  assert.deepEqual(archived, [['w1', 'archive-all'], ['w2', 'archive-all']]);
  assert.equal(state.workers.w0.archivedAt, undefined);
  assert.match(ui.notice, /已归档 2 个/);
});

test('/quote references Manager or Worker history and sends structured metadata', async () => {
  const { ui, service } = navigationUI();
  const sent = [];
  service.projects = [{ code: 'A', root: 'D:/workspaces/a', active: true }];
  service.conversationEvent = async (actor, seq) => ({
    seq, actor, time: '2026-11-05T01:02:03.000Z',
    type: 'message', data: { role: 'assistant', text: `evidence from ${actor}` }
  });
  service.sendManagerMessage = async (text, interrupt, quotes) => sent.push({ text, interrupt, quotes });
  await ui.command('/quote worker_1:#18 explain the risk');
  assert.match(sent[0].text, /> 引用 worker_1 · #18/);
  assert.equal(sent[0].interrupt, false);
  assert.deepEqual(sent[0].quotes, [{
    project: 'A', actor: 'worker_1', seq: 18, role: 'assistant',
    time: '2026-11-05T01:02:03.000Z', text: 'evidence from worker_1'
  }]);
  assert.equal(ui.screen, 'manager');
  assert.match(ui.notice, /已引用 worker_1 #18/);
});

test('Ctrl+Q inserts selected text as a quote block', async () => {
  const { ui } = navigationUI();
  ui.input = 'selected evidence';
  ui.inputSelection = { anchor: 0, focus: ui.input.length };
  await ui.key('', { name: 'q', ctrl: true });
  assert.equal(ui.input, '> selected evidence\n\n');
  assert.match(ui.notice, /已插入引用/);
});

test('image attachments selected in the Webview are consumed by the next Manager message', async () => {
  const { ui, service } = navigationUI();
  const attachment = { name: 'screen.png', path: '/tmp/screen.png', mime: 'image/png', size: 123 };
  let consumed = 0, sent;
  ui.options.takeAttachments = () => { consumed++; return [attachment]; };
  service.sendManagerMessage = async (...args) => { sent = args; };
  ui.input = 'Inspect this screenshot';
  await ui.key('', { name: 'return' });
  assert.equal(consumed, 1);
  assert.deepEqual(sent, ['Inspect this screenshot', false, [], [attachment]]);
});

test('Worker focus separates selection from detail scrolling and preserves positions across conversations', async () => {
  const { ui, service } = navigationUI();
  service.store.history = actor => Array.from({ length: 20 }, (_, seq) => ({ seq: seq + 1, type: 'message', data: { role: 'assistant', text: `${actor} 消息 ${seq}` } }));
  await ui.key('', { name: 'tab', ctrl: true }); ui.frame(100, 30);
  await ui.key('', { name: 'down' }); ui.frame(100, 30); assert.equal(ui.worker.id, 'w1');
  await ui.key('', { name: 'f6' }); assert.equal(ui.workerFocus, 'detail');
  await ui.key('', { name: 'up' }); ui.frame(100, 30);
  assert.equal(ui.worker.id, 'w1'); assert.notEqual(ui.scrollState.top, null);
  const position = ui.scrollState.top;
  await ui.key('', { name: 'tab', ctrl: true }); ui.frame(100, 30); await ui.key('', { name: 'up', shift: true }); ui.frame(100, 30);
  assert.equal(ui.scrollState.top, 0);
  await ui.key('', { name: 'tab', ctrl: true }); ui.frame(100, 30); assert.equal(ui.scrollState.top, position);
  await ui.key('', { name: 'f6' }); assert.equal(ui.workerFocus, 'list');
  await ui.key('', { name: 'up', ctrl: true }); ui.frame(100, 30);
  assert.equal(ui.worker.id, 'w1'); assert.equal(ui.scrollState.top, position - 1);
  await ui.key('', { name: 'down' }); ui.frame(100, 30); assert.equal(ui.worker.id, 'w2');
  assert.equal(ui.scrollState.top, null);
  await ui.command('/select w1'); ui.frame(100, 30); assert.equal(ui.scrollState.top, position - 1);
});

test('messages have separate role borders and indented multiline bodies, including evidence and folded groups', async () => {
  const { ui, service } = navigationUI();
  service.store.history = () => [
    { seq: 1, time: '2026-11-03T08:00:00Z', type: 'manager_input', data: { role: 'user', text: '第一行\n\tconst value = 1;\n\n下一段' } },
    { seq: 2, type: 'message', data: { role: 'assistant', text: '正式答复' } },
    { seq: 3, type: 'message', data: { role: 'tool', text: 'inspect worker' } },
    { seq: 4, type: 'reported_result', data: { status: 'succeeded', summary: '任务完成', evidence: '18 项通过' } }
  ];
  const lines = ui.conversation('w1', 60), text = lines.join('\n');
  assert.equal(lines.filter(line => line.startsWith('╭')).length, 4);
  assert.match(text, /╭─ 用户 · #1/); assert.match(text, /╭─ Worker · #2/); assert.match(text, /后台过程 #1/);
  assert.ok(lines.some(line => line.startsWith('│') && line.includes('const value = 1;')));
  assert.ok(lines.some(line => line.startsWith('│  下一段')));
  assert.match(text, /验证证据：/); assert.match(text, /18 项通过/);
  assert.doesNotMatch(text, /inspect worker|\t/);
  assert.ok(lines.filter(Boolean).every(line => line === fit(line, 60)), 'borders remain aligned with Chinese text');
});

test('Manager view shows only user-manager conversation while status rows summarize workers and callbacks', () => {
  const { ui, service, state } = navigationUI();
  state.managerBusy = true;
  state.manager.active = ['m1'];
  state.manager.pending = [{ id: 'm2', text: 'queued', queued: true }];
  state.notifications = [{ type: 'worker_finished' }, { type: 'worker_progress' }];
  service.store.history = () => [
    { seq: 1, type: 'manager_input', data: { role: 'user', text: '用户问题' } },
    { seq: 2, type: 'message', data: { role: 'tool', text: '内部工具细节' } },
    { seq: 3, type: 'message', data: { role: 'assistant', text: '后台思考', background: true } },
    { seq: 4, type: 'message', data: { role: 'assistant', text: '给用户的答复' } },
    { seq: 5, type: 'reported_result', data: { role: 'result', summary: 'worker 内部结果' } }
  ];
  const conversation = ui.conversation('manager', 80).join('\n');
  assert.match(conversation, /用户问题/);
  assert.match(conversation, /给用户的答复/);
  assert.doesNotMatch(conversation, /内部工具细节|后台思考|worker 内部结果/);
  const frame = ui.frame(100, 30).join('\n');
  assert.match(frame, /正在与用户对话/);
  assert.match(frame, /1 个任务待处理/);
  assert.doesNotMatch(frame, /内部工具细节/);
});

test('a clipped long message keeps its sender visible while all body lines remain reachable by scrolling', async () => {
  const { ui, service } = navigationUI();
  service.store.history = () => [{ seq: 7, type: 'message', data: { role: 'assistant', text: Array.from({ length: 50 }, (_, i) => `长消息第 ${i} 行`).join('\n') } }];
  let frame = ui.frame(80, 24);
  assert.ok(frame.some(line => /Manager · #7 · 续/.test(line)));
  assert.ok(frame.some(line => line.includes('长消息第 49 行')));
  const seen = new Set();
  await ui.key('', { name: 'up', shift: true });
  for (let i = 0; i < 55; i++) {
    frame = ui.frame(80, 24);
    for (const line of frame) { const match = /长消息第 (\d+) 行/.exec(line); if (match) seen.add(Number(match[1])); }
    await ui.key('', { name: 'down', ctrl: true });
  }
  assert.equal(seen.size, 50);
});

test('Tab fills completion while Enter always executes the current input', async () => {
  const { ui, service } = navigationUI(); const actions = [];
  service.controlWorker = async (...args) => actions.push(args);
  ui.input = '/ca';
  await ui.key('', { name: 'tab' });
  assert.equal(ui.input, '/cancel'); assert.equal(ui.screen, 'manager'); assert.deepEqual(actions, []);
  await ui.key('', { name: 'return' }); assert.equal(actions.length, 1);
  ui.input = '/';
  const highlighted = ui.completion.items[1].value;
  await ui.key('', { name: 'down' });
  assert.equal(ui.completionIndex, 1); assert.equal(ui.selected, 0);
  await ui.key('', { name: 'tab' });
  assert.equal(ui.input, highlighted, 'Tab on a highlighted suggestion fills it');
  ui.input = '/ap'; await ui.key('', { name: 'escape' });
  assert.equal(ui.completion.open, false); assert.equal(ui.input, '/ap');
  await ui.key('', { name: 'tab' }); assert.equal(ui.screen, 'manager', 'Tab does nothing when completion is closed');
  await ui.key('', { name: 'tab', ctrl: true }); assert.equal(ui.screen, 'workers');
  await ui.key('', { name: 'tab', ctrl: true }); assert.equal(ui.screen, 'manager');
  ui.input = '/help';
  assert.equal(ui.completion.open, true);
  await ui.key('', { name: 'return' });
  assert.equal(ui.panel, 'help', 'Enter executes a no-argument command even while completion is visible');
});

test('command suggestions render as inline input previews without a separate menu', async () => {
  const { ui } = navigationUI();
  ui.input = '/ca';
  const preview = ui.inputPresentation(80);
  assert.equal(preview.ghost, 'ncel');
  assert.match(preview.plain, /^> \/cancel /);

  const frame = ui.frame(80, 24);
  assert.ok(frame.at(-1).includes('/cancel'));
  assert.ok(frame.every(line => !/补全 \d+\/\d+|▶ \/cancel/.test(line)));

  ui.input = '/';
  await ui.key('', { name: 'down' });
  assert.equal(ui.input, '/');
  assert.notEqual(ui.inputPresentation(80).ghost, 'help');
  await ui.key('', { name: 'escape' });
  assert.equal(ui.input, '/');
  assert.equal(ui.inputPresentation(80).ghost, '');
  assert.ok(!ui.frame(80, 24).at(-1).includes('Tab 填入'));
});

test('approval IDs update from live state and completing one requires a separate Enter to approve', async () => {
  const { ui, service } = navigationUI(); const approved = [];
  service.approvals = new Map([['approval_a', { id: 'approval_a', actor: 'w0', detail: { reason: '测试' } }]]);
  service.respondApproval = id => { approved.push(id); service.approvals.delete(id); };
  ui.input = '/approve'; await ui.key('', { name: 'tab' });
  assert.equal(ui.input, '/approve '); assert.equal(ui.completion.items.length, 1);
  await ui.key('', { name: 'tab' }); assert.equal(ui.input, '/approve approval_a'); assert.deepEqual(approved, []);
  await ui.key('', { name: 'return' }); assert.deepEqual(approved, ['approval_a']);
  ui.input = '/approve '; assert.equal(ui.completion.items.length, 0); assert.match(ui.completion.hint, /无待审批/);
});

test('completion menus fit narrow screens without hiding input or pending approvals', async () => {
  const { ui, state } = navigationUI();
  state.approvals.push({ id: 'a1', actor: 'w0', detail: {} });
  for (const panel of ['manager', 'chat']) {
    await ui.showPanel(panel);
    for (const input of ['/', '/approve ', '/select w', '/missing']) {
      ui.input = input;
      for (const columns of [24, 60, 100]) for (const rows of [12, 24, 40]) {
        const frame = ui.frame(columns, rows);
        assert.equal(frame.length, rows);
        assert.ok(frame.every(line => line === fit(line, columns)));
        assert.ok(frame.some(line => line.includes('审批 a1')));
        assert.ok(frame.at(-1).includes(input));
      }
    }
  }
});

test('file suggestions read only the selected workspace and discard stale directory responses', async () => {
  const { ui, service } = navigationUI(); let resolveOld;
  service.git.files = async (worker, directory) => directory === 'src/' ? new Promise(resolve => { resolveOld = resolve; }) : [{ name: '中文 页面.html' }, { name: 'test', directory: true }];
  ui.input = '/open src/'; const old = ui.loadCompletionFiles();
  ui.input = '/open docs/'; await ui.loadCompletionFiles();
  resolveOld([{ name: 'stale.js' }]); await old;
  assert.deepEqual(ui.completion.items.map(i => i.value), ['/open docs/test/', '/open docs/中文 页面.html']);
  ui.input = '/open docs/中'; await ui.key('', { name: 'tab' });
  assert.equal(ui.input, '/open docs/中文 页面.html');
  await ui.key('', { name: 'tab', ctrl: true }); assert.equal(ui.screen, 'workers');
});
