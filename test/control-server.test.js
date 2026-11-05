import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { publishControlServer } from '../src/core/control-server.js';
import { temporary, cleanup } from './helpers.js';

test('Mission Control control API authenticates clients and dispatches UI actions', async t => {
  const directory = await temporary('control-server-');
  t.after(() => cleanup(directory));
  let published;
  t.after(async () => { await published?.close(); });
  const calls = [];
  const versionCalls = [];
  const checkpointCalls = [];
  let interrupted = 0;
  let memoryClears = 0;
  let archived = 0;
  const service = {
    git: {
      directory, root: directory,
      files: async (worker, filePath) => [{ name: worker.id + '.js', directory: false, path: filePath }],
      diff: async (worker, mode) => `diff ${worker.id} ${mode}`,
      changedFiles: async worker => [{ path: worker.id + '.js', status: 'M' }],
      fileContent: async (worker, file, ref) => `${worker.id}:${file}:${ref}`
    },
    config: { manager: 'codex', worker: 'codex' },
    snapshot: () => ({ workers: { w1: { id: 'w1', status: 'running' } }, approvals: [{ id: 'a1' }], questions: [] }),
    store: { history: (actor, limit) => [{ seq: 1, actor, limit, type: 'message', data: { role: 'assistant', text: 'hello' } }] },
    sendManagerMessage: async (text, interrupt, quotes) => calls.push(['manager', text, interrupt, quotes]),
    interruptManager: async () => { interrupted++; return { interrupted: true, discarded: 1 }; },
    clearManagerMemory: async () => { memoryClears++; return { cleared: true, previousSessionId: 'old-thread' }; },
    sendWorkerMessage: async (workerId, text, source) => calls.push(['worker', workerId, text, source]),
    controlWorker: async (workerId, action, reason, source) => calls.push(['control', workerId, action, reason, source]),
    archiveWorker: async (workerId, reason, source) => { archived++; return { worker_id: workerId, reason, source }; },
    updateWorkerNotes: async (workerId, notes) => calls.push(['notes', workerId, notes]),
    respondApproval: (id, allowed) => calls.push(['approval', id, allowed]),
    answerQuestion: (id, answer) => calls.push(['answer', id, answer]),
    listConversationTurns: async (actor, options) => { versionCalls.push(['turns', actor, options]); return { data: [{ id: 'turn-1' }] }; },
    conversationEvent: (actor, seq) => ({ actor, seq, type: 'message', data: { role: 'assistant', text: 'quoted' } }),
    listSkills: async (actor, options) => { versionCalls.push(['skills', actor, options]); return { data: [{ cwd: directory, errors: [], skills: [{ name: 'pdf', description: 'PDF', enabled: true }] }] }; },
    forkConversation: async (actor, options) => { versionCalls.push(['fork', actor, options]); return { id: 'thread-forked' }; },
    revertConversation: async (actor, options) => { versionCalls.push(['revert', actor, options]); return { thread: { id: 'thread-1' } }; },
    listCheckpoints: () => [{ id: 'checkpoint-1', label: 'Manual' }],
    createCheckpoint: async label => { checkpointCalls.push(['create', label]); return { id: 'checkpoint-2', label }; },
    restoreCheckpoint: async (checkpointId, options) => { checkpointCalls.push(['restore', checkpointId, options]); return { checkpointId, restoredFiles: ['w1'], forkedConversations: ['manager'] }; }
  };
  let shutdowns = 0;
  published = await publishControlServer(service, { onShutdown: () => { shutdowns++; } });
  assert.ok(published.control_path.endsWith('control.json'));
  await access(published.control_path);
  const request = (method, route, body) => fetch(published.url + route, {
    method,
    headers: { authorization: `Bearer ${published.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  assert.equal((await fetch(published.url + '/health')).status, 401);
  assert.deepEqual(await (await request('GET', '/health')).json(), { ok: true });
  assert.equal((await (await request('GET', '/status')).json()).snapshot.workers.w1.status, 'running');
  assert.equal((await (await request('GET', '/history?actor=manager&limit=10')).json()).events[0].actor, 'manager');
  assert.equal((await (await request('GET', '/conversation/turns?actor=manager&limit=5')).json()).turns.data[0].id, 'turn-1');
  assert.equal((await (await request('GET', '/skills?actor=manager')).json()).skills.data[0].skills[0].name, 'pdf');
  assert.equal((await (await request('POST', '/conversation/fork', { actor: 'manager', lastTurnId: 'turn-1' })).json()).thread.id, 'thread-forked');
  assert.equal((await (await request('POST', '/conversation/revert', { actor: 'manager', beforeTurnId: 'turn-1' })).json()).thread.id, 'thread-1');
  assert.equal((await (await request('GET', '/checkpoints')).json()).checkpoints[0].id, 'checkpoint-1');
  assert.equal((await (await request('POST', '/checkpoints', { label: 'Before refactor' })).json()).checkpoint.id, 'checkpoint-2');
  assert.deepEqual(await (await request('POST', '/checkpoints/checkpoint-2/restore', { files: true, conversation: true })).json(), {
    checkpointId: 'checkpoint-2', restoredFiles: ['w1'], forkedConversations: ['manager']
  });
  assert.equal((await (await request('GET', '/worker/w1/files?path=src')).json()).files[0].path, 'src');
  assert.equal((await (await request('GET', '/worker/w1/diff?mode=task')).json()).diff, 'diff w1 task');
  assert.equal((await (await request('GET', '/worker/w1/changed-files')).json()).files[0].status, 'M');
  assert.equal((await (await request('GET', '/worker/w1/content?path=src%2Fw1.js&ref=base')).json()).content, 'w1:src/w1.js:base');
  await request('POST', '/manager/message', { text: 'hello', quotes: [{ actor: 'w1', seq: 2, text: 'quoted' }] });
  assert.deepEqual(await (await request('GET', '/conversation/event?actor=w1&seq=2')).json(), {
    actor: 'w1', event: { actor: 'w1', seq: 2, type: 'message', data: { role: 'assistant', text: 'quoted' } }
  });
  assert.deepEqual(await (await request('POST', '/manager/interrupt', {})).json(), { interrupted: true, discarded: 1 });
  assert.deepEqual(await (await request('POST', '/manager/memory/clear', {})).json(), { cleared: true, previousSessionId: 'old-thread' });
  await request('POST', '/worker/w1/message', { text: 'inspect' });
  await request('POST', '/worker/w1/control', { action: 'pause', reason: 'check' });
  await request('POST', '/worker/w1/archive', { reason: 'done' });
  await request('POST', '/worker/w1/notes', { notes: ['review later'] });
  await request('POST', '/approval/a1', { allowed: true });
  await request('POST', '/question/q1', { answer: 'yes' });
  await request('POST', '/shutdown');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, [
    ['manager', 'hello', false, [{ actor: 'w1', seq: 2, text: 'quoted' }]],
    ['worker', 'w1', 'inspect', 'user'],
    ['control', 'w1', 'pause', 'check', 'user'],
    ['notes', 'w1', ['review later']],
    ['approval', 'a1', true],
    ['answer', 'q1', 'yes']
  ]);
  assert.equal(shutdowns, 1);
  assert.equal(interrupted, 1);
  assert.equal(memoryClears, 1);
  assert.equal(archived, 1);
  assert.deepEqual(versionCalls, [
    ['turns', 'manager', { limit: 5, sortDirection: 'desc', itemsView: 'summary' }],
    ['skills', 'manager', { forceReload: true }],
    ['fork', 'manager', { lastTurnId: 'turn-1', beforeTurnId: undefined, ephemeral: false }],
    ['revert', 'manager', { beforeTurnId: 'turn-1' }]
  ]);
  assert.deepEqual(checkpointCalls, [
    ['create', 'Before refactor'],
    ['restore', 'checkpoint-2', { files: true, conversation: true }]
  ]);
  const controlPath = published.control_path;
  await published.close();
  published = undefined;
  await assert.rejects(access(controlPath));
});
