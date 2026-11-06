const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { promisify } = require('util');
const { buildUiRuntime } = require('./ui-runtime.cjs');

const execFile = promisify(cp.execFile);
let extensionContext;
let output;
let client;
let serviceProcess;
let ownsService = false;
let refreshTimer;
let refreshQueued = false;
let controlSubscription;
let controlSubscriptionClient;
let controlSubscriptionTimer;
let treeProvider;
let statusBar;
let refreshing = false;
let lastStatus;
let activeProjectRoot;
let projectCatalog = [];
let managerWebviewProvider;
const workerMonitors = new Map();
let gitDiffViewer;
const seenApprovals = new Set();
const seenQuestions = new Set();
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp'
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSION = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp'
};
const CONTROL_PROTOCOL_VERSION = 2;

function hasImageSignature(buffer, mime) {
  if (mime === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

async function writePastedImage(image, directory = path.join(os.tmpdir(), 'last-order-pasted-images')) {
  const mime = String(image?.mime ?? '').toLowerCase();
  const defaultExtension = IMAGE_EXTENSION[mime];
  if (!defaultExtension) throw new Error('Only PNG, JPEG, GIF and WebP images can be pasted');
  const encoded = String(image?.data ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!encoded) throw new Error('The pasted image is empty');
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) throw new Error('Image attachment exceeds 20 MB');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) throw new Error('The pasted image is empty');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image attachment exceeds 20 MB');
  if (!hasImageSignature(buffer, mime)) throw new Error('The pasted data is not a valid image');

  const rawName = path.basename(String(image?.name || `pasted-image${defaultExtension}`));
  const suppliedExtension = path.extname(rawName).toLowerCase();
  const extension = IMAGE_MIME[suppliedExtension] === mime ? suppliedExtension : defaultExtension;
  const stem = (path.basename(rawName, path.extname(rawName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'pasted-image').slice(0, 100);
  const name = `${stem}${extension}`;
  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const filePath = path.join(directory, `${digest}-${name}`);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(filePath, buffer);
  return {
    name, path: filePath, mime, size: buffer.length,
    preview: `data:${mime};base64,${buffer.toString('base64')}`
  };
}

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

  subscribe(onEvent) {
    const url = new URL('/events', this.info.url);
    const request = http.request(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.info.token}` }
    }, response => {
      if (response.statusCode >= 400) { response.resume(); return; }
      response.setEncoding('utf8');
      let buffer = '';
      response.on('data', chunk => {
        buffer += chunk.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          try { onEvent(JSON.parse(data)); } catch {}
        }
      });
    });
    request.on('error', () => {});
    request.end();
    return () => request.destroy();
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

async function discoverProjectRoots(workspace = workspaceRoot()) {
  if (!workspace) return [];
  if (fs.existsSync(path.join(workspace, '.git'))) return [path.resolve(workspace)];
  const roots = [];
  try {
    const entries = (await fsp.readdir(workspace, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(workspace, entry.name);
      if (fs.existsSync(path.join(candidate, '.git'))) roots.push(path.resolve(candidate));
    }
  } catch {}
  if (roots.length) return [...new Set(roots)];
  try {
    const top = (await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: workspace })).stdout.trim();
    if (top) roots.push(path.resolve(top));
  } catch {}
  if (!roots.length) {
    const root = await resolveRepositoryRoot(workspace);
    if (root) roots.push(path.resolve(root));
  }
  return [...new Set(roots)];
}

function projectCodes(count) {
  return Array.from({ length: count }, (_, index) => {
    let value = index + 1, code = '';
    while (value > 0) {
      value--;
      code = String.fromCharCode(65 + value % 26) + code;
      value = Math.floor(value / 26);
    }
    return code;
  });
}

async function initializeProjectCatalog() {
  const roots = await discoverProjectRoots();
  const existing = new Map(projectCatalog.map(project => [project.root, project]));
  const codes = projectCodes(roots.length);
  projectCatalog = roots.map((root, index) => existing.get(root) ?? ({
    root, name: path.basename(root), code: codes[index],
    client: null, process: null, owns: false, status: null, error: null
  }));
  projectCatalog.forEach((project, index) => { project.code = codes[index]; });
  if (!projectCatalog.some(project => project.root === activeProjectRoot)) {
    activeProjectRoot = projectCatalog[0]?.root;
  }
  return projectCatalog;
}

function projectSnapshot() {
  return projectCatalog.map(project => ({
    code: project.code,
    name: project.name,
    root: project.root,
    active: project.root === activeProjectRoot,
    connected: Boolean(project.client),
    error: project.error ?? null
  }));
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

async function waitForBackendStop(client, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { await client.health(); }
    catch { return; }
  }
  throw new Error('The previous Last Order backend did not stop. Run /shutdown or end the old TUI before reloading.');
}

function serviceScript() {
  const configured = vscode.workspace.getConfiguration('missionControl').get('serviceScript', '').trim();
  if (configured) return configured;
  return backendFile('bin/mission-control.js');
}

function backendFile(relative) {
  const development = path.resolve(extensionContext.extensionPath, '..', relative);
  if (fs.existsSync(path.resolve(extensionContext.extensionPath, '..', 'src/ui.js')) && fs.existsSync(development)) return development;
  const bundled = path.resolve(extensionContext.extensionPath, 'backend', relative);
  if (fs.existsSync(bundled)) return bundled;
  return development;
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

function stopControlSubscription() {
  controlSubscription?.();
  controlSubscription = undefined;
  controlSubscriptionClient = undefined;
  clearTimeout(controlSubscriptionTimer);
  controlSubscriptionTimer = undefined;
}

function ensureControlSubscription() {
  if (!client || (controlSubscription && controlSubscriptionClient === client)) return;
  stopControlSubscription();
  const subscribedClient = client;
  controlSubscriptionClient = subscribedClient;
  controlSubscription = client.subscribe(() => {
    if (client !== subscribedClient) return;
    clearTimeout(controlSubscriptionTimer);
    controlSubscriptionTimer = setTimeout(() => { void refreshState(); }, 20);
  });
}

async function ensureClient() {
  const expectedVersion = extensionContext.extension?.packageJSON?.version ?? 'unknown';
  if (client) {
    try {
      const health = await client.health();
      if (health.protocol === CONTROL_PROTOCOL_VERSION && health.version === expectedVersion) {
        ensureControlSubscription();
        return client;
      }
    } catch {}
    stopControlSubscription();
    client = undefined;
  }
  const workspace = workspaceRoot();
  if (!workspace) throw new Error('Open a project folder before starting Last Order');
  if (!projectCatalog.length) await initializeProjectCatalog();
  const project = projectCatalog.find(item => item.root === activeProjectRoot) ?? projectCatalog[0];
  if (project) activeProjectRoot = project.root;
  const root = project?.root ?? await resolveRepositoryRoot(workspace);
  if (!root) throw new Error('No Git repository found in the opened workspace');
  const existing = await readControlInfo(root);
  if (existing) {
    const candidate = new ControlClient(existing);
    let health;
    try {
      health = await candidate.health();
    } catch {
      output.appendLine('Ignoring stale Last Order backend control.json');
    }
    if (health) {
      if (health.protocol === CONTROL_PROTOCOL_VERSION && health.version === expectedVersion) {
        client = candidate;
        ownsService = false;
        serviceProcess = undefined;
        if (project) {
          project.client = client; project.process = null; project.owns = false; project.error = null;
        }
        output.appendLine(`Attached to Last Order backend ${existing.url}`);
        ensureControlSubscription();
        return client;
      }
      output.appendLine(`Stopping incompatible Last Order backend (protocol ${health.protocol ?? 'legacy'} -> ${CONTROL_PROTOCOL_VERSION}, version ${health.version ?? 'legacy'} -> ${expectedVersion})`);
      try { await candidate.request('POST', '/shutdown'); } catch {}
      try { await waitForBackendStop(candidate); }
      catch (error) { throw new Error(`Cannot replace the old Last Order backend. ${error.message}`); }
    }
  }
  const script = serviceScript();
  if (!fs.existsSync(script)) throw new Error(`Last Order backend script not found: ${script}. Set missionControl.serviceScript.`);
  const node = nodeExecutable();
  output.appendLine(`Starting Last Order backend: ${node} ${script} --project ${root}`);
  serviceProcess = cp.spawn(node, [script, '--project', root], {
    cwd: path.dirname(script),
    env: { ...process.env, LAST_ORDER_DISTRIBUTION_VERSION: expectedVersion },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  ownsService = true;
  const info = await waitForReady(serviceProcess);
  client = new ControlClient(info);
  ensureControlSubscription();
  if (project) {
    project.client = client; project.process = serviceProcess; project.owns = true; project.error = null;
  }
  return client;
}

async function refreshState() {
  if (!client) return lastStatus;
  if (refreshing) { refreshQueued = true; return lastStatus; }
  refreshing = true;
  try {
    const status = await client.request('GET', '/status');
    lastStatus = status;
    const project = projectCatalog.find(item => item.root === activeProjectRoot);
    if (project) { project.status = status; project.client = client; project.error = null; }
    treeProvider?.setStatus(status);
    const visibleWorkers = Object.values(status.snapshot.workers || {}).filter(worker => !worker.archivedAt);
    statusBar.text = `$(radio-tower) LO: ${visibleWorkers.length}`;
    statusBar.tooltip = `Open Last Order Manager${project ? ` · ${project.name}` : ''}`;
    void managerWebviewProvider?.pushState(status);
    for (const { provider } of workerMonitors.values()) void provider.pushState(status);
    if (!managerWebviewProvider?.view) void handlePendingRequests(status);
    return status;
  } catch (error) {
    output.appendLine(`Last Order backend refresh failed: ${error.message}`);
    return lastStatus;
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      setImmediate(() => { void refreshState(); });
    }
  }
}

async function switchProject(root) {
  for (const { panel } of workerMonitors.values()) panel.dispose();
  if (!projectCatalog.length) await initializeProjectCatalog();
  const project = projectCatalog.find(item => item.root === root || item.code === root);
  if (!project) throw new Error(`Unknown project: ${root}`);
  stopControlSubscription();
  activeProjectRoot = project.root;
  client = project.client ?? undefined;
  serviceProcess = project.process ?? undefined;
  ownsService = Boolean(project.owns);
  lastStatus = project.status ?? undefined;
  refreshing = false;
  try {
    await ensureClient();
    const status = await refreshState();
    await managerWebviewProvider?.pushState(status ?? lastStatus);
    return { root: project.root, name: project.name, code: project.code };
  } catch (error) {
    project.error = error.message;
    throw error;
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

function nativeManagerHtml(webview) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const resource = relative => webview.asWebviewUri(
    vscode.Uri.file(path.join(extensionContext.extensionPath, 'webview', relative))
  ).toString();
  const csp = [
    "default-src 'none'",
    `img-src data: ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`
  ].join('; ');
  return fs.readFileSync(path.join(extensionContext.extensionPath, 'webview', 'manager.html'), 'utf8')
    .replaceAll('__CSP__', csp)
    .replaceAll('__STYLE__', resource('style.css'))
    .replaceAll('__SCRIPT__', resource('app.js'))
    .replaceAll('__NONCE__', nonce)
    .replace('__UI_RUNTIME__', () => buildUiRuntime(relative => fs.readFileSync(backendFile(relative), 'utf8'),
      JSON.parse(fs.readFileSync(path.join(extensionContext.extensionPath, 'package.json'), 'utf8')).version).replace(/<\/script/gi, '<\\/script'));
}

class ManagerWebviewProvider {
  constructor() {
    this.view = null;
    this.attachments = [];
    this.currentTab = 'manager';
    this.pushing = null;
    this.pendingStatus = null;
    this.initializing = null;
    this.initialized = false;
    this.pendingWorkerId = null;
    this.lastStateSignature = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    this.lastStateSignature = null;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(extensionContext.extensionPath, 'webview'))]
    };
    view.webview.html = nativeManagerHtml(view.webview);
    view.webview.onDidReceiveMessage(message => void this.message(message));
    view.onDidDispose(() => this.dispose());
    void this.initialize();
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  publicAttachments(includePreview = false) {
    return this.attachments.map(attachment => {
      if (includePreview) return attachment;
      const { preview, ...metadata } = attachment;
      return metadata;
    });
  }

  async initialize() {
    if (this.initialized) {
      await this.pushState(lastStatus);
      return;
    }
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        await ensureClient();
        await refreshState();
        await this.pushState(lastStatus);
        this.initialized = true;
      } catch (error) {
        output.appendLine(`Last Order native Webview failed: ${error.stack || error.message}`);
        this.post({ type: 'fatal', message: error.message });
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  async pushState(status = lastStatus) {
    if (!this.view || !client) return;
    if (status) this.pendingStatus = status;
    if (this.pushing) return this.pushing;
    this.pushing = (async () => {
      while (this.pendingStatus) {
        const current = this.pendingStatus;
        this.pendingStatus = null;
        const history = await client.request('GET', '/history?actor=manager&limit=400');
        const signature = JSON.stringify({
          snapshot: current.snapshot,
          config: current.config,
          project_root: current.project_root,
          projects: projectSnapshot(),
          history: crypto.createHash('sha1').update(JSON.stringify(history.events)).digest('hex')
        });
        if (signature === this.lastStateSignature) continue;
        this.lastStateSignature = signature;
        this.post({
          type: 'state',
          status: current,
          history: history.events,
          projects: projectSnapshot(),
          attachments: this.publicAttachments()
        });
      }
    })().finally(() => {
      this.pushing = null;
      if (this.pendingStatus) void this.pushState(this.pendingStatus);
    });
    return this.pushing;
  }

  async afterMutation() {
    await refreshState();
    await this.pushState(lastStatus);
  }

  async pasteImages(images) {
    for (const image of (Array.isArray(images) ? images : []).slice(0, 8)) {
      if (this.attachments.length >= 8) {
        this.post({ type: 'toast', message: '最多同时添加 8 张图片', kind: 'error' });
        break;
      }
      try {
        const attachment = await writePastedImage(image);
        if (!this.attachments.some(item => item.path === attachment.path)) this.attachments.push(attachment);
      } catch (error) {
        output?.appendLine(`Last Order image paste rejected: ${error.message}`);
        this.post({ type: 'toast', message: error.message, kind: 'error' });
      }
    }
    this.post({ type: 'attachments', attachments: this.publicAttachments(true) });
  }

  async api(message) {
    try {
      let value;
      const workerId = message.workerId;
      const worker = workerId ? workerById(workerId) : undefined;
      switch (message.action) {
        case 'refresh':
          if (!this.initialized) {
            await this.initialize();
            if (!this.initialized) throw new Error('Last Order could not connect. Check the Last Order output for details.');
          } else await this.afterMutation();
          value = { ok: true };
          break;
        case 'sendManager':
          await client.request('POST', '/manager/message', {
            text: message.text,
            interrupt: Boolean(message.interrupt),
            quotes: message.quotes ?? [],
            attachments: this.attachments.map(({ preview, ...attachment }) => attachment)
          });
          this.attachments = [];
          await this.afterMutation();
          this.post({ type: 'attachments', attachments: [] });
          value = { ok: true };
          break;
        case 'interruptManager':
          value = await client.request('POST', '/manager/interrupt', {});
          await this.afterMutation();
          break;
        case 'sendWorker':
          await client.request('POST', `/worker/${encodeURIComponent(message.workerId)}/message`, { text: message.text });
          await this.afterMutation();
          value = { ok: true };
          break;
        case 'controlWorker':
          await client.request('POST', `/worker/${encodeURIComponent(message.workerId)}/control`, {
            action: message.workerAction, reason: message.reason || ''
          });
          await this.afterMutation();
          value = { ok: true };
          break;
        case 'approval':
          await client.request('POST', `/approval/${encodeURIComponent(message.approvalId)}`, { allowed: Boolean(message.allowed) });
          await this.afterMutation();
          value = { ok: true };
          break;
        case 'question':
          await client.request('POST', `/question/${encodeURIComponent(message.questionId)}`, { answer: message.answer });
          await this.afterMutation();
          value = { ok: true };
          break;
        case 'clearMemory':
          value = await client.request('POST', '/manager/memory/clear', {});
          await this.afterMutation();
          break;
        case 'version':
          value = {
            version: client.info.version,
            protocol: client.info.protocol,
            pid: client.info.pid,
            started_at: client.info.started_at,
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            project_root: client.info.project_root,
            codex_command: process.env.LO_CODEX_COMMAND || ''
          };
          break;
        case 'saveConfig':
          value = await client.request('POST', '/config', { config: message.config || {} });
          break;
        case 'restoreCheckpoint':
          await restoreCheckpoint();
          value = { ok: true };
          break;
        case 'reloadWindow':
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
          value = { ok: true };
          break;
        case 'workerNotes':
          if (!worker) throw new Error('Unknown worker');
          await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/notes`, { notes: message.notes || [] });
          await this.afterMutation();
          value = { ok: true };
          break;
        case 'takeOver':
          if (!worker) throw new Error('Unknown worker');
          await takeOverWorker(worker);
          value = { ok: true };
          break;
        case 'handBack':
          if (!worker) throw new Error('Unknown worker');
          await handBackWorker(worker);
          value = { ok: true };
          break;
        case 'history':
          value = await client.request('GET', `/history?actor=${encodeURIComponent(message.actor || 'manager')}&limit=${Math.max(1, Math.min(500, Number(message.limit) || 400))}`);
          break;
        case 'files':
          if (!worker) throw new Error('Unknown worker');
          try {
            value = { path: message.path || '', files: await client.git.files(worker, message.path || '') };
          } catch (error) {
            if (!message.path) throw error;
            value = { path: message.path, files: await client.git.content(worker, message.path, 'worktree') };
          }
          break;
        case 'diff':
          if (!worker) throw new Error('Unknown worker');
          value = { diff: await client.git.diff(worker, message.mode || 'task') };
          break;
        case 'changedFiles':
          if (!worker) throw new Error('Unknown worker');
          value = { files: await client.git.changedFiles(worker) };
          break;
        case 'content':
          if (!worker) throw new Error('Unknown worker');
          value = { content: await client.git.content(worker, message.path || '', message.ref || 'worktree') };
          break;
        case 'turns':
          value = await client.request('GET', `/conversation/turns?actor=${encodeURIComponent(message.actor || 'manager')}&limit=${Math.max(1, Math.min(100, Number(message.limit) || 50))}`);
          break;
        case 'forkConversation':
          value = await client.request('POST', '/conversation/fork', {
            actor: message.actor || 'manager',
            lastTurnId: message.lastTurnId
          });
          await this.afterMutation();
          break;
        case 'revertConversation':
          value = await client.request('POST', '/conversation/revert', {
            actor: message.actor || 'manager',
            beforeTurnId: message.beforeTurnId
          });
          await this.afterMutation();
          break;
        case 'checkpoints':
          value = await client.request('GET', '/checkpoints');
          break;
        case 'restoreCheckpointById':
          value = await client.request('POST', `/checkpoints/${encodeURIComponent(message.checkpointId)}/restore`, {
            files: message.mode !== 'conversation',
            conversation: message.mode !== 'files'
          });
          await this.afterMutation();
          break;
        case 'skills':
          value = await client.request('GET', `/skills?actor=${encodeURIComponent(message.actor || 'manager')}&forceReload=${message.forceReload === false ? 'false' : 'true'}`);
          break;
        case 'conversationEvent':
          value = await client.request('GET', `/conversation/event?actor=${encodeURIComponent(message.actor || 'manager')}&seq=${encodeURIComponent(message.seq)}`);
          break;
        case 'openWorkerFile':
          if (!worker) throw new Error('Unknown worker');
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.from({
            scheme: 'mission-control',
            path: '/' + String(message.path || '').replace(/^\/+/, ''),
            query: new URLSearchParams({ worker: worker.id, ref: message.ref || 'worktree' }).toString()
          }));
          value = { ok: true };
          break;
        case 'openWorkerDiff':
          if (!worker) throw new Error('Unknown worker');
          await openWorkerDiff(worker);
          value = { ok: true };
          break;
        case 'editorContext': {
          const editor = vscode.window.activeTextEditor;
          if (!editor) throw new Error('Open an editor file first');
          const selection = editor.selection;
          const selectedText = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
          if (!selectedText) throw new Error('The editor context is empty');
          const range = selection.isEmpty
            ? 'whole file'
            : `${selection.start.line + 1}:${selection.start.character + 1}-${selection.end.line + 1}:${selection.end.character + 1}`;
          value = {
            text: `[VSCode context]\nFile: ${editor.document.uri.fsPath}\nLanguage: ${editor.document.languageId}\nSelection: ${range}\n\n\`\`\`${editor.document.languageId}\n${selectedText.slice(0, 100_000)}\n\`\`\`\n`
          };
          break;
        }
        case 'switchProject':
          value = await switchProject(message.root);
          break;
        case 'createCheckpoint':
          value = await client.request('POST', '/checkpoints', { label: message.label || '' });
          break;
        case 'archiveWorker':
          if (!worker) throw new Error('Unknown worker');
          value = await client.request('POST', `/worker/${encodeURIComponent(worker.id)}/archive`, { reason: 'user' });
          await this.afterMutation();
          break;
        case 'monitorWorker':
          if (!worker) throw new Error('Unknown worker');
          openWorkerMonitor(worker);
          value = { ok: true };
          break;
        case 'closeView':
          this.post({ type: 'apiResult', id: message.id, value: { ok: true } });
          if (this.isMonitor) this.view?.dispose();
          else await vscode.commands.executeCommand('workbench.action.closeSidebar');
          return;
        case 'shutdown':
          await client.request('POST', '/shutdown');
          for (const project of projectCatalog) {
            if (project.root === activeProjectRoot) { project.client = null; project.status = null; }
          }
          await stopMissionControl();
          value = { ok: true };
          break;
        default:
          throw new Error(`Unknown Webview API action: ${message.action}`);
      }
      this.post({ type: 'apiResult', id: message.id, value });
    } catch (error) {
      this.post({ type: 'apiResult', id: message.id, error: error.message });
    }
  }

  async message(message) {
    try {
      if (message.type === 'ready') {
        this.lastStateSignature = null;
        await this.initialize();
        if (this.pendingWorkerId) this.post({ type: 'openWorker', workerId: this.pendingWorkerId });
        return;
      }
      if (message.type === 'api') {
        await this.api(message);
        return;
      }
      if (message.type === 'tabChanged') {
        this.currentTab = message.tab === 'workers' ? 'workers' : 'manager';
        return;
      }
      if (message.type === 'focusChanged') {
        await vscode.commands.executeCommand('setContext', 'missionControl.managerFocus', Boolean(message.focused));
        return;
      }
      if (message.type === 'openExternal') {
        await openExternalLink(message.url);
        return;
      }
      if (message.type === 'copyText') {
        await vscode.env.clipboard.writeText(String(message.text ?? ''));
        return;
      }
      if (message.type === 'pasteImages') {
        await this.pasteImages(message.images);
        return;
      }
      if (message.type === 'removeAttachment') {
        this.attachments = this.attachments.filter(attachment => attachment.path !== message.path);
        this.post({ type: 'attachments', attachments: this.publicAttachments() });
        return;
      }
      if (message.type === 'sendManager') {
        await client.request('POST', '/manager/message', {
          text: message.text,
          quotes: message.quotes ?? [],
          attachments: this.attachments.map(({ preview, ...attachment }) => attachment)
        });
        this.attachments = [];
        await this.afterMutation();
        this.post({ type: 'attachments', attachments: [] });
        return;
      }
      if (message.type === 'interruptManager') {
        await client.request('POST', '/manager/interrupt', {});
        await this.afterMutation();
        return;
      }
      if (message.type === 'sendWorker') {
        await client.request('POST', `/worker/${encodeURIComponent(message.workerId)}/message`, { text: message.text });
        await this.afterMutation();
        return;
      }
      if (message.type === 'controlWorker') {
        await client.request('POST', `/worker/${encodeURIComponent(message.workerId)}/control`, {
          action: message.action, reason: message.reason || ''
        });
        await this.afterMutation();
        return;
      }
      if (message.type === 'approval') {
        await client.request('POST', `/approval/${encodeURIComponent(message.id)}`, { allowed: Boolean(message.allowed) });
        await this.afterMutation();
        return;
      }
      if (message.type === 'question') {
        await client.request('POST', `/question/${encodeURIComponent(message.id)}`, { answer: message.answer });
        await this.afterMutation();
        return;
      }
    } catch (error) {
      output.appendLine(`Last Order Webview action failed: ${error.stack || error.message}`);
      this.post({ type: 'toast', message: error.message, kind: 'error' });
    }
  }

  switchScreen() {
    this.currentTab = this.currentTab === 'manager' ? 'workers' : 'manager';
    this.post({ type: 'switchTab', tab: this.currentTab });
  }

  openWorker(workerId) {
    this.pendingWorkerId = workerId;
    this.post({ type: 'openWorker', workerId });
  }

  dispose() {
    this.view = null;
    this.attachments = [];
    this.pendingStatus = null;
    this.initialized = false;
    this.lastStateSignature = null;
  }
}

function openWorkerMonitor(worker) {
  const existing = workerMonitors.get(worker.id);
  if (existing) { existing.panel.reveal(vscode.ViewColumn.Beside); return; }
  const panel = vscode.window.createWebviewPanel('missionControl.workerMonitor', worker.title || worker.id, vscode.ViewColumn.Beside, { enableScripts: true });
  const provider = new ManagerWebviewProvider();
  provider.isMonitor = true;
  provider.pendingWorkerId = worker.id;
  workerMonitors.set(worker.id, { panel, provider });
  panel.onDidDispose(() => workerMonitors.delete(worker.id));
  provider.resolveWebviewView(panel);
}

async function openExternalLink(value) {
  const target = String(value ?? '').trim();
  if (!target) return;
  if (target.startsWith('lastorder-copy:')) {
    const encoded = target.slice('lastorder-copy:'.length);
    const text = Buffer.from(encoded, 'base64url').toString('utf8');
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('Copied code block to clipboard.');
    return;
  }
  if (/^(?:https?:\/\/|mailto:)/i.test(target)) {
    await vscode.env.openExternal(vscode.Uri.parse(target));
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[A-Za-z]:[\\/]/.test(target)) return;
  const root = lastStatus?.project_root ?? workspaceRoot();
  const [targetPath, anchor] = target.split('#');
  const cleaned = targetPath.replace(/^\.\//, '');
  const file = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(root, cleaned);
  if (!path.isAbsolute(cleaned)) {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return;
  }
  const lineMatch = /^L(\d+)(?:-L?(\d+))?$/.exec(anchor ?? '');
  if (!lineMatch) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const startLine = Math.max(0, Math.min(document.lineCount - 1, Number(lineMatch[1]) - 1));
  const endLine = Math.max(startLine, Math.min(document.lineCount - 1, Number(lineMatch[2] ?? lineMatch[1]) - 1));
  const endCharacter = document.lineAt(endLine).text.length;
  await vscode.window.showTextDocument(document, {
    preview: false,
    selection: new vscode.Range(startLine, 0, endLine, endCharacter)
  });
}

async function openManager() {
  await ensureClient();
  await vscode.commands.executeCommand('workbench.view.extension.missionControlManager');
  await vscode.commands.executeCommand('missionControl.manager.focus');
}

async function openWorker(worker) {
  worker = worker || await pickWorker('Open worker');
  if (!worker) return;
  await openManager();
  managerWebviewProvider?.openWorker(worker.id);
}

async function switchLastOrderScreen() {
  if (managerWebviewProvider?.view) managerWebviewProvider.switchScreen();
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
    manager.command = { command: 'missionControl.openManager', title: 'Open Manager Sidebar' };
    items.push(manager);
    for (const worker of Object.values(this.status.snapshot.workers || {})) {
      if (worker.archivedAt) continue;
      const item = new vscode.TreeItem(worker.title || worker.id, vscode.TreeItemCollapsibleState.None);
      item.description = worker.status;
      item.tooltip = `${worker.id}\n${worker.notes?.join('\n') || ''}`;
      item.iconPath = new vscode.ThemeIcon(worker.status === 'running' ? 'sync~spin' : worker.status === 'failed' ? 'error' : 'circle-outline');
      item.contextValue = 'missionControl.worker';
    item.command = { command: 'missionControl.openWorker', title: 'Open Worker', arguments: [worker] };
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
  for (const { panel } of workerMonitors.values()) panel.dispose();
  for (const project of projectCatalog) {
    if (!project.owns) continue;
    if (project.client) {
      try { await project.client.request('POST', '/shutdown'); }
      catch { project.process?.kill(); }
    } else project.process?.kill();
    project.client = null;
    project.process = null;
    project.owns = false;
    project.status = null;
  }
  client = undefined;
  stopControlSubscription();
  serviceProcess = undefined;
  ownsService = false;
  if (managerWebviewProvider) {
    managerWebviewProvider.initialized = false;
    managerWebviewProvider.lastStateSignature = null;
    managerWebviewProvider.pendingStatus = null;
    managerWebviewProvider.post({ type: 'fatal', message: 'Last Order stopped. Use /refresh to reconnect.' });
  }
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
  statusBar.command = 'missionControl.openManager';
  statusBar.text = '$(radio-tower) LO: off';
  statusBar.show();
  try { await initializeProjectCatalog(); }
  catch (error) { output.appendLine(`Project discovery failed: ${error.message}`); }
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
  managerWebviewProvider = new ManagerWebviewProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('missionControl.manager', managerWebviewProvider));
  context.subscriptions.push(output, statusBar, vscode.window.registerTreeDataProvider('missionControl.workers', treeProvider));
  context.subscriptions.push(registerCommand('missionControl.start', startMissionControl));
  context.subscriptions.push(registerCommand('missionControl.stop', stopMissionControl));
  context.subscriptions.push(registerCommand('missionControl.refresh', refreshState));
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
  context.subscriptions.push(registerCommand('missionControl.sendContext', sendContext));
  context.subscriptions.push(registerCommand('missionControl.switchScreen', switchLastOrderScreen));
  context.subscriptions.push(registerCommand('missionControl.archiveWorker', archiveWorker));
  try {
    gitDiffViewer = require('./git-diff-viewer/out/src/extension.js');
    gitDiffViewer.activate(context);
    context.subscriptions.push({ dispose: () => gitDiffViewer?.deactivate?.() });
  } catch (error) {
    output.appendLine(`Git Diff integration failed: ${error.message}`);
  }
  refreshTimer = setInterval(() => { void refreshState(); }, 1500);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
  const reloadRequested = Boolean(extensionContext.workspaceState?.get?.('missionControl.reloadRequested', false));
  if (reloadRequested) await extensionContext.workspaceState?.update?.('missionControl.reloadRequested', false);
  if (reloadRequested || vscode.workspace.getConfiguration('missionControl').get('autoStart', false)) await startMissionControl();
  if (reloadRequested && !vscode.workspace.getConfiguration('missionControl').get('autoOpenManager', true)) await openManager();
}

async function deactivate() {
  for (const { panel } of workerMonitors.values()) panel.dispose();
  stopControlSubscription();
  gitDiffViewer?.deactivate?.();
  gitDiffViewer = undefined;
  clearInterval(refreshTimer);
  managerWebviewProvider?.dispose();
  const keepRunning = vscode.workspace.getConfiguration('missionControl').get('keepRunningOnDeactivate', false);
  if (!keepRunning) {
    for (const project of projectCatalog) {
      if (!project.owns) continue;
      if (project.client) {
        try { await project.client.request('POST', '/shutdown'); } catch { project.process?.kill(); }
      } else project.process?.kill();
    }
  }
}

module.exports = { activate, deactivate, discoverProjectRoots, openExternalLink, writePastedImage };
