import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { capture, resolveCommand } from '../src/core/process.js';
import { temporary, cleanup } from './helpers.js';

test('guardian reaps the native CLI when the owning TUI process exits unexpectedly', async t => {
  const directory = await temporary('guardian-'), pidFile = path.join(directory, 'child.pid'); let pid;
  t.after(async () => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } await cleanup(directory); });
  await capture(process.execPath, [fileURLToPath(new URL('./fixtures/orphan-parent.js', import.meta.url)), pidFile]);
  pid = Number(await readFile(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; break; } await setTimeout(50); }
  assert.equal(alive, false, 'CLI must stop after its owner disappears'); pid = undefined;
});

test('Windows npm shims can launch native CLI executables without a shell', { skip: process.platform !== 'win32' }, async t => {
  const directory = await temporary('npm-shim-'); t.after(() => cleanup(directory));
  const bin = path.join(directory, 'node_modules', 'fixture', 'bin'); await mkdir(bin, { recursive: true });
  const target = path.join(bin, 'agent.exe'); await writeFile(target, 'resolution fixture only');
  const shim = path.join(directory, 'agent.cmd');
  await writeFile(shim, '@ECHO off\r\n"%dp0%\\node_modules\\fixture\\bin\\agent.exe" %*\r\n');
  const args = ['hello & echo untrusted'];
  assert.deepEqual(resolveCommand(shim, args), { executable: target, args });
});
