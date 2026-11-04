// Opt-in real model + native auto-review check in an isolated repository.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { GitWorkspace } from '../src/core/git.js';
import { CodexRuntime } from '../src/adapters/codex.js';

await mkdir('.tmp', { recursive: true });
const directory = await mkdtemp(path.resolve('.tmp/auto-review-'));
const git = await GitWorkspace.open(directory, { initializeEmpty: true }), original = await git.head();
const report = { project: directory, realModelCalls: true, manualApprovals: 0, reviews: [] };
let runtime, timeout;
try {
  runtime = await CodexRuntime.create({
    actor: 'worker-approval-probe', cwd: directory, tools: [],
    instructions: 'This is an authorized native approval integration test in a new isolated empty Git repository. Perform only the requested empty commit. Do not change files, permissions, policies, or configuration files. Do not use subagents.',
    emit: async event => {
      if (event.type === 'approval') { report.manualApprovals++; return false; }
      if (event.type === 'message') { report.reviews.push({ role: event.role ?? 'assistant', text: event.text }); console.log(event.text); }
    }
  }, process.env.LO_CODEX_COMMAND ?? 'codex');
  await Promise.race([
    runtime.run('Create exactly one empty Git commit with this command: git -c user.name=Last Order-Probe -c user.email=last-order-probe@example.invalid -c commit.gpgSign=false commit --allow-empty -m "Native auto-review probe". Git metadata is protected by the sandbox: request native escalation for this command with a short justification. Do not try to bypass approval, modify policy or run other commands. Then report whether the commit succeeded.'),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Native approval probe timed out')), 120_000); })
  ]);
  assert.notEqual(await git.head(), original, 'The real commit must be created');
  assert.equal(report.manualApprovals, 0);
  assert.ok(report.reviews.some(r => r.role === 'tool' && r.text.includes('Codex 自动审批通过')), 'A real native automatic review must approve the command');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  clearTimeout(timeout); await runtime?.stop();
  await writeFile(path.join(directory, 'approval-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, project: directory, manualApprovals: report.manualApprovals, error: report.error }));
}
