import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MissionControlService } from '../src/core/service.js';
import { deferred } from '../src/adapters/rpc.js';
import { temporary, cleanup } from './helpers.js';

export function waitFor(service, predicate, timeout = 3000) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let poll;
    const check = () => {
      if (!predicate()) return;
      clearTimeout(timer); clearInterval(poll); service.off('change', check); resolve();
    };
    const timer = setTimeout(() => {
      service.off('change', check);
      clearInterval(poll);
      reject(new Error('Timed out waiting for state: ' + JSON.stringify({
        managerBusy: service.managerBusy, managerError: service.managerError,
        pending: service.state.manager.pending, workers: service.state.workers,
        pipelines: service.state.pipelines
      })));
    }, timeout);
    poll = setInterval(check, 10);
    service.on('change', check);
  });
}
async function fixture(t, behavior, options = {}) {
  const directory = await temporary('service-');
  const commits = [], contexts = []; const git = { directory, root: directory, head: async () => 'base', create: async w => path.join(directory, w.id), ensureInput: async () => {}, validateReviewOutput: async () => { throw new Error('Reviewer changed implementation'); }, result: async w => w.kind === 'review' ? service.state.pipelines[w.pipelineId].stages[w.stageIndex - 1]?.outputCommit ?? 'base' : 'commit-' + w.id, deliver: async (...args) => { commits.push(args); } };
  const factory = async (provider, context) => {
    contexts.push(context); const end = deferred(); let stopped = false;
    return { run: async prompt => {
      if (context.actor === 'manager') return options.manager?.(context, prompt, end);
      return Promise.race([behavior(context, end, prompt), end.promise]);
    }, stop: async () => { if (!stopped) { stopped = true; end.resolve(); } } };
  };
  const service = new MissionControlService(git, factory, { silenceMs: 10_000, ...options.config }); await service.start();
  const services = [service];
  t.after(async () => { for (const instance of services) await instance.stop(); await cleanup(directory); });
  return { service, git, factory, commits, contexts, services };
}
const stage = kind => ({ kind, prompt: 'Do ' + kind });

test('background progress replies are tagged for folding while user replies, questions and final delivery remain visible', async t => {
  const { service } = await fixture(t, async () => {}, { manager: async (context, prompt) => {
    const input = JSON.parse(prompt), type = input.user_messages.length ? 'user-reply' : input.notifications[0].type;
    await context.callTool('inspect', {});
    await context.emit({ type: 'message', text: type });
    if (type === 'worker_progress') await context.callTool('ask_user', { question: 'Which behavior do you want?' });
  } });
  await service.sendManagerMessage('hello');
  await waitFor(service, () => !service.managerBusy && !service.state.manager.pending.length);
  for (const type of ['worker_progress', 'worker_finished', 'worker_delivered']) {
    service.notify(type, null, 'Update');
    await waitFor(service, () => !service.managerBusy && !service.state.notifications.length);
  }
  const messages = service.store.history('manager').filter(e => e.type === 'message');
  assert.deepEqual(messages.filter(e => e.data.role === 'assistant').map(e => [e.data.text, Boolean(e.data.background)]), [
    ['user-reply', false], ['worker_progress', true], ['worker_finished', false], ['worker_delivered', false]
  ]);
  assert.ok(messages.filter(e => e.data.role === 'tool').every(e => e.data.background));
  assert.equal(messages.find(e => e.data.role === 'question').data.background, undefined);
});

test('linked stages advance automatically; delivery does not require manager activation', async t => {
  const order = [];
  const { service, commits } = await fixture(t, async c => {
    const kind = service.state.workers[c.actor].kind; order.push(kind);
    await c.callTool('report_result', { status: 'succeeded', summary: kind });
  });
  const p = await service.registerPipeline({ title: 'Feature', stages: [stage('implement'), stage('review'), stage('integrate')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'succeeded');
  assert.deepEqual(order, ['implement', 'review', 'integrate']);
  assert.equal(commits.length, 1); assert.match(commits[0][0], /^last-order\/delivery\//);
  assert.equal(new Set(Object.values(service.state.workers).map(w => w.branch)).size, 3);
});

test('simple task may omit review; duplicate callback registration is idempotent', async t => {
  const { service } = await fixture(t, c => c.callTool('report_result', { status: 'succeeded', summary: 'Done' }));
  const args = { title: 'Simple', stages: [stage('implement')] };
  const [a, b] = await Promise.all([service.registerPipeline(args, 'same-call'), service.registerPipeline(args, 'same-call')]);
  assert.equal(a.id, b.id); assert.equal(Object.keys(service.state.pipelines).length, 1);
  await waitFor(service, () => service.state.pipelines[a.id].status === 'succeeded');
  assert.equal(service.state.pipelines[a.id].stages.length, 1);
});

test('review failure with evidence blocks integration, and return to implementer resets downstream', async t => {
  let failReview = true;
  const { service } = await fixture(t, async c => {
    const kind = service.state.workers[c.actor].kind;
    await c.callTool('report_result', { status: kind === 'review' && failReview ? 'review_failed' : 'succeeded', summary: kind, evidence: 'Counterexample: invalid input still returns success' });
  });
  const p = await service.registerPipeline({ title: 'Review', max_reworks: 1, stages: [stage('implement'), stage('review'), stage('integrate')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'review_failed');
  assert.equal(service.state.pipelines[p.id].stages[2].workerId, null);
  failReview = false;
  const implementer = service.state.pipelines[p.id].stages[0].workerId;
  await service.controlWorker(implementer, 'retry', 'Fix counterexample');
  await waitFor(service, () => service.state.pipelines[p.id].status === 'succeeded');
  assert.equal(service.state.pipelines[p.id].reworks, 1);
  await assert.rejects(service.controlWorker(implementer, 'retry'), /limit/);
});

test('a normal process exit without an explicit outcome cannot pass a stage', async t => {
  const { service, commits } = await fixture(t, async () => {});
  const p = await service.registerPipeline({ title: 'No report', stages: [stage('implement'), stage('review')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'failed');
  assert.equal(commits.length, 0); assert.equal(service.state.pipelines[p.id].stages[1].workerId, null);
});

test('reviewers cannot advance the chain by fixing and committing implementation themselves', async t => {
  const { service, git, commits } = await fixture(t, c => c.callTool('report_result', { status: 'succeeded', summary: 'Pass' }));
  git.result = async worker => worker.kind === 'review' ? 'reviewer-modified-code' : 'implementation-commit';
  const p = await service.registerPipeline({ title: 'Independent review', stages: [stage('implement'), stage('review'), stage('integrate')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'failed');
  assert.equal(service.state.pipelines[p.id].stages[2].workerId, null); assert.equal(commits.length, 0);
  const reviewer = service.state.pipelines[p.id].stages[1].workerId;
  assert.ok(service.store.history(reviewer).some(e => e.data.text?.includes('Reviewer changed')));
});

test('reviewers may commit independent acceptance tests once implementation changes are ruled out', async t => {
  const { service, git, commits } = await fixture(t, c => c.callTool('report_result', { status: 'succeeded', summary: 'Pass' }));
  git.result = async worker => worker.kind === 'review' ? 'acceptance-tests-commit' : 'implementation-commit';
  git.validateReviewOutput = async (worker, input, output) => { assert.equal(input, 'implementation-commit'); assert.equal(output, 'acceptance-tests-commit'); };
  const p = await service.registerPipeline({ title: 'Acceptance additions', stages: [stage('implement'), stage('review')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'succeeded');
  assert.equal(commits[0][1], 'acceptance-tests-commit');
});

test('pause invalidates late callbacks, retains work, and never starts the next stage', async t => {
  let old;
  const { service } = await fixture(t, async (c, end) => { old = c; await end.promise; });
  const p = await service.registerPipeline({ title: 'Pause', stages: [stage('implement'), stage('review')] });
  await waitFor(service, () => old && Object.values(service.state.workers).some(w => w.status === 'running'));
  const worker = Object.values(service.state.workers)[0];
  await old.emit({ type: 'message', text: 'Inspecting the build workflow' });
  const inspection = await service.invoke('manager', service.state.manager.epoch, 'inspect', { id: worker.id });
  assert.ok(inspection.recentEvents.some(e => e.data.text === 'Inspecting the build workflow'));
  assert.equal(inspection.process.attached, true);
  const inspectCalls = service.store.history('manager').filter(e => e.data.tool?.name === 'inspect');
  assert.deepEqual(inspectCalls.map(e => e.data.tool.status), ['running', 'completed']);
  assert.equal(inspectCalls[0].data.tool.id, inspectCalls[1].data.tool.id);
  assert.deepEqual(inspectCalls[0].data.tool.arguments, { id: worker.id });
  assert.ok(inspectCalls[1].data.tool.result);
  await service.controlWorker(worker.id, 'pause');
  await assert.rejects(old.callTool('report_result', { status: 'succeeded', summary: 'late' }), /Stale/);
  assert.equal(service.state.pipelines[p.id].status, 'paused');
  assert.equal(service.state.pipelines[p.id].stages[1].workerId, null);
});

test('restart resumes interrupted tasks automatically but leaves explicitly paused tasks alone', async t => {
  const { service, git, services } = await fixture(t, async (c, end) => end.promise);
  const one = await service.registerPipeline({ title: 'Resume', stages: [stage('implement')] });
  const two = await service.registerPipeline({ title: 'Stay paused', stages: [stage('implement')] });
  await waitFor(service, () => Object.values(service.state.workers).filter(w => w.status === 'running').length === 2);
  const pausedWorker = service.state.pipelines[two.id].stages[0].workerId;
  await service.controlWorker(pausedWorker, 'pause'); await service.stop();
  const resumed = new MissionControlService(git, async (provider, c) => ({ run: () => c.actor === 'manager' ? Promise.resolve() : c.callTool('report_result', { status: 'succeeded', summary: 'Resumed current work' }), stop: async () => {} }));
  services.push(resumed); await resumed.start();
  await waitFor(resumed, () => resumed.state.pipelines[one.id].status === 'succeeded');
  assert.equal(resumed.state.pipelines[two.id].status, 'paused');
  assert.equal(Object.keys(resumed.state.workers).length, 2);
});

test('worker tools cannot invoke manager tools; review failures require evidence', async t => {
  const { service } = await fixture(t, async (c, end) => end.promise);
  await service.registerPipeline({ title: 'Permissions', stages: [stage('implement')] });
  await waitFor(service, () => Object.values(service.state.workers).some(w => w.status === 'running'));
  const w = Object.values(service.state.workers)[0];
  await assert.rejects(service.invoke(w.id, w.epoch, 'register_pipeline', {}), /not available/);
  await assert.rejects(service.invoke(w.id, w.epoch, 'report_result', { status: 'review_failed', summary: 'Bad' }), /evidence/);
});

test('approval blocks work until the user responds; silence only notifies, never terminates', async t => {
  const { service } = await fixture(t, async c => {
    const allow = await c.emit({ type: 'approval', detail: { command: 'write file' } });
    await c.callTool('report_result', { status: allow ? 'succeeded' : 'blocked_technical', summary: 'Permission denied' });
  });
  const p = await service.registerPipeline({ title: 'Approval', stages: [stage('implement')] });
  await waitFor(service, () => service.approvals.size === 1);
  const worker = Object.values(service.state.workers)[0]; worker.lastActivity = 0;
  service.checkSilence();
  assert.equal(worker.status, 'waiting_approval');
  assert.equal(service.state.notifications.filter(x => x.type === 'worker_unresponsive').length, 0);
  service.respondApproval([...service.approvals.keys()][0], false);
  await waitFor(service, () => service.state.pipelines[p.id].status === 'blocked_technical');
});

test('manager ordinary messages queue; explicit interrupt invalidates the old turn and preserves input', async t => {
  const calls = [], gates = [];
  const { service } = await fixture(t, async (c, end) => end.promise, { manager: async (c, prompt, end) => {
    const gate = deferred(); gates.push(gate); calls.push({ context: c, input: JSON.parse(prompt) });
    service.emit('change', { type: 'fixture_manager_turn' });
    if (calls.length <= 2) await Promise.race([gate.promise, end.promise]);
  } });
  await service.sendManagerMessage('first');
  await waitFor(service, () => calls.length === 1);
  await service.sendManagerMessage('queued');
  assert.equal(calls.length, 1);
  const queuedEvent = service.store.history('manager').find(event => event.type === 'manager_input' && event.data.text === 'queued');
  assert.equal(queuedEvent.data.queued, true);
  assert.ok(queuedEvent.data.messageId);
  assert.equal(service.state.manager.pending.find(item => item.id === queuedEvent.data.messageId).queued, true);
  gates[0].resolve();
  await waitFor(service, () => calls.length === 2);
  assert.equal(calls[1].input.user_messages[0].text, 'queued');
  await service.sendManagerMessage('urgent', true);
  await waitFor(service, () => calls.length === 3 && service.state.manager.pending.length === 0);
  await assert.rejects(calls[1].context.callTool('inspect', {}), /Stale/);
  assert.deepEqual(calls[2].input.user_messages.map(m => m.text), ['queued', 'urgent']);
});

test('interrupt without a replacement message stops the manager and waits for the next user message', async t => {
  const calls = [], gates = [];
  const { service } = await fixture(t, async () => {}, { manager: async (_context, prompt, end) => {
    calls.push(JSON.parse(prompt));
    const gate = deferred(); gates.push(gate);
    await Promise.race([gate.promise, end.promise]);
  } });
  await service.sendManagerMessage('stop this work');
  await waitFor(service, () => calls.length === 1 && service.managerBusy);
  const result = await service.interruptManager();
  assert.deepEqual(result, { interrupted: true, discarded: 1 });
  await waitFor(service, () => !service.managerBusy);
  assert.equal(calls.length, 1);
  assert.equal(service.state.manager.hold, true);
  assert.deepEqual(service.state.manager.pending, []);

  await service.sendManagerMessage('new instruction');
  await waitFor(service, () => calls.length === 2);
  assert.equal(service.state.manager.hold, false);
  assert.deepEqual(calls[1].user_messages.map(message => message.text), ['new instruction']);
  gates[1].resolve();
});

test('worker callbacks queue while the manager is talking and run after the current turn', async t => {
  const calls = [];
  let gate;
  const { service } = await fixture(t, async () => {}, { manager: async (_context, prompt, end) => {
    calls.push(JSON.parse(prompt));
    if (calls.length === 1) {
      gate = deferred();
      await Promise.race([gate.promise, end.promise]);
    }
  } });
  await service.sendManagerMessage('正在和用户沟通');
  await waitFor(service, () => calls.length === 1 && service.managerBusy);
  service.notify('worker_finished', 'w1', 'worker finished while manager was busy');
  assert.equal(calls.length, 1, 'worker callback must not preempt the active user turn');
  assert.equal(service.state.notifications.length, 1);
  gate.resolve();
  await waitFor(service, () => calls.length === 2);
  assert.equal(calls[1].notifications[0].type, 'worker_finished');
  assert.match(calls[1].notifications[0].text, /manager was busy/);
});

test('silence alerts manager with evidence context, without killing or failing the worker', async t => {
  const { service } = await fixture(t, async (c, end) => end.promise);
  await service.registerPipeline({ title: 'Long task', stages: [stage('implement')] });
  await waitFor(service, () => Object.values(service.state.workers).some(w => w.status === 'running'));
  const w = Object.values(service.state.workers)[0]; w.lastActivity = 0;
  service.checkSilence();
  assert.equal(service.state.workers[w.id].status, 'running');
  const alerts = service.store.history().filter(e => e.type === 'notification' && e.data.type === 'worker_unresponsive');
  assert.equal(alerts.length, 1);
  service.checkSilence();
  assert.equal(service.store.history().filter(e => e.type === 'notification' && e.data.type === 'worker_unresponsive').length, 1);
});

test('concurrency limit queues independent chains without serializing their registration', async t => {
  const { service } = await fixture(t, async (c, end) => end.promise, { config: { maxWorkers: 1 } });
  for (let i = 0; i < 3; i++) await service.registerPipeline({ title: 'Task ' + i, stages: [stage('implement')] });
  await waitFor(service, () => Object.values(service.state.workers).some(w => w.status === 'running'));
  assert.equal(Object.values(service.state.workers).length, 1);
  assert.equal(Object.values(service.state.pipelines).filter(p => p.status === 'queued').length, 2);
});

test('restart publishes an already committed final result without rerunning the implementation', async t => {
  const delivery = deferred();
  const { service, git, services } = await fixture(t, c => c.callTool('report_result', { status: 'succeeded', summary: 'Committed' }));
  git.deliver = () => delivery.promise;
  const p = await service.registerPipeline({ title: 'Publish recovery', stages: [stage('implement')] });
  await waitFor(service, () => service.state.pipelines[p.id].status === 'awaiting_delivery');
  const stopped = service.stop(); delivery.resolve(); await stopped;
  let workerRuns = 0;
  const resumed = new MissionControlService(git, async (provider, c) => ({ run: async () => { if (c.actor !== 'manager') workerRuns++; }, stop: async () => {} }));
  services.push(resumed); await resumed.start();
  await waitFor(resumed, () => resumed.state.pipelines[p.id].status === 'succeeded');
  assert.equal(workerRuns, 0);
});

test('Mission Control workers keep manager notes and dependent follow-ups inherit the completed commit', async t => {
  const gates = [];
  const { service, git } = await fixture(t, async context => {
    const gate = deferred();
    gates.push({ context, gate });
    await gate.promise;
    await context.callTool('report_result', { status: 'succeeded', summary: 'Task complete' });
  });
  const createBases = [], create = git.create;
  git.create = async (worker, base) => { createBases.push(base); return create(worker, base); };

  const first = await service.invoke('manager', service.state.manager.epoch, 'start_worker', {
    title: 'First change',
    prompt: 'Implement the first change',
    model: 'task-specific-model',
    effort: 'high',
    notes: ['After completion, arrange an independent review']
  });
  await waitFor(service, () => gates.length === 1);
  const firstWorker = Object.values(service.state.workers)[0];
  assert.equal(firstWorker.title, 'First change');
  assert.equal(firstWorker.model, 'task-specific-model');
  assert.equal(firstWorker.effort, 'high');
  assert.equal(gates[0].context.model, 'task-specific-model');
  assert.equal(gates[0].context.effort, 'high');
  assert.deepEqual(firstWorker.notes, ['After completion, arrange an independent review']);
  assert.equal(first.task_id, firstWorker.pipelineId);

  await service.invoke('manager', service.state.manager.epoch, 'update_worker_notes', {
    worker_id: firstWorker.id,
    notes: ['Updated: review with adversarial browser checks']
  });
  gates[0].gate.resolve();
  await waitFor(service, () => service.state.pipelines[firstWorker.pipelineId].status === 'succeeded');

  const callback = service.store.history().filter(event => event.type === 'notification' && event.data.type === 'worker_finished').at(-1);
  assert.deepEqual(callback.data.details.notes, ['Updated: review with adversarial browser checks']);
  assert.equal(callback.data.details.result_commit, 'commit-' + firstWorker.id);

  const second = await service.invoke('manager', service.state.manager.epoch, 'start_worker', {
    title: 'Sequential verification',
    prompt: 'Verify the first worker result',
    kind: 'implement',
    input_worker_id: firstWorker.id,
    notes: ['This must wait for the first worker']
  });
  await waitFor(service, () => gates.length === 2);
  const secondWorker = Object.values(service.state.workers).find(worker => worker.pipelineId === second.task_id);
  assert.equal(second.input_worker_id, firstWorker.id);
  assert.equal(secondWorker.baseCommit, service.state.workers[firstWorker.id].resultCommit);
  assert.equal(createBases.at(-1), service.state.workers[firstWorker.id].resultCommit);
  gates[1].gate.resolve();
});

test('explore workers run read-only and succeed without commits or delivery branches', async t => {
  const { service, contexts, git, commits } = await fixture(t, async context => {
    await context.callTool('report_result', { status: 'succeeded', summary: 'Found the test and CI entrypoints', evidence: 'package.json:scripts, .github/workflows' });
  });
  git.result = async () => { throw new Error('Explore workers must not require a commit'); };
  const task = await service.invoke('manager', service.state.manager.epoch, 'start_worker', {
    title: 'Explore automation', prompt: 'Explore the repository and report the automation setup', kind: 'explore'
  });
  await waitFor(service, () => service.state.pipelines[task.task_id].status === 'succeeded');
  const worker = Object.values(service.state.workers).find(item => item.pipelineId === task.task_id);
  const context = contexts.find(item => item.actor === worker.id);
  assert.equal(context.readOnly, true);
  assert.match(context.instructions, /read-only repository exploration/i);
  assert.equal(worker.status, 'succeeded');
  assert.equal(worker.resultCommit, service.state.pipelines[task.task_id].baseCommit);
  assert.equal(commits.length, 0);
  assert.equal(service.state.requests[task.request_id].deliveryCommit ?? null, null);
});

test('manager auto-delegates concrete archive analysis but answers pure concepts directly', async t => {
  const payloads = [];
  const { service } = await fixture(t, async context => {
    await context.callTool('report_result', { status: 'succeeded', summary: 'Archive exploration complete', evidence: 'zip entries and source files inspected' });
  }, {
    manager: async (_context, prompt) => { payloads.push(JSON.parse(prompt)); }
  });

  await service.sendManagerMessage('什么是自动化测试？');
  await waitFor(service, () => !service.managerBusy && service.state.manager.pending.length === 0);
  assert.equal(Object.keys(service.state.workers).length, 0);
  const concept = payloads.find(item => item.user_messages.some(message => message.text.includes('什么是自动化测试')));
  assert.equal(concept.delegation_policy.requires_explore, false);

  await service.sendManagerMessage('分析一下 "D:\\workspaces\\mobile-demo\\spatial-annotation-demo-kit.zip" 给我个实验方案');
  await waitFor(service, () => Object.values(service.state.workers).some(worker => worker.kind === 'explore'));
  await waitFor(service, () => payloads.some(item => item.user_messages.some(message => message.text.includes('spatial-annotation-demo-kit.zip'))));
  const worker = Object.values(service.state.workers).find(item => item.kind === 'explore');
  const delegated = payloads.find(item => item.user_messages.some(message => message.text.includes('spatial-annotation-demo-kit.zip')));
  assert.equal(delegated.delegation_policy.requires_explore, true);
  assert.equal(delegated.delegation_policy.policy_version, '2026-11-04.3');
  assert.equal(delegated.prompt_config.managerPolicyVersion, '2026-11-04.3');
  assert.equal(delegated.delegation_policy.auto_started.worker_kind, 'explore');
  assert.ok(['running', 'succeeded'].includes(worker.status));
});

test('Mission Control passes manager and worker staff model settings into runtime contexts', async t => {
  const { service, contexts } = await fixture(t, async context => {
    await context.callTool('report_result', { status: 'succeeded', summary: 'Done' });
  }, {
    config: {
      managerModel: 'manager-model', managerEffort: 'high',
      workerModel: 'worker-model', workerEffort: 'low'
    },
    manager: async () => {}
  });
  await service.sendManagerMessage('hello');
  await waitFor(service, () => !service.managerBusy);
  const manager = contexts.find(context => context.actor === 'manager');
  assert.equal(manager.provider, 'codex');
  assert.equal(manager.model, 'manager-model');
  assert.equal(manager.effort, 'high');

  await service.invoke('manager', service.state.manager.epoch, 'start_worker', {
    title: 'Staff settings', prompt: 'Run with worker staff defaults'
  });
  await waitFor(service, () => contexts.some(context => context.actor.startsWith('worker_')));
  const worker = contexts.find(context => context.actor.startsWith('worker_'));
  assert.equal(worker.provider, 'codex');
  assert.equal(worker.model, 'worker-model');
  assert.equal(worker.effort, 'low');
});

test('Mission Control separates staff prompt configuration from system rules and persists manager AGENTS.md memory', async t => {
  let managerPromptPayload;
  const { service, contexts, git } = await fixture(t, async context => {
    await context.callTool('report_result', { status: 'succeeded', summary: 'Done' });
  }, {
    config: { managerPrompt: 'Manager habit from config', workerPrompt: 'Worker habit from config' },
    manager: async (context, prompt) => { managerPromptPayload = JSON.parse(prompt); }
  });
  await service.sendManagerMessage('hello');
  await waitFor(service, () => !service.managerBusy);
  const manager = contexts.find(context => context.actor === 'manager');
  assert.match(manager.instructions, /User-editable manager prompt from Mission Control/);
  assert.match(manager.instructions, /Manager habit from config/);
  assert.equal(managerPromptPayload.prompt_config.managerPrompt, 'Manager habit from config');
  assert.equal(managerPromptPayload.prompt_config.workerPrompt, 'Worker habit from config');

  const remembered = await service.invoke('manager', service.state.manager.epoch, 'remember_manager_guidance', {
    text: 'Always run the full test suite before reporting completion'
  });
  assert.match(remembered.path, /AGENTS\.md$/);
  assert.match(await readFile(path.join(git.directory, 'AGENTS.md'), 'utf8'), /Always run the full test suite/);
  assert.match(service.managerInstructions() + service.staffPromptSuffix('manager'), /Manager AGENTS\.md memory/);
  assert.match(service.managerInstructions() + service.staffPromptSuffix('manager'), /Always run the full test suite/);
  assert.match(service.managerInstructions(), /Every worker_finished or worker_failed callback requires an explicit user-report decision/);
  assert.match(service.managerInstructions(), /ask the user whether to archive that completed worker or provide a new requirement/);
  assert.match(service.managerInstructions(), /keep interactive work with the manager/);

  await service.invoke('manager', service.state.manager.epoch, 'start_worker', {
    title: 'Prompt config', prompt: 'Inspect the worker prompt'
  });
  await waitFor(service, () => contexts.some(context => context.actor.startsWith('worker_')));
  const worker = contexts.find(context => context.actor.startsWith('worker_'));
  assert.match(worker.instructions, /User-editable worker prompt from Mission Control/);
  assert.match(worker.instructions, /Worker habit from config/);
});

test('clearing manager memory detaches only the native conversation thread', async t => {
  const { service, contexts } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.manager.sessionId = 'old-manager-thread';
  service.state.manager.lastTurnId = 'old-turn';
  service.state.workers.w1 = { id: 'w1', status: 'succeeded', title: 'Keep this worker' };
  const epoch = service.state.manager.epoch;
  const memoryEpoch = service.state.manager.memoryEpoch ?? 0;
  const result = await service.clearManagerMemory();
  assert.deepEqual(result, { cleared: true, previousSessionId: 'old-manager-thread' });
  assert.equal(service.state.manager.sessionId, null);
  assert.equal(service.state.manager.lastTurnId, null);
  assert.equal(service.state.manager.epoch, epoch + 1);
  assert.equal(service.state.manager.memoryEpoch, memoryEpoch + 1);
  assert.equal(service.state.workers.w1.title, 'Keep this worker');

  await service.sendManagerMessage('新的会话');
  await waitFor(service, () => contexts.some(context => context.actor === 'manager'));
  const manager = contexts.find(context => context.actor === 'manager');
  assert.equal(manager.sessionId, null, 'the next manager turn must start a new native thread');
});

test('Mission Control forwards native conversation version operations to the provider runtime', async t => {
  const { service } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.manager.sessionId = 'thread-native';
  const calls = [];
  service.factory = async () => ({
    listTurns: async options => { calls.push(['turns', options]); return { data: [{ id: 'turn-1' }] }; },
    forkThread: async options => { calls.push(['fork', options]); return { id: 'thread-forked' }; },
    revertThread: async options => { calls.push(['revert', options]); return { thread: { id: 'thread-native' } }; },
    stop: async () => { calls.push(['stop']); }
  });
  assert.equal((await service.listConversationTurns('manager', { limit: 5 })).data[0].id, 'turn-1');
  assert.equal((await service.forkConversation('manager', { lastTurnId: 'turn-1' })).id, 'thread-forked');
  assert.deepEqual(await service.revertConversation('manager', { beforeTurnId: 'turn-2' }), { thread: { id: 'thread-native' } });
  assert.deepEqual(calls, [
    ['turns', { limit: 5 }],
    ['stop'],
    ['fork', { lastTurnId: 'turn-1' }],
    ['stop'],
    ['revert', { beforeTurnId: 'turn-2' }],
    ['stop']
  ]);
});

test('selected skills are resolved by Last Order and injected into manager prompts', async t => {
  let payload;
  const { service, git } = await fixture(t, async () => {}, {
    manager: async (_context, prompt) => { payload = JSON.parse(prompt); }
  });
  const directory = path.join(git.root, '.agents', 'skills', 'pdf');
  await import('node:fs/promises').then(fs => fs.mkdir(directory, { recursive: true }));
  await import('node:fs/promises').then(fs => fs.writeFile(path.join(directory, 'SKILL.md'),
    '---\nname: pdf\ndescription: Read PDF files\n---\n\nUse the PDF workflow.\n', 'utf8'));
  const listed = await service.listSkills('manager');
  assert.equal(listed.data[0].skills.find(skill => skill.name === 'pdf').scope, 'repo');
  await service.sendManagerMessage('请使用 $pdf 总结这个文档');
  await waitFor(service, () => !service.managerBusy && payload);
  assert.equal(payload.selected_skills[0].name, 'pdf');
  assert.match(payload.selected_skills[0].instructions, /Use the PDF workflow/);
  const loaded = await service.invoke('manager', service.state.manager.epoch, 'use_skill', { name: 'pdf' });
  assert.match(loaded.instructions, /Use the PDF workflow/);
});

test('manager can page through worker event history when completion summaries are insufficient', async t => {
  const { service } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.workers.w1 = { id: 'w1', status: 'succeeded', title: 'History worker' };
  service.log('w1', 'assistant', 'worker message one');
  service.log('w1', 'assistant', 'worker message two');
  service.log('w1', 'tool', 'worker tool detail');
  const page = await service.invoke('manager', service.state.manager.epoch, 'inspect_worker_history', {
    worker_id: 'w1', limit: 2
  });
  assert.deepEqual(page.events.map(event => event.data.text), ['worker message two', 'worker tool detail']);
  assert.ok(page.next_before_seq);
  const older = await service.invoke('manager', service.state.manager.epoch, 'inspect_worker_history', {
    worker_id: 'w1', before_seq: page.next_before_seq, limit: 2
  });
  assert.deepEqual(older.events.map(event => event.data.text), ['worker message one']);
});

test('stopped workers can be manually archived and archived workers are read-only', async t => {
  const { service } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.pipelines.p1 = { id: 'p1', status: 'succeeded', stages: [], reworks: 0, maxReworks: 3 };
  service.state.workers.w1 = { id: 'w1', pipelineId: 'p1', status: 'succeeded', title: 'Finished', epoch: 1 };
  service.state.workers.w2 = { id: 'w2', pipelineId: 'p1', status: 'running', title: 'Running', epoch: 1 };
  await assert.rejects(service.archiveWorker('w2', 'user', 'user'), /only stopped workers/);
  const result = await service.archiveWorker('w1', 'finished', 'user');
  assert.equal(result.worker_id, 'w1');
  assert.ok(service.state.workers.w1.archivedAt);
  assert.equal(service.state.workers.w1.archivedBy, 'user');
  assert.equal(service.state.workers.w1.resumable, false);
  await assert.rejects(service.sendWorkerMessage('w1', 'continue'), /archived/);
  await assert.rejects(service.controlWorker('w1', 'retry'), /archived/);
  await assert.rejects(service.startWorker({ title: 'Next', prompt: 'Next', input_worker_id: 'w1' }), /archived/);
});

test('manager can archive a stopped worker only through the explicit archive tool', async t => {
  const { service } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.workers.w1 = { id: 'w1', pipelineId: 'p1', status: 'failed', title: 'Failed', epoch: 1 };
  await service.invoke('manager', service.state.manager.epoch, 'archive_worker', { worker_id: 'w1', reason: 'user confirmed' });
  assert.equal(service.state.workers.w1.archivedBy, 'manager');
  assert.equal(service.state.workers.w1.archiveReason, 'user confirmed');
});

test('quoted Manager messages preserve structured quote metadata in prompts and events', async t => {
  let payload;
  const { service } = await fixture(t, async () => {}, {
    manager: async (_context, prompt) => { payload = JSON.parse(prompt); }
  });
  const quote = {
    project: 'A', actor: 'worker_1', seq: 18, role: 'assistant',
    time: '2026-11-05T01:00:00.000Z', text: 'Worker evidence text'
  };
  await service.sendManagerMessage('> quoted\n\nExplain this', false, [quote]);
  await waitFor(service, () => !service.managerBusy && payload);
  assert.deepEqual(payload.user_messages[0].quotes, [quote]);
  const input = service.store.history('manager').find(event => event.type === 'manager_input');
  assert.deepEqual(input.data.quotes, [quote]);
});

test('Mission Control creates and restores workspace checkpoints with native session references', async t => {
  const { service, git } = await fixture(t, async () => {}, { manager: async () => {} });
  service.state.manager.sessionId = 'manager-thread';
  service.state.manager.lastTurnId = 'manager-turn';
  service.state.workers.w1 = {
    id: 'w1', title: 'Checkpoint worker', status: 'succeeded', provider: 'codex',
    sessionId: 'worker-thread', lastTurnId: 'worker-turn', workspace: '/tmp/w1', branch: 'last-order/worker/w1'
  };
  const calls = [];
  git.snapshotWorker = async (worker, checkpointId) => { calls.push(['snapshot', worker.id, checkpointId]); return { commit: 'snapshot-commit', head: 'head', branch: worker.branch, dirty: true }; };
  git.restoreWorker = async (worker, snapshot) => { calls.push(['restore', worker.id, snapshot.commit]); return snapshot.commit; };
  const checkpoint = await service.createCheckpoint('Before refactor');
  assert.equal(checkpoint.manager.lastTurnId, 'manager-turn');
  assert.equal(checkpoint.workers.w1.lastTurnId, 'worker-turn');
  assert.equal(service.state.activeCheckpointId, checkpoint.id);
  assert.deepEqual(await service.restoreCheckpoint(checkpoint.id, { files: true, conversation: false }), {
    checkpointId: checkpoint.id, restoredFiles: ['w1'], forkedConversations: []
  });
  assert.deepEqual(calls, [
    ['snapshot', 'w1', checkpoint.id],
    ['restore', 'w1', 'snapshot-commit']
  ]);
});
