import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import nodePath from 'node:path';
import { CONTROL_PROTOCOL_VERSION } from './identity.js';
import { APP_VERSION } from './version.js';
import { normalizeConfig, saveConfig } from './config.js';

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON request')); }
    });
    req.on('error', reject);
  });
}

export async function startControlServer(service, { token, onShutdown = () => {} } = {}) {
  if (!token) throw new Error('Control token is required');
  const eventClients = new Set();
  const broadcast = event => {
    const payload = JSON.stringify({ type: event?.type ?? 'change', actor: event?.actor, seq: event?.seq, method: event?.method });
    for (const client of eventClients) {
      try { client.write(`data: ${payload}\n\n`); }
      catch { eventClients.delete(client); }
    }
  };
  service.on?.('change', broadcast);
  service.on?.('activity', broadcast);
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'Unauthorized' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      let match;
      if (req.method === 'GET' && path === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        res.write(': connected\n\n');
        eventClients.add(res);
        const remove = () => eventClients.delete(res);
        req.on('close', remove);
        res.on('close', remove);
        return;
      }
      if (req.method === 'GET' && path === '/health') {
        return json(res, 200, { ok: true, protocol: CONTROL_PROTOCOL_VERSION, version: APP_VERSION });
      }
      if (req.method === 'GET' && path === '/status') {
        return json(res, 200, {
          snapshot: service.snapshot(), config: service.config,
          data_directory: service.git.directory, project_root: service.git.root
        });
      }
      if (req.method === 'GET' && path === '/history') {
        const actor = url.searchParams.get('actor') || 'manager';
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
        return json(res, 200, { actor, events: service.history ? service.history(actor, limit) : service.store.history(actor, limit) });
      }
      if (req.method === 'GET' && path === '/conversation/turns') {
        const actor = url.searchParams.get('actor') || 'manager';
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
        const turns = await service.listConversationTurns(actor, { limit, sortDirection: 'desc', itemsView: 'summary' });
        return json(res, 200, { actor, turns });
      }
      if (req.method === 'GET' && path === '/conversation/event') {
        const actor = url.searchParams.get('actor') || 'manager';
        const seq = Number(url.searchParams.get('seq'));
        return json(res, 200, { actor, event: service.conversationEvent(actor, seq) });
      }
      if (req.method === 'GET' && path === '/skills') {
        const actor = url.searchParams.get('actor') || 'manager';
        const skills = await service.listSkills(actor, { forceReload: url.searchParams.get('forceReload') !== 'false' });
        return json(res, 200, { actor, skills });
      }
      if (req.method === 'POST' && path === '/conversation/fork') {
        const body = await readJson(req);
        const thread = await service.forkConversation(body.actor || 'manager', {
          lastTurnId: body.lastTurnId, beforeTurnId: body.beforeTurnId, ephemeral: Boolean(body.ephemeral)
        });
        return json(res, 200, { thread });
      }
      if (req.method === 'POST' && path === '/conversation/revert') {
        const body = await readJson(req);
        if (!body.beforeTurnId) return json(res, 400, { error: 'beforeTurnId is required' });
        const result = await service.revertConversation(body.actor || 'manager', { beforeTurnId: body.beforeTurnId });
        return json(res, 200, result);
      }
      if (req.method === 'GET' && path === '/checkpoints') {
        return json(res, 200, { checkpoints: service.listCheckpoints() });
      }
      if (req.method === 'POST' && path === '/checkpoints') {
        const body = await readJson(req);
        return json(res, 200, { checkpoint: await service.createCheckpoint(body.label) });
      }
      match = /^\/checkpoints\/([^/]+)\/restore$/.exec(path);
      if (req.method === 'POST' && match) {
        const body = await readJson(req);
        const result = await service.restoreCheckpoint(decodeURIComponent(match[1]), {
          files: body.files !== false, conversation: Boolean(body.conversation)
        });
        return json(res, 200, result);
      }
      match = /^\/worker\/([^/]+)\/(files|diff)$/.exec(path);
      if (req.method === 'GET' && match) {
        const workerId = decodeURIComponent(match[1]), worker = service.snapshot().workers?.[workerId];
        if (!worker) return json(res, 404, { error: 'Unknown worker' });
        if (match[2] === 'files') {
          const files = await service.git.files(worker, url.searchParams.get('path') || '');
          return json(res, 200, { files });
        }
        const mode = url.searchParams.get('mode') || 'task';
        const diff = await service.git.diff(worker, mode);
        return json(res, 200, { diff });
      }
      match = /^\/worker\/([^/]+)\/(changed-files|content)$/.exec(path);
      if (req.method === 'GET' && match) {
        const workerId = decodeURIComponent(match[1]), worker = service.snapshot().workers?.[workerId];
        if (!worker) return json(res, 404, { error: 'Unknown worker' });
        if (match[2] === 'changed-files') return json(res, 200, { files: await service.git.changedFiles(worker) });
        const content = await service.git.fileContent(worker, url.searchParams.get('path') || '', url.searchParams.get('ref') || 'worktree');
        return json(res, 200, { content });
      }
      if (req.method === 'POST' && path === '/manager/message') {
        const body = await readJson(req);
        await service.sendManagerMessage(body.text, Boolean(body.interrupt), body.quotes, body.attachments);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/manager/interrupt') {
        return json(res, 200, await service.interruptManager());
      }
      if (req.method === 'POST' && path === '/manager/memory/clear') {
        return json(res, 200, await service.clearManagerMemory());
      }
      if (req.method === 'POST' && path === '/config') {
        const body = await readJson(req);
        const config = normalizeConfig(service.config, body.config ?? {});
        await saveConfig(nodePath.join(service.git.directory, 'config.json'), config);
        return json(res, 200, { config, restart_required: true });
      }
      match = /^\/worker\/([^/]+)\/(message|control|notes|archive)$/.exec(path);
      if (req.method === 'POST' && match) {
        const workerId = decodeURIComponent(match[1]), body = await readJson(req);
        if (match[2] === 'message') await service.sendWorkerMessage(workerId, body.text, 'user');
        else if (match[2] === 'control') await service.controlWorker(workerId, body.action, body.reason ?? '', 'user');
        else if (match[2] === 'notes') await service.updateWorkerNotes(workerId, body.notes ?? []);
        else return json(res, 200, await service.archiveWorker(workerId, body.reason ?? 'user', 'user'));
        return json(res, 200, { ok: true });
      }
      match = /^\/approval\/([^/]+)$/.exec(path);
      if (req.method === 'POST' && match) {
        const body = await readJson(req);
        service.respondApproval(decodeURIComponent(match[1]), Boolean(body.allowed));
        return json(res, 200, { ok: true });
      }
      match = /^\/question\/([^/]+)$/.exec(path);
      if (req.method === 'POST' && match) {
        const body = await readJson(req);
        service.answerQuestion(decodeURIComponent(match[1]), String(body.answer ?? ''));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/shutdown') {
        json(res, 200, { ok: true });
        setImmediate(onShutdown);
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      service.off?.('change', broadcast);
      service.off?.('activity', broadcast);
      for (const client of eventClients) client.end();
      eventClients.clear();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

export async function publishControlServer(service, { onShutdown } = {}) {
  const token = randomBytes(32).toString('hex');
  const control = await startControlServer(service, { token, onShutdown });
  const controlPath = nodePath.join(service.git.directory, 'control.json');
  const info = {
    url: control.url, token, pid: process.pid, protocol: CONTROL_PROTOCOL_VERSION, version: APP_VERSION,
    project_root: service.git.root, data_directory: service.git.directory,
    config: service.config, started_at: new Date().toISOString()
  };
  await mkdir(service.git.directory, { recursive: true });
  await writeFile(controlPath, JSON.stringify(info, null, 2), { mode: 0o600 });
  return {
    ...info,
    control_path: controlPath,
    async close() {
      await control.close().catch(() => {});
      await unlink(controlPath).catch(() => {});
    }
  };
}
