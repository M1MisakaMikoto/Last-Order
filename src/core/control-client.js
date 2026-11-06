import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { CONTROL_PROTOCOL_VERSION } from './identity.js';
import { APP_VERSION } from './version.js';

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

async function serviceHealth(info) {
  if (!info) return null;
  try { return await requestJson(info, 'GET', '/health'); }
  catch { return null; }
}

async function stopIncompatibleService(info) {
  try { await requestJson(info, 'POST', '/shutdown'); } catch {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!await serviceHealth(info)) return;
  }
  throw new Error('An incompatible Last Order backend is still running. Stop it before starting this version.');
}

export async function attachOrStartMissionControl(projectRoot, dataDirectory, { timeout = 30_000 } = {}) {
  const existing = await readControlInfo(dataDirectory);
  const existingHealth = await serviceHealth(existing);
  if (existingHealth?.protocol === CONTROL_PROTOCOL_VERSION) return existing;
  if (existingHealth) await stopIncompatibleService(existing);
  await mkdir(dataDirectory, { recursive: true });
  const script = fileURLToPath(new URL('../../bin/mission-control.js', import.meta.url));
  const logPath = path.join(dataDirectory, 'mission-control.log');
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [script, '--project', projectRoot], {
    cwd: path.dirname(script),
    env: { ...process.env, LAST_ORDER_DISTRIBUTION_VERSION: APP_VERSION },
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
    if (await serviceHealth(info)) return info;
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
    this.refreshFailures = 0;
    this.lastRefreshError = null;
    this.refreshing = false;
    this.refreshQueued = false;
    this.timer = null;
    this.eventAbort = null;
    this.eventRefreshTimer = null;
    this.eventRead = null;
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
    this.startEvents();
    return this;
  }

  async refresh(force = false) {
    if (this.closed) return;
    if (this.refreshing) { this.refreshQueued = true; return; }
    this.refreshing = true;
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
        if (JSON.stringify(old) !== JSON.stringify(events)) changed = true;
        this.histories.set(actor, events);
      }
      this.state = snapshot;
      this.config = status.config;
      this.approvals = new Map((snapshot.approvals ?? []).map(item => [item.id, item]));
      this.questions = new Map((snapshot.questions ?? []).map(item => [item.id, item]));
      this.refreshFailures = 0; this.lastRefreshError = null;
      if (changed) { this.emit('change', { type: 'client_refresh' }); this.emit('activity', { actor: 'service' }); }
    } catch (error) {
      this.refreshFailures++;
      this.lastRefreshError = error.message;
      const permanent = /\b401\b|unauthorized|forbidden/i.test(error.message);
      if (!this.closed && (permanent || this.refreshFailures >= 5)) {
        this.closed = true;
        clearInterval(this.timer);
        this.emit('disconnect', error);
      }
      throw error;
    } finally {
      this.refreshing = false;
      if (this.refreshQueued && !this.closed) {
        this.refreshQueued = false;
        queueMicrotask(() => { void this.refresh().catch(() => {}); });
      }
    }
  }

  startEvents() {
    this.eventAbort?.abort();
    this.eventAbort = new AbortController();
    this.eventRead = this.readEvents(this.eventAbort.signal).catch(() => {});
  }

  scheduleEventRefresh() {
    this.refreshQueued = true;
    if (this.eventRefreshTimer) return;
    this.eventRefreshTimer = setTimeout(() => {
      this.eventRefreshTimer = null;
      void this.refresh().catch(() => {});
    }, 16);
  }

  async readEvents(signal) {
    const response = await fetch(new URL('/events', this.info.url), {
      headers: { authorization: `Bearer ${this.info.token}` }, signal
    });
    if (!response.ok) throw new Error(`Mission Control event stream failed (${response.status})`);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) { try { JSON.parse(data); } catch {} this.scheduleEventRefresh(); }
      }
    }
  }

  snapshot() { return this.state; }
  async sendManagerMessage(text, interrupt = false, quotes = [], attachments = []) { await this.request('POST', '/manager/message', { text, interrupt, quotes, attachments }); await this.refresh(); }
  async interruptManager() { const result = await this.request('POST', '/manager/interrupt', {}); await this.refresh(); return result; }
  async clearManagerMemory() { const result = await this.request('POST', '/manager/memory/clear', {}); await this.refresh(); return result; }
  async sendWorkerMessage(workerId, message) { await this.request('POST', `/worker/${encodeURIComponent(workerId)}/message`, { text: message }); await this.refresh(); }
  async controlWorker(workerId, action, reason = '') { await this.request('POST', `/worker/${encodeURIComponent(workerId)}/control`, { action, reason }); await this.refresh(); }
  async archiveWorker(workerId, reason = 'user') { const result = await this.request('POST', `/worker/${encodeURIComponent(workerId)}/archive`, { reason }); await this.refresh(); return result; }
  async conversationTurns(actor = 'manager', limit = 50) {
    const result = await this.request('GET', `/conversation/turns?actor=${encodeURIComponent(actor)}&limit=${limit}`);
    return result.turns;
  }
  async conversationEvent(actor, seq) {
    const result = await this.request('GET', `/conversation/event?actor=${encodeURIComponent(actor)}&seq=${encodeURIComponent(seq)}`);
    return result.event;
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
    finally {
      this.closed = true; clearInterval(this.timer);
      clearTimeout(this.eventRefreshTimer); this.eventAbort?.abort();
    }
  }
  stop() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.eventRefreshTimer);
    this.eventAbort?.abort();
    this.timer = null;
  }
}
