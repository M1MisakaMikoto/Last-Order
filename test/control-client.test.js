import test from 'node:test';
import assert from 'node:assert/strict';
import { publishControlServer } from '../src/core/control-server.js';
import { ServiceClient } from '../src/core/control-client.js';
import { temporary, cleanup } from './helpers.js';

test('TUI service client mirrors Mission Control state, history and Git operations', async t => {
  const directory = await temporary('control-client-');
  t.after(() => cleanup(directory));
  const calls = [];
  const versionCalls = [];
  const checkpointCalls = [];
  let interrupted = 0;
  let memoryClears = 0;
  let archived = 0;
  const state = {
    workers: { w1: { id: 'w1', status: 'running', title: 'Worker one' } },
    pipelines: {}, requests: {}, notifications: [], manager: { pending: [] }, approvals: [], questions: []
  };
  const service = {
    git: {
      directory, root: directory,
      files: async (worker, filePath) => [{ name: worker.id + '.js', directory: false, path: filePath }],
      diff: async (worker, mode) => `diff ${worker.id} ${mode}`,
      changedFiles: async worker => [{ path: worker.id + '.js', status: 'M' }],
      fileContent: async (worker, file, ref) => `${worker.id}:${file}:${ref}`
    },
    config: { manager: 'codex', worker: 'codex' },
    snapshot: () => state,
    store: { history: actor => [{ seq: 1, actor, type: 'message', data: { role: 'assistant', text: 'hello' } }] },
    sendManagerMessage: async (text, interrupt) => calls.push(['manager', text, interrupt]),
    interruptManager: async () => { interrupted++; return { interrupted: true, discarded: 1 }; },
    clearManagerMemory: async () => { memoryClears++; return { cleared: true, previousSessionId: 'old-thread' }; },
    sendWorkerMessage: async (workerId, text) => calls.push(['worker', workerId, text]),
    controlWorker: async (workerId, action, reason) => calls.push(['control', workerId, action, reason]),
    archiveWorker: async (workerId, reason, source) => { archived++; return { worker_id: workerId, reason, source }; },
    updateWorkerNotes: async () => {},
    respondApproval: () => {},
    answerQuestion: () => {},
    listConversationTurns: async (actor, options) => { versionCalls.push(['turns', actor, options]); return { data: [{ id: 'turn-1' }] }; },
    listSkills: async (actor, options) => { versionCalls.push(['skills', actor, options]); return { data: [{ cwd: directory, errors: [], skills: [{ name: 'pdf', description: 'PDF', enabled: true }] }] }; },
    forkConversation: async (actor, options) => { versionCalls.push(['fork', actor, options]); return { id: 'thread-forked' }; },
    revertConversation: async (actor, options) => { versionCalls.push(['revert', actor, options]); return { thread: { id: 'thread-1' } }; },
    listCheckpoints: () => [{ id: 'checkpoint-1', label: 'Manual' }],
    createCheckpoint: async label => { checkpointCalls.push(['create', label]); return { id: 'checkpoint-2', label }; },
    restoreCheckpoint: async (checkpointId, options) => { checkpointCalls.push(['restore', checkpointId, options]); return { checkpointId, restoredFiles: ['w1'], forkedConversations: ['manager'] }; }
  };
  const published = await publishControlServer(service, { onShutdown: () => {} });
  const client = new ServiceClient(published);
  t.after(async () => { client.stop(); await published.close(); });
  await client.start();
  assert.equal(client.snapshot().workers.w1.status, 'running');
  assert.equal(client.config.manager, 'codex');
  assert.equal(client.store.history('w1')[0].data.text, 'hello');
  assert.equal((await client.git.files({ id: 'w1' }, 'src'))[0].path, 'src');
  assert.equal(await client.git.diff({ id: 'w1' }, 'task'), 'diff w1 task');
  assert.equal((await client.git.changedFiles({ id: 'w1' }))[0].status, 'M');
  assert.equal(await client.git.content({ id: 'w1' }, 'src/w1.js', 'base'), 'w1:src/w1.js:base');
  await client.sendManagerMessage('hello', true);
  assert.deepEqual(calls[0], ['manager', 'hello', true]);
  assert.deepEqual(await client.interruptManager(), { interrupted: true, discarded: 1 });
  assert.equal(interrupted, 1);
  assert.deepEqual(await client.clearManagerMemory(), { cleared: true, previousSessionId: 'old-thread' });
  assert.equal(memoryClears, 1);
  assert.equal((await client.archiveWorker('w1', 'done')).worker_id, 'w1');
  assert.equal(archived, 1);
  assert.equal((await client.conversationTurns('manager', 5)).data[0].id, 'turn-1');
  assert.equal((await client.listSkills('manager')).skills.data[0].skills[0].name, 'pdf');
  assert.equal((await client.forkConversation('manager', { lastTurnId: 'turn-1' })).id, 'thread-forked');
  assert.equal((await client.revertConversation('manager', 'turn-1')).thread.id, 'thread-1');
  assert.deepEqual(versionCalls, [
    ['turns', 'manager', { limit: 5, sortDirection: 'desc', itemsView: 'summary' }],
    ['skills', 'manager', { forceReload: true }],
    ['fork', 'manager', { lastTurnId: 'turn-1', beforeTurnId: undefined, ephemeral: false }],
    ['revert', 'manager', { beforeTurnId: 'turn-1' }]
  ]);
  assert.equal((await client.listCheckpoints())[0].id, 'checkpoint-1');
  assert.equal((await client.createCheckpoint('Before refactor')).id, 'checkpoint-2');
  assert.deepEqual(await client.restoreCheckpoint('checkpoint-2', { files: true, conversation: true }), {
    checkpointId: 'checkpoint-2', restoredFiles: ['w1'], forkedConversations: ['manager']
  });
  assert.deepEqual(checkpointCalls, [
    ['create', 'Before refactor'],
    ['restore', 'checkpoint-2', { files: true, conversation: true }]
  ]);
  await client.shutdown();
  assert.equal(client.closed, true);
});
