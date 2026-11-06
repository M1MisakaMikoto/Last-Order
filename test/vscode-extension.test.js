import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { temporary, cleanup } from './helpers.js';

test('VSCode extension registers Last Order commands and worker tree', async () => {
  const require = createRequire(import.meta.url);
  const commands = [], disposables = [];
  let treeRegistered = false;
  let webviewProvider;
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
      registerWebviewViewProvider: (_id, provider) => { webviewProvider = provider; return { dispose() {} }; },
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
  const extensionPath = fileURLToPath(new URL('../vscode-extension', import.meta.url));
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
      'missionControl.openManager',
      'missionControl.openWorker',
      'missionControl.openWorkerDiff', 'missionControl.openWorkerWorktree',
      'missionControl.refresh', 'missionControl.restoreCheckpoint', 'missionControl.sendContext',
      'missionControl.start', 'missionControl.stop', 'missionControl.switchScreen', 'missionControl.takeOverWorker'
    ]);
    assert.equal(treeRegistered, true);
    const view = {
      webview: {
        options: {},
        html: '',
        asWebviewUri: uri => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
        onDidReceiveMessage: callback => { view.receiveMessage = callback; return { dispose() {} }; },
        postMessage: () => {}
      },
      onDidDispose: () => ({ dispose() {} })
    };
    webviewProvider.resolveWebviewView(view);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(view.webview.html, /id="manager-messages"/);
    assert.match(view.webview.html, /id="composer-input"/);
    assert.doesNotMatch(view.webview.html, /__(?:CSP|STYLE|SCRIPT|NONCE|UI_RUNTIME)__/);
    const commandCatalog = view.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(commandCatalog?.includes('function commandCompletions('), 'Webview shares the TUI command catalog');
    assert.ok(commandCatalog?.includes('class TerminalUI'), 'Webview shares the actual TUI controller');
    assert.doesNotMatch(commandCatalog, /process\.stdout|TerminalInput|emitKeypressEvents/, 'native DOM runtime omits terminal transport');
    assert.doesNotThrow(() => new Function(commandCatalog));
    const manifest = JSON.parse(await readFile(new URL('../vscode-extension/package.json', import.meta.url), 'utf8'));
    assert.ok(manifest.contributes.keybindings.some(binding =>
      binding.key === 'ctrl+tab' && binding.when.includes('missionControl.managerFocus') && binding.when.includes('webviewId == missionControl.manager')
    ));
    assert.ok(manifest.contributes.views.missionControl.some(view => view.id === 'missionControl.diff'));
    const diffController = await readFile(new URL('../vscode-extension/git-diff-viewer/out/src/controller.js', import.meta.url), 'utf8');
    assert.match(diffController, /const VIEW_ID = "missionControl\.diff"/);
    const extensionSource = await readFile(new URL('../vscode-extension/extension.js', import.meta.url), 'utf8');
    assert.match(extensionSource, /health\.protocol === CONTROL_PROTOCOL_VERSION && health\.version === expectedVersion/);
    assert.match(extensionSource, /Stopping incompatible Last Order backend/);
    assert.match(extensionSource, /manager\.command = \{ command: 'missionControl\.openManager'/);
    assert.match(extensionSource, /statusBar\.command = 'missionControl\.openManager'/);
    assert.match(extensionSource, /command: 'missionControl\.openWorker', title: 'Open Worker'/);
    assert.doesNotMatch(extensionSource, /ManagerTuiViewProvider|tui-webview-host|@xterm/);
    assert.match(extensionSource, /message\.type === 'pasteImages'/);
    assert.doesNotMatch(extensionSource, /showOpenDialog|pickImages/);
    assert.doesNotMatch(extensionSource, /manager\.command = \{ command: 'missionControl\.openTui'/);
    assert.ok(!manifest.contributes.menus['view/title'].some(item => item.command === 'missionControl.openTui'));
    assert.ok(!manifest.contributes.commands.some(item => item.command === 'missionControl.openTui'));
    await extension.openExternalLink('javascript:alert(1)');
    assert.equal(fake.opened, undefined);
    await extension.openExternalLink('lastorder-copy:' + Buffer.from('git status').toString('base64url'));
    assert.equal(fake.copied, 'git status');
    await extension.openExternalLink('https://openai.com/docs');
    assert.equal(fake.opened, 'https://openai.com/docs');
    const projectRoot = await temporary('last-order-projects-');
    try {
      await Promise.all([
        mkdir(path.join(projectRoot, 'alpha', '.git'), { recursive: true }),
        mkdir(path.join(projectRoot, 'beta', '.git'), { recursive: true })
      ]);
      const discovered = await extension.discoverProjectRoots(projectRoot);
      assert.deepEqual(discovered.map(root => path.basename(root)), ['alpha', 'beta']);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
      const pasted = await extension.writePastedImage({
        name: 'Clipboard Shot.png', mime: 'image/png', data: png.toString('base64')
      }, projectRoot);
      assert.equal(pasted.name, 'Clipboard Shot.png');
      assert.equal(pasted.mime, 'image/png');
      assert.equal(pasted.size, png.length);
      assert.deepEqual(await readFile(pasted.path), png);
      await assert.rejects(extension.writePastedImage({
        name: 'invalid.png', mime: 'image/png', data: Buffer.from('not an image').toString('base64')
      }, projectRoot), /valid image/);
    } finally {
      await cleanup(projectRoot);
    }
  } finally {
    await extension?.deactivate();
    Module._load = originalLoad;
  }
});
