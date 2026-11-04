#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { capture } from '../src/core/process.js';
import { attachOrStartMissionControl, ServiceClient } from '../src/core/control-client.js';
import { saveConfig } from '../src/core/config.js';
import { TerminalUI } from '../src/ui.js';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    columns: { type: 'string', default: '100' },
    rows: { type: 'string', default: '30' }
  }
});
const project = path.resolve(values.project ?? '.');
const common = (await capture('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: project })).trim();
const dataDirectory = path.join(common, 'last-order');
const info = await attachOrStartMissionControl(project, dataDirectory);
const client = new ServiceClient(info);
await client.start();
let stopped = false;
let ui;

const cleanup = async () => {
  if (stopped) return;
  stopped = true;
  ui?.stop();
  client.stop();
};
const stop = async code => {
  await cleanup();
  process.exit(code);
};

client.on('disconnect', () => {
  process.send?.({ type: 'disconnected' });
  void stop(0);
});
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

ui = new TerminalUI(client, {
  virtualTerminal: true,
  virtualSize: { columns: Number(values.columns), rows: Number(values.rows) },
  settings: client.config,
  saveSettings: next => saveConfig(path.join(dataDirectory, 'config.json'), next),
  openMonitor: worker => process.send?.({ type: 'openMonitor', worker }),
  quit: () => void stop(0),
  reload: async () => {
    await client.shutdown().catch(() => {});
    process.send?.({ type: 'reload' });
    await stop(42);
  }
});
await ui.start();
process.send?.({ type: 'ready' });

const input = createInterface({ input: process.stdin });
input.on('line', line => {
  if (!line.trim() || stopped) return;
  try {
    const message = JSON.parse(line);
    if (message.type === 'input' && typeof message.data === 'string') ui.feed(message.data);
    if (message.type === 'resize') ui.resize(Number(message.columns), Number(message.rows));
    if (message.type === 'switchScreen') void ui.switchScreen();
    if (message.type === 'submitInput') void ui.submitInput();
    if (message.type === 'newlineInput') ui.insertNewline();
  } catch (error) {
    process.stderr.write('Invalid webview TUI message: ' + error.message + '\n');
  }
});
