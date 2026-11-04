import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

function requestJson(info, method, route, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, info.url);
    const request = http.request(url, {
      method,
      headers: {
        authorization: `Bearer ${info.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      }
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let value = {};
        try { value = data ? JSON.parse(data) : {}; }
        catch { return reject(new Error(`Invalid Mission Control response (${response.statusCode})`)); }
        if (response.statusCode >= 400) return reject(new Error(value.error || `Mission Control HTTP ${response.statusCode}`));
        resolve(value);
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function readControlInfo(dataDirectory) {
  for (const directory of [dataDirectory, path.join(path.dirname(dataDirectory), 'lastorder')]) {
    try { return JSON.parse(await readFile(path.join(directory, 'control.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

async function healthy(info) {
  if (!info) return false;
  try { await requestJson(info, 'GET', '/health'); return true; }
  catch { return false; }
}

export async function attachOrStartMissionControl(projectRoot, dataDirectory, { timeout = 30_000 } = {}) {
  const existing = await readControlInfo(dataDirectory);
  if (await healthy(existing)) return existing;
  await mkdir(dataDirectory, { recursive: true });
  const script = fileURLToPath(new URL('../../bin/mission-control.js', import.meta.url));
  const logPath = path.join(dataDirectory, 'mission-control.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [script, '--project', projectRoot], {
    cwd: path.dirname(script),
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
  closeSync(log);
  child.unref();
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, 200));
    const info = await readControlInfo(dataDirectory);
    if (await healthy(info)) return info;
  }
  let detail = '';
  try { detail = (await readFile(logPath, 'utf8')).slice(-4000); } catch {}
  throw new Error('Mission Control did not start. ' + detail.trim());
}

export class ServiceClient extends EventEmitter {
  constructor(info) {
    super();
    this.info = info;
    this.state = { workers: {}, pipelines: {}, requests: {}, notifications: [], manager: { pending: [] }, approvals: [], questions: [] };
    this.config = {};
    this.approvals = new Map();
    this.questions = new Map();
    this.histories = new Map();
    this.closed = false;
    this.timer = null;
    this.git = {
      root: info.project_root,
      directory: info.data_directory,
      files: async (worker, filePath = '') => {
        const result = await this.request('GET', `/worker/${encodeURIComponent(worker.id)}/files?path=${encodeURIComponent(filePath)}`);
        return result.files;
      },
      diff: async (worker, mode = 'task') => {
        const result = await this.request('GET', `/worker/${encodeURIComponent(worker.id)}/diff?mode=${encodeURIComponent(mode)}`);
        return result.diff;
      },
      changedFiles: async worker => {
        const result = await this.request('GET', `/worker/${encodeURIComponent(worker.id)}/changed-files`);
        return result.files;
      },
      content: async (worker, filePath, ref = 'worktree') => {
        const result = await this.request('GET', `/worker/${encodeURIComponent(worker.id)}/content?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(ref)}`);
        return result.content;
      }
    };
    this.store = { history: (actor, limit = 400) => (this.histories.get(actor) ?? []).slice(-limit) };
  }

  request(method, route, body) { return requestJson(this.info, method, route, body); }

  async start() {
    await this.refresh(true);
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, 500);
    return this;
  }

  async refresh(force = false) {
    if (this.closed) return;
    try {
      const status = await this.request('GET', '/status');
      const snapshot = status.snapshot;
      const workers = Object.keys(snapshot.workers ?? {});
      const actors = ['manager', ...workers];
      const entries = await Promise.all(actors.map(async actor => {
        const history = await this.request('GET', `/history?actor=${encodeURIComponent(actor)}&limit=400`);
        return [actor, history.events];
      }));
      let changed = force || JSON.stringify(snapshot) !== JSON.stringify(this.state);
      for (const [actor, events] of entries) {
        const old = this.histories.get(actor) ?? [];
        if (old.length !== events.length || old.at(-1)?.seq !== events.at(-1)?.seq) changed = true;
        this.histories.set(actor, events);
      }
      this.state = snapshot;
      this.config = status.config;
      this.approvals = new Map((snapshot.approvals ?? []).map(item => [item.id, item]));
      this.questions = new Map((snapshot.questions ?? []).map(item => [item.id, item]));
      if (changed) { this.emit('change', { type: 'client_refresh' }); this.emit('activity', { actor: 'service' }); }
    } catch (error) {
      if (!this.closed) {
        this.closed = true;
        clearInterval(this.timer);
        this.emit('disconnect', error);
      }
      throw error;
    }
  }

  snapshot() { return this.state; }
  async sendManagerMessage(text, interrupt = false) { await this.request('POST', '/manager/message', { text, interrupt }); await this.refresh(); }
  async interruptManager() { const result = await this.request('POST', '/manager/interrupt', {}); await this.refresh(); return result; }
  async clearManagerMemory() { const result = await this.request('POST', '/manager/memory/clear', {}); await this.refresh(); return result; }
  async sendWorkerMessage(workerId, message) { await this.request('POST', `/worker/${encodeURIComponent(workerId)}/message`, { text: message }); await this.refresh(); }
  async controlWorker(workerId, action, reason = '') { await this.request('POST', `/worker/${encodeURIComponent(workerId)}/control`, { action, reason }); await this.refresh(); }
  async archiveWorker(workerId, reason = 'user') { const result = await this.request('POST', `/worker/${encodeURIComponent(workerId)}/archive`, { reason }); await this.refresh(); return result; }
  async conversationTurns(actor = 'manager', limit = 50) {
    const result = await this.request('GET', `/conversation/turns?actor=${encodeURIComponent(actor)}&limit=${limit}`);
    return result.turns;
  }
  async listSkills(actor = 'manager', forceReload = true) {
    return this.request('GET', `/skills?actor=${encodeURIComponent(actor)}&forceReload=${forceReload ? 'true' : 'false'}`);
  }
  async forkConversation(actor = 'manager', options = {}) {
    const result = await this.request('POST', '/conversation/fork', { actor, ...options });
    await this.refresh();
    return result.thread;
  }
  async revertConversation(actor = 'manager', beforeTurnId) {
    const result = await this.request('POST', '/conversation/revert', { actor, beforeTurnId });
    await this.refresh();
    return result;
  }
  async listCheckpoints() {
    return (await this.request('GET', '/checkpoints')).checkpoints;
  }
  async createCheckpoint(label = '') {
    const result = await this.request('POST', '/checkpoints', { label });
    await this.refresh();
    return result.checkpoint;
  }
  async restoreCheckpoint(checkpointId, options = {}) {
    const result = await this.request('POST', `/checkpoints/${encodeURIComponent(checkpointId)}/restore`, options);
    await this.refresh();
    return result;
  }
  respondApproval(id, allowed) { void this.request('POST', `/approval/${encodeURIComponent(id)}`, { allowed }).then(() => this.refresh()); }
  answerQuestion(id, answer) { void this.request('POST', `/question/${encodeURIComponent(id)}`, { answer }).then(() => this.refresh()); }
  async shutdown() {
    try { await this.request('POST', '/shutdown', {}); }
    finally { this.closed = true; clearInterval(this.timer); }
  }
  stop() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
  }
}
