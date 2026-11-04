import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MissionControlService } from '../src/core/service.js';
import { CodexRuntime } from '../src/adapters/codex.js';
import { ClaudeRuntime, claudeArgs } from '../src/adapters/claude.js';
import { DeepSeekRuntime } from '../src/adapters/acp.js';
import { OpenCodeRuntime } from '../src/adapters/opencode.js';
import { temporary, cleanup } from './helpers.js';
const command = fileURLToPath(new URL('./fixtures/native-cli.js', import.meta.url));

test('Codex denial uses the native cancel choice when decline is not offered', async () => {
  const runtime = { context: { actor: 'worker-test', emit: async () => false } };
  const response = await CodexRuntime.prototype.request.call(runtime, 'item/commandExecution/requestApproval', { availableDecisions: ['accept', 'cancel'] });
  assert.deepEqual(response, { decision: 'cancel' });
});

test('Codex starts a fresh thread when a saved manager rollout is stale', async () => {
  const calls = [], events = [];
  const runtime = {
    context: {
      sessionId: 'missing-thread', cwd: '/project', instructions: 'role', tools: [], actor: 'manager',
      emit: async event => events.push(event)
    },
    rpc: {
      notify() {},
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'initialize') return {};
        if (method === 'thread/resume') throw new Error('no rollout found for thread id missing-thread');
        if (method === 'thread/start') return { thread: { id: 'fresh-thread' } };
        return {};
      }
    }
  };
  await CodexRuntime.prototype.initialize.call(runtime);
  assert.deepEqual(calls.map(call => call[0]), ['initialize', 'thread/resume', 'thread/start']);
  assert.equal(runtime.threadId, 'fresh-thread');
  assert.ok(events.some(event => event.type === 'activity' && event.method === 'thread/resume/stale'));
  assert.deepEqual(events.at(-1), { type: 'session', id: 'fresh-thread' });
});

test('Codex defaults workers to native auto_review on new and resumed threads and keeps manager/explore workers read-only', async () => {
  for (const [actor, reviewer, sessionId, expected, readOnly = false] of [
    ['w', undefined, undefined, 'auto_review'], ['w', 'user', undefined, 'user'],
    ['manager', 'auto_review', undefined, 'user'], ['w', undefined, 'old-session', 'auto_review'],
    ['w', undefined, undefined, 'auto_review', true]
  ]) {
    let options, method;
    const runtime = {
      context: { actor, codexApprovals: reviewer, sessionId, readOnly, cwd: '/project', instructions: 'role', tools: [], emit: async () => {} },
      rpc: { notify() {}, request: async (name, params) => { if (name === 'initialize') return {}; method = name; options = params; return { thread: { id: sessionId ?? 'new-session' } }; } }
    };
    await CodexRuntime.prototype.initialize.call(runtime);
    assert.equal(method, sessionId ? 'thread/resume' : 'thread/start');
    assert.equal(options.approvalsReviewer, expected);
    assert.equal(options.approvalPolicy, 'on-request');
    assert.equal(options.sandbox, actor === 'manager' || readOnly ? 'read-only' : 'workspace-write');
  }
});

test('Codex automatic review records approvals as process details and surfaces rejection reasons', async () => {
  const messages = [];
  const runtime = { context: { emit: async event => messages.push(event) } };
  const params = { action: { type: 'command', command: 'git commit' }, review: { status: 'approved', rationale: 'Authorized task output' } };
  await CodexRuntime.prototype.notification.call(runtime, 'item/autoApprovalReview/started', params);
  await CodexRuntime.prototype.notification.call(runtime, 'item/autoApprovalReview/completed', params);
  await CodexRuntime.prototype.notification.call(runtime, 'item/autoApprovalReview/completed', { ...params, review: { status: 'denied', rationale: 'Deletes unrelated files' } });
  await CodexRuntime.prototype.notification.call(runtime, 'guardianWarning', { message: 'Automatic approval review approved (risk: low, authorization: high): Authorized' });
  await CodexRuntime.prototype.notification.call(runtime, 'guardianWarning', { message: 'Automatic approval review denied: Deletes unrelated files' });
  assert.equal(messages.filter(m => m.type === 'approval').length, 0, 'native automatic reviews must not create manual approval requests');
  const logs = messages.filter(m => m.type === 'message');
  assert.deepEqual(logs.map(m => m.role), ['tool', 'tool', 'error', 'tool', 'error']);
  assert.match(logs[2].text, /Deletes unrelated files/); assert.match(logs[2].text, /git commit/);
});

test('Codex tool notifications preserve full arguments, status and results', async () => {
  const messages = [];
  const runtime = { context: { emit: async event => messages.push(event) } };
  const started = { item: { id: 'call_1', type: 'commandExecution', command: 'npm.cmd test', cwd: 'D:/project', status: 'inProgress' } };
  const completed = { item: { ...started.item, status: 'completed', exitCode: 0, aggregatedOutput: 'all tests passed', durationMs: 125 } };
  await CodexRuntime.prototype.notification.call(runtime, 'item/started', started);
  await CodexRuntime.prototype.notification.call(runtime, 'item/completed', completed);
  const tools = messages.filter(message => message.tool).map(message => message.tool);
  assert.equal(tools.length, 2);
  assert.deepEqual(tools[0].arguments, { command: 'npm.cmd test', cwd: 'D:/project' });
  assert.equal(tools[0].status, 'inProgress');
  assert.equal(tools[1].result, 'all tests passed');
  assert.equal(tools[1].exitCode, 0);
  assert.equal(tools[1].durationMs, 125);
});

test('Codex and Claude staff model/effort settings map to native launch options', async () => {
  let options;
  const runtime = {
    context: { actor: 'worker', codexApprovals: 'auto_review', cwd: '/project', instructions: 'role', tools: [], model: 'gpt-5.1-codex', effort: 'high', emit: async () => {} },
    rpc: { notify() {}, request: async (name, params) => { if (name === 'initialize') return {}; options = params; return { thread: { id: 'thread' } }; } }
  };
  await CodexRuntime.prototype.initialize.call(runtime);
  assert.equal(options.model, 'gpt-5.1-codex');
  assert.equal(options.config.model_reasoning_effort, 'high');

  const args = claudeArgs({ actor: 'manager', instructions: 'role', model: 'claude-sonnet-4-5', effort: 'medium', sessionId: null }, 'mcp.json');
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'claude-sonnet-4-5']);
  assert.deepEqual(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2), ['--effort', 'medium']);
  const explore = claudeArgs({ actor: 'worker_explore', readOnly: true, instructions: 'role' }, 'mcp.json');
  const denied = explore[explore.indexOf('--disallowedTools') + 1];
  assert.match(denied, /Edit/);
  assert.doesNotMatch(denied, /Bash/);
});

test('Codex conversation turns, fork and revert map to native app-server methods', async () => {
  const calls = [], events = [];
  const runtime = {
    threadId: 'thread-original',
    context: { emit: async event => events.push(event) },
    rpc: {
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'thread/fork') return { thread: { id: 'thread-forked', forkedFromId: 'thread-original' } };
        return { data: [] };
      }
    }
  };
  await CodexRuntime.prototype.listTurns.call(runtime, { limit: 12 });
  assert.deepEqual(calls.pop(), ['thread/turns/list', { threadId: 'thread-original', limit: 12, sortDirection: 'desc', itemsView: 'summary' }]);
  await CodexRuntime.prototype.forkThread.call(runtime, { lastTurnId: 'turn-2' });
  assert.deepEqual(calls.pop(), ['thread/fork', { threadId: 'thread-original', lastTurnId: 'turn-2', ephemeral: false, excludeTurns: true }]);
  assert.equal(runtime.threadId, 'thread-forked');
  assert.deepEqual(events.at(-1), { type: 'session', id: 'thread-forked' });
  await CodexRuntime.prototype.revertThread.call(runtime, { beforeTurnId: 'turn-3' });
  assert.deepEqual(calls.pop(), ['thread/revert', { threadId: 'thread-forked', beforeTurnId: 'turn-3' }]);
});

test('Codex sends skill markers as text for provider-neutral Last Order injection', async () => {
  const calls = [], events = [];
  const runtime = {
    threadId: 'thread-skills',
    context: { cwd: '/project', emit: async event => events.push(event) },
    rpc: {
      request: async (method, params) => {
        calls.push([method, params]);
        if (method === 'turn/start') {
          queueMicrotask(() => void CodexRuntime.prototype.notification.call(runtime, 'turn/completed', { turn: { status: 'completed' } }));
          return { turn: { id: 'turn-skills-1' } };
        }
        return {};
      }
    }
  };
  Object.setPrototypeOf(runtime, CodexRuntime.prototype);
  await CodexRuntime.prototype.run.call(runtime, '$pdf summarize this');
  assert.deepEqual(calls, [['turn/start', {
    threadId: 'thread-skills',
    input: [{ type: 'text', text: '$pdf summarize this' }]
  }]]);
  assert.deepEqual(events.at(-1), { type: 'turn', id: 'turn-skills-1' });
});

for (const [provider, Runtime] of Object.entries({ codex: CodexRuntime, claude: ClaudeRuntime, dsh: DeepSeekRuntime, opencode: OpenCodeRuntime })) {
  test(`${provider} adapter maps session, native approval and explicit completion against a protocol fixture`, async t => {
    const directory = await temporary('adapter-' + provider + '-');
    const git = { directory, root: directory, head: async () => 'base', create: async w => { const dir = path.join(directory, w.id); await mkdir(dir); return dir; }, result: async () => 'output-commit', deliver: async () => {} };
    const service = new MissionControlService(git, async (p, context) => context.actor === 'manager' ? { run: async () => {}, stop: async () => {} } : Runtime.create(context, command), { manager: provider, worker: provider });
    t.after(async () => { await service.stop(); await cleanup(directory); });
    let approved = 0;
    service.on('change', () => { for (const id of service.approvals.keys()) { approved++; service.respondApproval(id, true); } });
    await service.start();
    const pipeline = await service.registerPipeline({ title: 'Fixture task', stages: [{ kind: 'implement', prompt: 'Fixture only' }] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { service.off('change', check); reject(new Error('Native fixture timed out')); }, 10_000);
      function check() { const p = service.state.pipelines[pipeline.id]; if (p.status === 'succeeded') { clearTimeout(timer); service.off('change', check); resolve(); } else if (p.status === 'failed') { clearTimeout(timer); service.off('change', check); reject(new Error(JSON.stringify(service.store.history(p.stages[0].workerId)))); } }
      service.on('change', check); check();
    });
    assert.equal(approved, 1);
    const worker = Object.values(service.state.workers)[0];
    assert.equal(worker.sessionId, 'session-fixture'); assert.equal(worker.status, 'succeeded');
  });
}
