// Opt-in real CLI integration. Uses an isolated Git project and real model calls.
import { parseArgs } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { capture } from '../src/core/process.js';
import { GitWorkspace } from '../src/core/git.js';
import { MissionControlService } from '../src/core/service.js';
import { runtimeFactory } from '../src/adapters/index.js';
import { PROVIDERS } from '../src/core/tools.js';

const { values } = parseArgs({ options: { provider: { type: 'string', default: 'codex' }, scenario: { type: 'string', default: 'greetings' }, 'timeout-ms': { type: 'string', default: '300000' }, 'resume-project': { type: 'string' }, 'approval-dir': { type: 'string' }, 'retry-failed': { type: 'boolean' } } });
if (!PROVIDERS.includes(values.provider) || !['greetings', 'task', 'full'].includes(values.scenario)) throw new Error('Use --provider codex|claude|dsh|opencode --scenario greetings|task|full');
const timeoutMs = Number(values['timeout-ms']);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('Invalid timeout');
await mkdir('.tmp', { recursive: true });
let runDirectory, directory;
if (values['resume-project']) {
  directory = await realpath(path.resolve(values['resume-project'])); const root = await realpath('.tmp');
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !(await readFile(path.join(directory, 'README.md'), 'utf8')).startsWith('# Isolated coding agent integration project')) throw new Error('Resume only supports this script’s isolated fixtures under .tmp');
  runDirectory = path.dirname(directory);
} else { runDirectory = await mkdtemp(path.resolve('.tmp', 'live-' + values.provider + '-')); directory = path.join(runDirectory, 'project'); await mkdir(directory); }
const run = args => capture('git', args, { cwd: directory });
if (!values['resume-project']) {
await run(['init', '-b', 'main']);
await run(['config', 'user.name', 'Last Order Integration']); await run(['config', 'user.email', 'integration@example.invalid']);
await writeFile(path.join(directory, 'README.md'), '# Isolated coding agent integration project\nOnly implement work explicitly requested by the user.\n');
await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2));
await run(['add', '.']); await run(['commit', '-m', 'Seed integration fixture']);
}
const git = await GitWorkspace.open(directory), originalHead = await git.head();
const report = { provider: values.provider, scenario: values.scenario, startedAt: new Date().toISOString(), project: directory, realModelCalls: true, cases: [], approvals: [] };
let service, input, approvalQueue = Promise.resolve(), finishing = false; const seenApprovals = new Set();
const approvalDirectory = values['approval-dir'] ? path.resolve(values['approval-dir']) : null;
if (approvalDirectory) await mkdir(approvalDirectory, { recursive: true });
function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    let elapsed = 0, checkedAt = Date.now();
    const finish = error => { clearInterval(timer); clearInterval(heartbeat); service.off('change', check); error ? reject(error) : resolve(); };
    const timer = setInterval(() => { const current = Date.now(); if (!service.approvals.size) elapsed += current - checkedAt; checkedAt = current; if (elapsed >= timeoutMs) finish(new Error(label + ' timed out')); }, 500);
    const heartbeat = setInterval(() => console.log(`[waiting] ${label}; manager=${service.managerBusy ? 'busy' : 'idle'} workers=${Object.values(service.state.workers).map(w => w.status).join(',') || '0'}`), 15_000);
    function check() { if (service.managerError) finish(new Error(service.managerError)); else { try { if (predicate()) finish(); } catch (e) { finish(e); } } }
    service.on('change', check); check();
  });
}
try {
  service = new MissionControlService(git, runtimeFactory, { manager: values.provider, worker: values.provider });
  service.on('change', event => {
    if (event?.type === 'message') console.log(`[${event.actor}/${event.data.role}] ${event.data.text.slice(0, 700)}`);
    if (event?.type === 'stage_failed') console.log('[stage_failed] ' + JSON.stringify(event.data));
    for (const approval of service.approvals.values()) {
      if (seenApprovals.has(approval.id)) continue; seenApprovals.add(approval.id);
      approvalQueue = approvalQueue.then(async () => {
        console.log('\nNATIVE APPROVAL (isolated test, user decision required)\n' + JSON.stringify({ id: approval.id, actor: approval.actor, detail: approval.detail }, null, 2));
        let allowed;
        if (approvalDirectory) {
          await writeFile(path.join(approvalDirectory, approval.id + '.json'), JSON.stringify({ id: approval.id, actor: approval.actor, project: directory, detail: approval.detail }, null, 2));
          allowed = await new Promise((resolve, reject) => {
            const timer = setInterval(async () => {
              if (finishing || !service.approvals.has(approval.id)) { clearInterval(timer); resolve(false); return; }
              try { const response = JSON.parse(await readFile(path.join(approvalDirectory, approval.id + '.response.json'), 'utf8')); if (typeof response.allowed !== 'boolean') throw new Error('Approval response must contain boolean allowed'); clearInterval(timer); resolve(response.allowed); }
              catch (error) { if (error.code !== 'ENOENT') { clearInterval(timer); reject(error); } }
            }, 250);
          });
        } else {
          input ??= createInterface({ input: process.stdin, output: process.stdout });
          allowed = /^y(es)?$/i.test((await input.question('Approve once? [y/N] ')).trim());
        }
        report.approvals.push({ id: approval.id, actor: approval.actor, allowed });
        if (service.approvals.has(approval.id)) service.respondApproval(approval.id, allowed);
      }).catch(error => { console.error('Approval response failed: ' + error.message); });
    }
  });
  await service.start(); console.log('REAL integration project: ' + directory);
  if (values.scenario !== 'task') {
    for (const message of ['hello', '你好', '谢谢', '先聊一下，你能帮我做什么？', '先别执行，我们只讨论一下怎么安排任务。']) {
      console.log('\nCASE conversation: ' + message);
      const baseline = Object.keys(service.state.workers).length;
      const lastSeq = service.store.history('manager', 1)[0]?.seq ?? 0;
      await service.sendManagerMessage(message);
      await waitFor(() => !service.managerBusy && service.state.manager.pending.length === 0, 'manager conversation');
      const responses = service.store.history('manager').filter(e => e.seq > lastSeq && e.type === 'message' && e.data.role === 'assistant').map(e => e.data.text);
      assert.ok(responses.length, 'Manager must actually reply');
      assert.equal(Object.keys(service.state.workers).length, baseline, 'Conversation must not start workers');
      assert.equal(Object.keys(service.state.pipelines).length, 0, 'Conversation must not register a pipeline');
      const toolCalls = service.store.history('manager').filter(e => e.seq > lastSeq && e.type === 'message' && e.data.role === 'tool');
      assert.equal(toolCalls.length, 0, 'Conversation must not perform unnecessary tool calls');
      assert.equal(await git.head(), originalHead, 'Conversation must not change the original branch');
      report.cases.push({ input: message, status: 'passed', newWorkers: 0, newPipelines: 0, toolCalls: toolCalls.length, replies: responses });
    }
  }
  if (values.scenario !== 'greetings') {
    const message = 'hello，帮我完成一个实际代码任务：在当前测试仓库新增 src/sum.js，实现 export function sum(values)。空数组返回 0；仅接受有限数值组成的数组；其他输入抛出 TypeError；不能修改输入数组。添加 node:test 测试。实现和对抗性验收分给不同 worker，manager 只负责调度；验收 worker 不得修改实现代码。请实际实现并验证，交付到本次需求分支，不合入 main。';
    console.log('\nCASE actual coding task with a greeting prefix');
    if (values['retry-failed']) for (const p of Object.values(service.state.pipelines)) {
      if (['failed', 'review_failed', 'blocked_technical'].includes(p.status)) await service.controlWorker(p.stages[p.index].workerId, 'resume', 'Integration controller resumed current stage after validation correction. New acceptance tests are allowed; implementation remains unchanged.', 'user');
    }
    if (!values['resume-project'] || !Object.keys(service.state.pipelines).length) await service.sendManagerMessage(message);
    await waitFor(() => Object.values(service.state.pipelines).some(p => p.status === 'succeeded') && !service.managerBusy && service.state.manager.pending.length === 0 && service.state.notifications.length === 0, 'coding pipeline');
    const pipelines = Object.values(service.state.pipelines), workers = Object.values(service.state.workers);
    assert.ok(workers.some(w => w.kind === 'implement') && workers.some(w => w.kind === 'review'), 'Real implementation and review must both run');
    assert.equal(await git.head(), originalHead, 'Delivery must not merge into main');
    const delivered = Object.values(service.state.requests).find(r => r.deliveryCommit);
    assert.ok(delivered, 'A committed delivery is required');
    const source = await git.git(['show', delivered.deliveryCommit + ':src/sum.js']);
    const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    assert.equal(module.sum([]), 0); assert.equal(module.sum([1, 2, 3]), 6); assert.equal(module.sum([-2, 0.5]), -1.5);
    for (const bad of [null, 1, '12', [1, '2'], [NaN], [Infinity], [-Infinity]]) assert.throws(() => module.sum(bad), TypeError);
    const original = Object.freeze([1, 2]); assert.equal(module.sum(original), 3);
    report.cases.push({ input: message, status: 'passed', pipelineCount: pipelines.length, workerCount: workers.length, stages: workers.map(w => ({ kind: w.kind, status: w.status })), deliveredBranch: delivered.deliveryBranch, commit: delivered.deliveryCommit, externalAssertions: 'passed' });
    const counts = { workers: workers.length, pipelines: pipelines.length };
    const beforeThanks = service.store.history('manager', 1)[0]?.seq ?? 0;
    await service.sendManagerMessage('谢谢，先这样，暂时没有新任务。');
    await waitFor(() => !service.managerBusy && !service.state.manager.pending.length && !service.state.notifications.length, 'conversation after completed task');
    assert.equal(Object.keys(service.state.workers).length, counts.workers); assert.equal(Object.keys(service.state.pipelines).length, counts.pipelines);
    const thanksReplies = service.store.history('manager').filter(e => e.seq > beforeThanks && e.type === 'message' && e.data.role === 'assistant').map(e => e.data.text);
    assert.ok(thanksReplies.length, 'Manager must reply to the conversation after delivery');
    report.cases.push({ input: '谢谢，先这样，暂时没有新任务。', status: 'passed', newWorkers: 0, newPipelines: 0, replies: thanksReplies });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  console.error('INTEGRATION FAILED: ' + error.message); process.exitCode = 1;
} finally {
  finishing = true; input?.close(); await service?.stop();
  report.finishedAt = new Date().toISOString();
  if (service) { report.workerCount = Object.keys(service.state.workers).length; report.pipelineCount = Object.keys(service.state.pipelines).length; }
  const reportPath = path.join(runDirectory, 'report.json'); await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log('REPORT ' + reportPath);
}
