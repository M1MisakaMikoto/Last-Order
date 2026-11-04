// A surviving supervisor reaps the CLI tree when the TUI's IPC channel closes.
import { spawn } from 'node:child_process';
import { terminate } from '../src/core/process.js';
let child, stopping = false;
async function stop() { if (stopping) return; stopping = true; await terminate(child); process.exit(0); }
process.once('disconnect', stop);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
process.once('message', ({ executable, args }) => {
  if (stopping) return;
  child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.stdin.on('error', () => {});
  child.once('error', error => { process.stderr.write(error.message); process.exit(1); });
  child.once('exit', code => process.exit(code ?? 1));
});
