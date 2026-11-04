import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { temporary, cleanup } from './helpers.js';

test('removed simulation flags fail before starting sessions or creating project data', async t => {
  const directory = await temporary('cli-removed-flags-'); t.after(() => cleanup(directory));
  const entry = fileURLToPath(new URL('../bin/last-order.js', import.meta.url));
  for (const flag of ['--demo', '--headless']) {
    const result = spawnSync(process.execPath, [entry, flag], { cwd: directory, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1); assert.match(result.stderr, /Unknown option/); assert.ok(result.stderr.includes(flag));
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(await readdir(directory), []);
});

test('Last Order command entrypoint is available', async () => {
  const entry = fileURLToPath(new URL('../bin/last-order.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('mission-control service entrypoint initializes an empty project', async t => {
  const directory = await temporary('service-empty-project-'); t.after(() => cleanup(directory));
  const entry = fileURLToPath(new URL('../bin/mission-control.js', import.meta.url));
  const child = spawn(process.execPath, [entry, '--project', directory], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const info = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('service startup timed out: ' + stderr)), 10_000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find(value => value.startsWith('MISSION_CONTROL_READY '));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line.slice('MISSION_CONTROL_READY '.length))); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`service exited ${code}: ${stderr}`)); });
  });
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service shutdown timed out: ' + stderr)), 10_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await fetch(info.url + '/shutdown', {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  await exited;
  assert.ok((await readdir(directory)).includes('.git'));
});

test('invalid Codex approval modes are rejected before project initialization', async t => {
  const directory = await temporary('cli-approval-mode-'); t.after(() => cleanup(directory));
  const entry = fileURLToPath(new URL('../bin/last-order.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry, '--project', directory, '--codex-approvals', 'always'], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1); assert.match(result.stderr, /--codex-approvals must be auto_review or user/);
  assert.deepEqual(await readdir(directory), []);
});
