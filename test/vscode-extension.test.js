import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

test('VSCode extension registers Last Order commands and worker tree', async () => {
  const require = createRequire(import.meta.url);
  const commands = [], disposables = [];
  let treeRegistered = false;
  class EventEmitter {
    constructor() { this.listeners = []; this.event = listener => { this.listeners.push(listener); return { dispose() {} }; }; }
    fire(value) { for (const listener of this.listeners) listener(value); }
  }
  class TreeItem {
    constructor(label, state) { this.label = label; this.collapsibleState = state; }
  }
  const fake = {
    EventEmitter, TreeItem,
    TreeItemCollapsibleState: { None: 0 },
    StatusBarAlignment: { Left: 1 },
    ProgressLocation: { Notification: 15 },
    ViewColumn: { Beside: 2 },
    Uri: { file: value => ({ fsPath: value }), parse: value => value },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    window: {
      createOutputChannel: () => ({ append() {}, appendLine() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      registerTreeDataProvider: () => { treeRegistered = true; return { dispose() {} }; },
      registerWebviewViewProvider: () => ({ dispose() {} }),
      withProgress: async (_options, task) => task(),
      showErrorMessage() {}, showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined, showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      createTerminal: () => ({ show() {}, sendText() {} })
    },
    workspace: {
      workspaceFolders: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      registerTextDocumentContentProvider: () => ({ dispose() {} })
    },
    commands: {
      registerCommand: (name, callback) => { commands.push(name); const disposable = { dispose() {} }; disposables.push(disposable); return disposable; },
      executeCommand: async () => {}
    },
    env: { openExternal: async uri => { fake.opened = uri; }, clipboard: { writeText: async text => { fake.copied = text; } } }
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return fake;
    return originalLoad.call(this, request, parent, isMain);
  };
  const extensionPath = new URL('../vscode-extension', import.meta.url).pathname;
  const context = { extensionPath, subscriptions: [] };
  let extension;
  try {
    extension = require('../vscode-extension/extension.js');
    await extension.activate(context);
    assert.deepEqual(commands.sort(), [
      'missionControl.archiveWorker',
      'missionControl.createCheckpoint',
      'missionControl.editWorkerNotes',
      'missionControl.handBackWorker',
      'missionControl.openManager', 'missionControl.openMonitor', 'missionControl.openTui',
      'missionControl.openWorker',
      'missionControl.openWorkerDiff', 'missionControl.openWorkerWorktree',
      'missionControl.refresh', 'missionControl.restoreCheckpoint', 'missionControl.sendContext',
      'missionControl.start', 'missionControl.stop', 'missionControl.switchScreen', 'missionControl.takeOverWorker'
    ]);
    assert.equal(treeRegistered, true);
    const manifest = JSON.parse(await readFile(new URL('../vscode-extension/package.json', import.meta.url), 'utf8'));
    assert.ok(manifest.contributes.keybindings.some(binding =>
      binding.key === 'ctrl+tab' && binding.when.includes('missionControl.managerFocus') && binding.when.includes('webviewId == missionControl.manager')
    ));
    assert.ok(manifest.contributes.views.missionControl.some(view => view.id === 'missionControl.diff'));
    const diffController = await readFile(new URL('../vscode-extension/git-diff-viewer/out/src/controller.js', import.meta.url), 'utf8');
    assert.match(diffController, /const VIEW_ID = "missionControl\.diff"/);
    const extensionSource = await readFile(new URL('../vscode-extension/extension.js', import.meta.url), 'utf8');
    assert.match(extensionSource, /Attach image/);
    assert.match(extensionSource, /type: 'pickImages'/);
    assert.match(extensionSource, /attachmentTray/);
    assert.equal(extension.filterTerminalSelection([
      '────────────────────────',
      '╭─ 用户 · #2 · 14:51:51────────╮',
      '│  这是用户消息  │',
      '╰──────────────────────────────╯'
    ].join('\n')), '用户 · #2 · 14:51:51\n 这是用户消息');
    await extension.openExternalLink('javascript:alert(1)');
    assert.equal(fake.opened, undefined);
    await extension.openExternalLink('lastorder-copy:' + Buffer.from('git status').toString('base64url'));
    assert.equal(fake.copied, 'git status');
    await extension.openExternalLink('https://openai.com/docs');
    assert.equal(fake.opened, 'https://openai.com/docs');
  } finally {
    await extension?.deactivate();
    Module._load = originalLoad;
  }
});
