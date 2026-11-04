#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.LAST_ORDER_SUPERVISED === '1') {
  try {
    const { main } = await import('../src/cli.js');
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  const entry = fileURLToPath(import.meta.url);
  const args = process.argv.slice(2);
  let child;
  const ignoreSignal = () => {};
  process.on('SIGINT', ignoreSignal);
  process.on('SIGTERM', ignoreSignal);
  const launch = () => {
    child = spawn(process.execPath, [entry, ...args], {
      stdio: 'inherit',
      windowsHide: false,
      env: { ...process.env, LAST_ORDER_SUPERVISED: '1' }
    });
    child.once('exit', (code, signal) => {
      if (code === 42) { launch(); return; }
      process.off('SIGINT', ignoreSignal);
      process.off('SIGTERM', ignoreSignal);
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  };
  process.on('exit', () => { if (child && child.exitCode === null) child.kill(); });
  launch();
}
