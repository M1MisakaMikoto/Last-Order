const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { promisify } = require('util');

const execFile = promisify(cp.execFile);
let extensionContext;
let output;
let client;
let serviceProcess;
let ownsService = false;
let refreshTimer;
let treeProvider;
let statusBar;
let refreshing = false;
let lastStatus;
let managerTuiProvider;
const seenApprovals = new Set();
const seenQuestions = new Set();
let tuiTerminal;

class ControlClient {
  constructor(info) {
    this.info = info;
  }

  request(method, route, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(route, this.info.url);
      const request = http.request(url, {
        method,
        headers: {
          authorization: `Bearer ${this.info.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        }
      }, response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          let value = {};
          try { value = data ? JSON.parse(data) : {}; }
          catch { return reject(new Error(`Invalid Last Order response (${response.statusCode})`)); }
          if (response.statusCode >= 400) return reject(new Error(value.error || `Last Order HTTP ${response.statusCode}`));
          resolve(value);
        });
      });
      request.on('error', reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  }

  health() {
    return this.request('GET', '/health');
  }
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function resolveRepositoryRoot(root = workspaceRoot()) {
  if (!root) return undefined;
  try {
    return (await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: root })).stdout.trim();
  } catch {}
  const skip = new Set(['.git', '.tmp', 'node_modules', 'vendor', 'coverage', 'dist', 'build', '.next', '.venv']);
  async function visit(directory, depth) {
    try {
      if (fs.existsSync(path.join(directory, '.git'))) return directory;
      if (depth >= 3) return undefined;
      const entries = (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (!entry.isDirectory() || skip.has(entry.name)) continue;
        const found = await visit(path.join(directory, entry.name), depth + 1);
        if (found) return found;
      }
    } catch {}
    return undefined;
  }
  return visit(root, 0);
}

async function dataDirectory(root) {
  const common = (await execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })).stdout.trim();
  return path.join(common, 'last-order');
}

async function readControlInfo(root) {
  const canonical = await dataDirectory(root);
  for (const directory of [canonical, path.join(path.dirname(canonical), 'lastorder')]) {
    try { return JSON.parse(await fsp.readFile(path.join(directory, 'control.json'), 'utf8')); }
    catch {}
  }
  return null;
}

function serviceScript() {
  const configured = vscode.workspace.getConfiguration('missionControl').get('serviceScript', '').trim();
  if (configured) return configured;
  return backendFile('bin/mission-control.js');
}

function backendFile(relative) {
  const bundled = path.resolve(extensionContext.extensionPath, 'backend', relative);
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(extensionContext.extensionPath, '..', relative);
}

function nodeExecutable() {
  const configured = vscode.workspace.getConfiguration('missionControl').get('nodePath', '').trim();
  if (configured) return configured;
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Node.js executable not found. Set missionControl.nodePath.');
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Last Order startup timed out'));
    }, 45_000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        output.appendLine(line);
        if (line.startsWith('MISSION_CONTROL_READY ')) {
          clearTimeout(timer);
          resolve(JSON.parse(line.slice('MISSION_CONTROL_READY '.length)));
        }
      }
    });
    child.stderr.on('data', chunk => {
      const value = chunk.toString();
      stderr += value;
      output.append(value);
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (stdout.trim()) output.appendLine(stdout.trim());
      clearTimeout(timer);
      reject(new Error(`Last Order backend exited (${code}). ${stderr.trim()}`));
    });
  });
}

async function ensureClient() {
  if (client) {
    try { await client.health(); return client; } catch { client = undefined; }
  }
  const workspace = workspaceRoot();
  if (!workspace) throw new Error('Open a project folder before starting Last Order');
  const root = await resolveRepositoryRoot(workspace);
  if (!root) throw new Error('No Git repository found in the opened workspace');
  const existing = await readControlInfo(root);
  if (existing) {
    const candidate = new ControlClient(existing);
    try {
      await candidate.health();
      client = candidate;
      ownsService = false;
      output.appendLine(`Attached to Last Order backend ${existing.url}`);
      return client;
    } catch {
      output.appendLine('Ignoring stale Last Order backend control.json');
    }
  }
  const script = serviceScript();
  if (!fs.existsSync(script)) throw new Error(`Last Order backend script not found: ${script}. Set missionControl.serviceScript.`);
  const node = nodeExecutable();
  output.appendLine(`Starting Last Order backend: ${node} ${script} --project ${root}`);
  serviceProcess = cp.spawn(node, [script, '--project', root], {
    cwd: path.dirname(script),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ownsService = true;
  const info = await waitForReady(serviceProcess);
  client = new ControlClient(info);
  return client;
}

async function refreshState() {
  if (!client || refreshing) return lastStatus;
  refreshing = true;
  try {
    const status = await client.request('GET', '/status');
    lastStatus = status;
    treeProvider?.setStatus(status);
    const visibleWorkers = Object.values(status.snapshot.workers || {}).filter(worker => !worker.archivedAt);
    statusBar.text = `$(radio-tower) LO: ${visibleWorkers.length}`;
    statusBar.tooltip = 'Open Last Order Manager';
    void handlePendingRequests(status);
    return status;
  } catch (error) {
    output.appendLine(`Last Order backend refresh failed: ${error.message}`);
    return lastStatus;
  } finally {
    refreshing = false;
  }
}

async function handlePendingRequests(status) {
  for (const approval of status.snapshot.approvals || []) {
    if (seenApprovals.has(approval.id)) continue;
    seenApprovals.add(approval.id);
    const detail = approval.detail || {};
    const reason = detail.reason || detail.command || detail.tool || JSON.stringify(detail).slice(0, 500);
    const choice = await vscode.window.showWarningMessage(`Last Order approval [${approval.actor}]: ${reason}`, 'Approve', 'Deny');
    if (choice) {
      try { await client.request('POST', `/approval/${encodeURIComponent(approval.id)}`, { allowed: choice === 'Approve' }); }
      catch (error) { vscode.window.showErrorMessage(error.message); }
      await refreshState();
    }
  }
  for (const question of status.snapshot.questions || []) {
    if (seenQuestions.has(question.id)) continue;
    seenQuestions.add(question.id);
    const detail = question.detail || {};
    const prompt = detail.question || detail.questions?.[0]?.question || JSON.stringify(detail).slice(0, 500);
    const answer = await vscode.window.showInputBox({ prompt: `Last Order question [${question.actor}]`, placeHolder: prompt });
    if (answer !== undefined) {
      try { await client.request('POST', `/question/${encodeURIComponent(question.id)}`, { answer }); }
      catch (error) { vscode.window.showErrorMessage(error.message); }
      await refreshState();
    }
  }
}

function workerById(id) {
  return lastStatus?.snapshot?.workers?.[id];
}

async function pickWorker(title = 'Select worker') {
  const status = lastStatus || await refreshState();
  const workers = Object.values(status?.snapshot?.workers || {}).filter(worker => !worker.archivedAt);
  if (!workers.length) throw new Error('No workers are available');
  const picked = await vscode.window.showQuickPick(workers.map(worker => ({
    label: worker.title || worker.id,
    description: `${worker.status} · ${worker.provider || ''}${worker.model ? '/' + worker.model : ''}`,
    worker
  })), { title });
  return picked?.worker;
}

function managerTuiHtml(webview) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const asset = relative => webview.asWebviewUri(vscode.Uri.file(path.join(extensionContext.extensionPath, relative))).toString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('node_modules/@xterm/xterm/css/xterm.css')}">
<style>
  html, body, #terminal { width:100%; height:100%; margin:0; padding:0; overflow:hidden; background:var(--vscode-editor-background); }
  #terminal { box-sizing:border-box; padding:6px; }
  #overlay { position:fixed; inset:0; display:none; align-items:center; justify-content:center; flex-direction:column; gap:10px; background:color-mix(in srgb, var(--vscode-editor-background) 92%, transparent); color:var(--vscode-foreground); font-family:var(--vscode-font-family); }
  #overlay.visible { display:flex; }
  button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:6px 12px; cursor:pointer; }
</style>
</head>
<body>
<div id="terminal"></div>
<div id="overlay"><span id="message">Last Order TUI stopped.</span><button id="restart">Restart TUI</button></div>
<script nonce="${nonce}" src="${asset('node_modules/@xterm/xterm/lib/xterm.js')}"></script>
<script nonce="${nonce}" src="${asset('node_modules/@xterm/addon-fit/lib/addon-fit.js')}"></script>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const style = getComputedStyle(document.body);
  const read = name => style.getPropertyValue(name).trim();
  const terminal = new Terminal({
    cursorBlink: true,
    convertEol: false,
    fontFamily: read('--vscode-editor-font-family') || 'Consolas, monospace',
    fontSize: Math.max(11, Number(read('--vscode-editor-font-size').replace('px','')) || 13),
    lineHeight: 1.15,
    scrollback: 1000,
    linkHandler: {
      allowNonHttpProtocols: true,
      activate: (_event, url) => vscode.postMessage({ type: 'openExternal', url })
    },
    theme: {
      background: read('--vscode-editor-background') || '#1e1e1e',
      foreground: read('--vscode-editor-foreground') || '#d4d4d4',
      cursor: read('--vscode-editorCursor-foreground') || '#aeafad',
      selectionBackground: read('--vscode-editor-selectionBackground') || '#264f78'
    }
  });
  const fit = new FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(document.getElementById('terminal'));
  fit.fit();
  terminal.focus();
  terminal.attachCustomKeyEventHandler(event => {
    if (event.type === 'keydown' && event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'Enter') {
      vscode.postMessage({ type: 'newlineInput' });
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    if (event.type === 'keydown' && event.ctrlKey && !event.altKey && (event.key === 'Tab' || event.code === 'Tab')) {
      vscode.postMessage({ type: 'switchScreen' });
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    if (event.type === 'keydown' && event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
      const text = terminal.getSelection();
      if (text) {
        vscode.postMessage({ type: 'copySelection', text });
        terminal.clearSelection();
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    }
    return true;
  });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.altKey && (event.key === 'Tab' || event.code === 'Tab')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      vscode.postMessage({ type: 'switchScreen' });
    }
  }, true);
  window.addEventListener('focus', () => vscode.postMessage({ type: 'focusChanged', focused: true }));
  window.addEventListener('blur', () => vscode.postMessage({ type: 'focusChanged', focused: false }));
  document.addEventListener('visibilitychange', () => vscode.postMessage({ type: 'focusChanged', focused: !document.hidden }));
  terminal.attachCustomWheelEventHandler(event => {
    const button = event.deltaY < 0 ? 64 : 65;
    vscode.postMessage({ type: 'input', data: \`\\x1b[<\${button};1;1M\` });
    event.preventDefault();
    event.stopPropagation();
    return false;
  });
  const sendSize = () => vscode.postMessage({ type: 'resize', columns: terminal.cols, rows: terminal.rows });
  terminal.onData(data => vscode.postMessage({ type: 'input', data }));
  terminal.onResize(sendSize);
  new ResizeObserver(() => { fit.fit(); sendSize(); }).observe(document.getElementById('terminal'));
  document.getElementById('restart').addEventListener('click', () => {
    document.getElementById('overlay').classList.remove('visible');
    terminal.reset();
    vscode.postMessage({ type: 'restart' });
  });
  window.addEventListener('message', event => {
    const data = event.data;
    if (data.type === 'output') terminal.write(data.data);
    if (data.type === 'exit') {
      document.getElementById('message').textContent = data.message || 'Last Order TUI stopped.';
      document.getElementById('overlay').classList.add('visible');
    }
  });
  requestAnimationFrame(() => { fit.fit(); sendSize(); terminal.focus(); });
</script>
</body>
</html>`;
}

function filterTerminalSelection(text) {
  return String(text ?? '').split(/\r?\n/).map(line => line
    .replace(/^[╭├]─\s*/, '')
    .replace(/^│\s?/, '')
    .replace(/\s*─*[╮┤]$/, '')
    .replace(/\s*│$/, '')
  ).filter(line => !/^[\s╭╮╰╯─│├┤┬┴┼]+$/u.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

class ManagerTuiViewProvider {
  constructor() { this.view = null; this.host = null; }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(extensionContext.extensionPath, 'node_modules'))]
    };
    view.webview.html = managerTuiHtml(view.webview);
    view.webview.onDidReceiveMessage(message => this.message(message));
    view.onDidDispose(() => this.stopHost());
    void this.startHost();
  }
  message(message) {
    if (message.type === 'restart') { this.stopHost(); setTimeout(() => void this.startHost(), 100); return; }
    if (message.type === 'copySelection') {
      void vscode.env.clipboard.writeText(filterTerminalSelection(message.text));
      return;
    }
    if (message.type === 'openExternal') {
      void openExternalLink(message.url);
      return;
    }
    if (message.type === 'switchScreen') {
      if (this.host?.connected) this.host.stdin.write(JSON.stringify({ type: 'switchScreen' }) + '\n');
      return;
    }
    if (message.type === 'focusChanged') {
      void vscode.commands.executeCommand('setContext', 'missionControl.managerFocus', Boolean(message.focused));
      return;
    }
    if (message.type === 'submitInput') {
      if (this.host?.connected) this.host.stdin.write(JSON.stringify({ type: 'submitInput' }) + '\n');
      return;
    }
    if (message.type === 'newlineInput') {
      if (this.host?.connected) this.host.stdin.write(JSON.stringify({ type: 'newlineInput' }) + '\n');
      return;
    }
    if (!this.host?.connected) return;
    if (message.type === 'input') this.host.stdin.write(JSON.stringify({ type: 'input', data: message.data }) + '\n');
    if (message.type === 'resize') this.host.stdin.write(JSON.stringify({ type: 'resize', columns: message.columns, rows: message.rows }) + '\n');
  }
  async startHost() {
    if (this.host || !this.view) return;
    await ensureClient();
    const root = workspaceRoot();
  const script = backendFile('bin/tui-webview-host.js');
    this.host = cp.fork(script, ['--project', root], {
      execPath: nodeExecutable(), cwd: path.dirname(script), env: process.env,
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    const host = this.host;
    host.stdout.on('data', chunk => this.view?.webview.postMessage({ type: 'output', data: chunk.toString() }));
    host.stderr.on('data', chunk => output.append(chunk.toString()));
    host.on('message', message => {
      if (message.type === 'openMonitor') void openMonitor(message.worker, message);
      if (message.type === 'disconnected') this.view?.webview.postMessage({ type: 'exit', message: 'Last Order backend disconnected.' });
    });
    host.on('exit', code => {
      if (this.host === host) this.host = null;
      this.view?.webview.postMessage({ type: 'exit', message: code === 42 ? 'Last Order reloaded.' : 'Last Order TUI stopped.' });
      if (code === 42) setTimeout(() => void this.reloadWindow(), 800);
    });
  }
  async reloadWindow() {
    try {
      await extensionContext.workspaceState?.update?.('missionControl.reloadRequested', true);
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch {
      await this.startHost();
    }
  }
  stopHost() {
    if (!this.host) return;
    const host = this.host;
    this.host = null;
    try { host.disconnect(); } catch {}
    try { host.kill(); } catch {}
  }
  switchScreen() {
    if (this.host?.connected) this.host.stdin.write(JSON.stringify({ type: 'switchScreen' }) + '\n');
  }
}

async function openExternalLink(value) {
  const target = String(value ?? '').trim();
  if (!target) return;
  if (/^(?:https?:\/\/|mailto:)/i.test(target)) {
    await vscode.env.openExternal(vscode.Uri.parse(target));
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return;
  const root = workspaceRoot();
  const file = path.resolve(root, target.replace(/^\.\//, '').split('#')[0]);
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return;
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
}

async function openManager() {
  await ensureClient();
  await vscode.commands.executeCommand('workbench.view.extension.missionControlManager');
  await vscode.commands.executeCommand('missionControl.manager.focus');
}

async function openWorker(worker) {
  worker = worker || await pickWorker('Open worker');
  if (worker) await openMonitor(worker);
}

async function openTui() {
  await ensureClient();
  if (tuiTerminal) { tuiTerminal.show(); return; }
  const root = workspaceRoot();
  const script = backendFile('bin/last-order.js');
  tuiTerminal = vscode.window.createTerminal({
    name: 'Last Order',
    cwd: root,
    location: { viewColumn: vscode.ViewColumn.Beside },
    shellPath: nodeExecutable(),
    shellArgs: [script, '--project', root]
  });
  const terminal = tuiTerminal;
  const disposable = terminal.onDidClose?.(() => {
    if (tuiTerminal === terminal) tuiTerminal = undefined;
    disposable?.dispose?.();
  });
  terminal.show();
}

async function switchLastOrderScreen() {
  if (managerTuiProvider?.host?.connected) managerTuiProvider.switchScreen();
  else await openManager();
}

async function openWorktree(worker) {
  if (!worker?.workspace) {
    const status = lastStatus || await refreshState();
    worker = workerById(worker.id) || worker;
  }
  if (!worker?.workspace) throw new Error('Worker workspace is not ready');
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worker.workspace), { forceNewWindow: true });
}

async function openWorkerDiff(worker) {
  await ensureClient();
  worker = worker || await pickWorker('Open worker diff');
  if (!worker) return;
  const files = await client.git.changedFiles(worker);
  if (!files.length) {
    vscode.window.showInformationMessage('This worker has no changed files against its base commit.');
    return;
  }
  const picked = await vscode.window.showQuickPick(files.map(file => ({
    label: file.path,
    description: file.status
  })), { title: `Changed files · ${worker.title || worker.id}` });
  if (!picked) return;
  const query = ref => new URLSearchParams({ worker: worker.id, ref }).toString();
  const base = vscode.Uri.from({ scheme: 'mission-control', path: '/' + picked.label, query: query('base') });
  const current = vscode.Uri.from({ scheme: 'mission-control', path: '/' + picked.label, query: query('worktree') });
  await vscode.commands.executeCommand('vscode.diff', base, current, `${worker.title || worker.id}: ${picked.label}`, { preview: true });
}

async function editWorkerNotes(worker) {
  await ensureClient();
  worker = worker || await pickWorker('Edit worker notes');
  if (!worker) return;
  const value = await vscode.window.showInputBox({
    title: 'Manager notes (one per line)',
    value: (worker.notes || []).join('\n'),
    prompt: 'These notes are visible to the manager in Last Order callbacks.'
  });
  if (value === undefined) return;
  const notes = value.split(/\r?\n/).map(note => note.trim()).filter(Boolean);
  await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/notes`, { notes });
  vscode.window.showInformationMessage(`Updated notes for ${worker.title || worker.id}`);
  await refreshState();
}

async function takeOverWorker(worker) {
  await ensureClient();
  worker = worker || await pickWorker('Take over worker');
  if (!worker) return;
  if (['starting', 'running', 'waiting_approval'].includes(worker.status)) {
    await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/control`, {
      action: 'pause', reason: 'Manual takeover from VSCode'
    });
    await refreshState();
  }
  await openWorktree(workerById(worker.id) || worker);
}

async function handBackWorker(worker) {
  await ensureClient();
  worker = worker || await pickWorker('Hand worker back');
  if (!worker) return;
  const note = await vscode.window.showInputBox({
    title: 'Hand worker back',
    prompt: 'Describe what you changed and what the worker should do next.',
    placeHolder: '例如：我已手动修复布局问题，请继续完成移动端验证'
  });
  if (note === undefined) return;
  const current = workerById(worker.id) || worker;
  const notes = [...(current.notes || []), `[VSCode hand-back ${new Date().toISOString()}] ${note}`];
  await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/notes`, { notes });
  await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/message`, {
    text: `User handed this worker back after manual edits. Changes: ${note}\nInspect the current worktree before continuing.`
  });
  if (current.status === 'paused') {
    await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/control`, {
      action: 'resume', reason: 'Manual edits handed back from VSCode'
    });
  }
  vscode.window.showInformationMessage(`Worker ${worker.title || worker.id} resumed with your hand-back note.`);
  await refreshState();
}

async function createCheckpoint() {
  await ensureClient();
  const label = await vscode.window.showInputBox({
    title: 'Create Last Order checkpoint',
    prompt: 'Optional checkpoint label',
    placeHolder: '例如：before refactor'
  });
  if (label === undefined) return;
  const result = await client.request('POST', '/checkpoints', { label });
  vscode.window.showInformationMessage(`Checkpoint created: ${result.checkpoint.id}`);
  await refreshState();
}

async function restoreCheckpoint() {
  await ensureClient();
  const checkpoints = (await client.request('GET', '/checkpoints')).checkpoints;
  if (!checkpoints.length) {
    vscode.window.showInformationMessage('No Last Order checkpoints are available.');
    return;
  }
  const checkpoint = await vscode.window.showQuickPick(checkpoints.map(item => ({
    label: item.label || item.id,
    description: item.id,
    detail: item.createdAt,
    checkpoint: item
  })), { title: 'Restore Last Order checkpoint' });
  if (!checkpoint) return;
  const mode = await vscode.window.showQuickPick([
    { label: 'Restore files and fork conversation', value: 'all' },
    { label: 'Restore files only', value: 'files' },
    { label: 'Fork conversation only', value: 'conversation' }
  ], { title: 'Checkpoint restore scope' });
  if (!mode) return;
  const confirm = await vscode.window.showWarningMessage(
    `Restore ${checkpoint.description} (${mode.label})? Last Order-managed worktrees may be reset.`,
    { modal: true }, 'Restore'
  );
  if (confirm !== 'Restore') return;
  await client.request('POST', `/checkpoints/${encodeURIComponent(checkpoint.description)}/restore`, {
    files: mode.value !== 'conversation', conversation: mode.value !== 'files'
  });
  vscode.window.showInformationMessage(`Checkpoint restored: ${checkpoint.description}`);
  await refreshState();
}

class WorkerTreeProvider {
  constructor() { this.status = null; }
  setStatus(status) { this.status = status; this.refresh(); }
  refresh() { this.emitter?.fire(); }
  get onDidChangeTreeData() {
    if (!this.emitter) this.emitter = new vscode.EventEmitter();
    return this.emitter.event;
  }
  getTreeItem(item) { return item; }
  async getChildren() {
    if (!this.status) return [];
    const items = [];
    const manager = new vscode.TreeItem('Manager', vscode.TreeItemCollapsibleState.None);
    manager.description = 'Manager';
    manager.tooltip = 'Open Manager panel';
    manager.iconPath = new vscode.ThemeIcon('account');
    manager.contextValue = 'missionControl.manager';
    manager.command = { command: 'missionControl.openTui', title: 'Open Control TUI' };
    items.push(manager);
    for (const worker of Object.values(this.status.snapshot.workers || {})) {
      if (worker.archivedAt) continue;
      const item = new vscode.TreeItem(worker.title || worker.id, vscode.TreeItemCollapsibleState.None);
      item.description = worker.status;
      item.tooltip = `${worker.id}\n${worker.notes?.join('\n') || ''}`;
      item.iconPath = new vscode.ThemeIcon(worker.status === 'running' ? 'sync~spin' : worker.status === 'failed' ? 'error' : 'circle-outline');
      item.contextValue = 'missionControl.worker';
      item.command = { command: 'missionControl.openMonitor', title: 'Open Worker Monitor', arguments: [worker] };
      item.worker = worker;
      items.push(item);
    }
    return items;
  }
}

function registerCommand(name, callback) {
  return vscode.commands.registerCommand(name, async (...args) => {
    try { await callback(...args); }
    catch (error) {
      output.appendLine(`[${name}] ${error.stack || error.message}`);
      vscode.window.showErrorMessage(error.message);
    }
  });
}

async function startMissionControl() {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Starting Last Order' }, async () => {
    await ensureClient();
    await refreshState();
  });
  if (vscode.workspace.getConfiguration('missionControl').get('autoOpenManager', true)) await openManager();
}

async function stopMissionControl() {
  if (client) {
    try { await client.request('POST', '/shutdown'); }
    catch { serviceProcess?.kill(); }
  } else serviceProcess?.kill();
  client = undefined;
  serviceProcess = undefined;
  ownsService = false;
  managerTuiProvider?.stopHost();
  tuiTerminal?.dispose?.();
  tuiTerminal = undefined;
  lastStatus = undefined;
  treeProvider?.setStatus({ snapshot: { workers: {} }, config: {} });
  statusBar.text = '$(radio-tower) LO: off';
}

async function sendContext(target) {
  await ensureClient();
  const status = lastStatus || await refreshState();
  let selected = target?.id ? { label: target.title || target.id, actor: target.id, worker: target } : target;
  if (!selected) {
    const choices = [{ label: 'Manager', description: 'Send to manager', actor: 'manager' }];
    for (const worker of Object.values(status.snapshot.workers || {})) {
      if (worker.archivedAt) continue;
      choices.push({ label: worker.title || worker.id, description: `${worker.status} · ${worker.id}`, actor: worker.id, worker });
    }
    selected = await vscode.window.showQuickPick(choices, { title: 'Send editor context' });
  }
  if (!selected) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('Open an editor file first');
  const selection = editor.selection;
  const selectedText = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
  if (!selectedText) throw new Error('The editor context is empty');
  const note = await vscode.window.showInputBox({
    title: 'Instruction for selected context',
    prompt: 'Optional instruction. Press Enter to send.',
    placeHolder: '例如：请检查这段实现并给出改造方案'
  });
  if (note === undefined) return;
  const text = `[VSCode context]\nFile: ${editor.document.uri.fsPath}\nLanguage: ${editor.document.languageId}\nSelection: ${selection.isEmpty ? 'whole file' : `${selection.start.line + 1}:${selection.start.character + 1}-${selection.end.line + 1}:${selection.end.character + 1}`}\n\n${note ? note + '\n\n' : ''}\`\`\`${editor.document.languageId}\n${selectedText.slice(0, 100_000)}\n\`\`\``;
  if (selected.actor === 'manager') await client.request('POST', '/manager/message', { text });
  else await client.request('POST', `/worker/${encodeURIComponent(selected.actor)}/message`, { text });
  vscode.window.showInformationMessage(`Context sent to ${selected.label}`);
  await refreshState();
}

async function openMonitor(worker, projectInfo) {
  worker = worker || await pickWorker('Open worker monitor');
  if (!worker) return;
  const status = projectInfo?.dataDirectory
    ? { project_root: projectInfo.project, data_directory: projectInfo.dataDirectory }
    : lastStatus || await refreshState();
  const script = backendFile('bin/worker-monitor.js');
  const terminal = vscode.window.createTerminal({ name: `LO ${worker.id}`, cwd: status.project_root, location: { viewColumn: vscode.ViewColumn.Beside } });
  terminal.show();
  terminal.sendText(`"${nodeExecutable()}" "${script}" --data-directory "${status.data_directory}" --worker "${worker.id}"`);
}

async function archiveWorker(item) {
  const worker = item?.worker ?? await pickWorker('Archive worker');
  if (!worker) return;
  const confirmed = await vscode.window.showWarningMessage(
    `Archive ${worker.title || worker.id}? Archived workers are read-only and cannot be resumed.`,
    { modal: true },
    'Archive'
  );
  if (confirmed !== 'Archive') return;
  await (await ensureClient()).archiveWorker(worker.id, 'user');
  await refreshState();
}

async function activate(context) {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Last Order');
  treeProvider = new WorkerTreeProvider();
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  statusBar.command = 'missionControl.openTui';
  statusBar.text = '$(radio-tower) LO: off';
  statusBar.show();
  const contentChanged = new vscode.EventEmitter();
  const contentProvider = {
    onDidChange: contentChanged.event,
    provideTextDocumentContent: async uri => {
      if (!client) return '';
      const params = new URLSearchParams(uri.query);
      const workerId = params.get('worker'), ref = params.get('ref') || 'worktree';
      if (!workerId) return '';
      return client.git.content({ id: workerId }, uri.path.replace(/^\/+/, ''), ref);
    }
  };
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('mission-control', contentProvider));
  context.subscriptions.push(contentChanged);
  managerTuiProvider = new ManagerTuiViewProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('missionControl.manager', managerTuiProvider));
  context.subscriptions.push(output, statusBar, vscode.window.registerTreeDataProvider('missionControl.workers', treeProvider));
  context.subscriptions.push(registerCommand('missionControl.start', startMissionControl));
  context.subscriptions.push(registerCommand('missionControl.stop', stopMissionControl));
  context.subscriptions.push(registerCommand('missionControl.refresh', refreshState));
  context.subscriptions.push(registerCommand('missionControl.openTui', openTui));
  context.subscriptions.push(registerCommand('missionControl.openManager', openManager));
  context.subscriptions.push(registerCommand('missionControl.openWorker', openWorker));
  context.subscriptions.push(registerCommand('missionControl.openWorkerDiff', openWorkerDiff));
  context.subscriptions.push(registerCommand('missionControl.editWorkerNotes', editWorkerNotes));
  context.subscriptions.push(registerCommand('missionControl.takeOverWorker', takeOverWorker));
  context.subscriptions.push(registerCommand('missionControl.handBackWorker', handBackWorker));
  context.subscriptions.push(registerCommand('missionControl.createCheckpoint', createCheckpoint));
  context.subscriptions.push(registerCommand('missionControl.restoreCheckpoint', restoreCheckpoint));
  context.subscriptions.push(registerCommand('missionControl.openWorkerWorktree', async worker => {
    worker = worker || await pickWorker('Open worker worktree');
    if (worker) await openWorktree(worker);
  }));
  context.subscriptions.push(registerCommand('missionControl.openMonitor', openMonitor));
  context.subscriptions.push(registerCommand('missionControl.sendContext', sendContext));
  context.subscriptions.push(registerCommand('missionControl.switchScreen', switchLastOrderScreen));
  context.subscriptions.push(registerCommand('missionControl.archiveWorker', archiveWorker));
  refreshTimer = setInterval(() => { void refreshState(); }, 1500);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
  const reloadRequested = Boolean(extensionContext.workspaceState?.get?.('missionControl.reloadRequested', false));
  if (reloadRequested) await extensionContext.workspaceState?.update?.('missionControl.reloadRequested', false);
  if (reloadRequested || vscode.workspace.getConfiguration('missionControl').get('autoStart', false)) await startMissionControl();
  if (reloadRequested && !vscode.workspace.getConfiguration('missionControl').get('autoOpenManager', true)) await openManager();
  if (!reloadRequested && vscode.workspace.getConfiguration('missionControl').get('autoOpenTui', false)) await openTui();
}

async function deactivate() {
  clearInterval(refreshTimer);
  managerTuiProvider?.stopHost();
  const keepRunning = vscode.workspace.getConfiguration('missionControl').get('keepRunningOnDeactivate', false);
  if (!keepRunning && ownsService && client) {
    try { await client.request('POST', '/shutdown'); } catch { serviceProcess?.kill(); }
  }
}

module.exports = { activate, deactivate, filterTerminalSelection, openExternalLink };
