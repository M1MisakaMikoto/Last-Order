import { spawn, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function findCommand(command) {
  const names = process.platform === 'win32' && !path.extname(command) ? [command + '.exe', command + '.cmd', command + '.bat', command] : [command];
  for (const directory of path.isAbsolute(command) ? [''] : (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of names) { const candidate = path.resolve(directory, name); if (existsSync(candidate)) return candidate; }
  }
  return null;
}

export function providerCommand(provider) {
  const key = provider.toUpperCase();
  return process.env['LO_' + key + '_COMMAND'] ?? provider;
}

export function resolveCommand(command, args) {
  let executable = findCommand(command);
  if (!executable) throw new Error(`CLI not installed or not in PATH: ${command}`);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const shim = readFileSync(executable, 'utf8');
    const targets = [...shim.matchAll(/"%~?dp0%?[\\/]([^"\r\n]+\.(?:[cm]?js|exe))"/gi)].map(match => match[1]);
    const target = targets.find(name => /\.[cm]?js$/i.test(name)) ?? targets.find(name => /\.exe$/i.test(name) && !/^node\.exe$/i.test(name));
    if (!target) throw new Error(`Cannot safely launch ${executable}. Configure a native executable or a Node CLI entry script.`);
    const entry = path.resolve(path.dirname(executable), target);
    if (!existsSync(entry)) throw new Error('Missing CLI entry script: ' + entry);
    if (/\.exe$/i.test(entry)) executable = entry;
    else { executable = process.execPath; args = [entry, ...args]; }
  } else if (/\.[cm]?js$/i.test(executable)) { args = [executable, ...args]; executable = process.execPath; }
  return { executable, args };
}

export function launch(command, args, options = {}) {
  const { executable, args: resolvedArgs } = resolveCommand(command, args); args = resolvedArgs;
  if (options.guard) {
    const env = { ...process.env, ...options.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(fileURLToPath(new URL('../../bin/guard.js', import.meta.url)), [], { cwd: options.cwd, env, execArgv: [], stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    child.saGuard = true;
    child.send({ executable, args }); return child;
  }
  return spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...options, shell: false });
}

const terminations = new WeakMap();
function waitExit(child, timeout = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); child.off('exit', ended); resolve(value); };
    const ended = () => done(true); const timer = setTimeout(() => done(false), timeout); child.once('exit', ended);
  });
}
export function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (terminations.has(child)) return terminations.get(child);
  const promise = (async () => {
    // Give the guardian time to reap its own CLI tree before killing the guardian.
    if (child.saGuard && child.connected) { child.disconnect(); if (await waitExit(child)) return; }
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
        killer.once('error', resolve); killer.once('exit', resolve);
      });
    }
    if (child.exitCode === null && child.signalCode === null) child.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
    if (!await waitExit(child)) throw new Error('Agent process did not stop: PID ' + child.pid);
  })();
  terminations.set(child, promise); return promise;
}

export function capture(command, args, options = {}) {
  if (/^git(?:\.exe)?$/i.test(path.basename(command)) && options.cwd) {
    const safe = `safe.directory=${path.resolve(options.cwd)}`;
    if (!args.some(arg => String(arg).startsWith('safe.directory='))) args = ['-c', safe, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = launch(command, args, options); let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; if (stdout.length > 8_000_000) { child.kill(); reject(new Error('Command output too large')); } });
    child.stderr.on('data', b => { stderr += b; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${command}: ${stderr.trim() || 'exit ' + code}`)));
  });
}
