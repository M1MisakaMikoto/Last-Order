#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { GitWorkspace } from '../src/core/git.js';
import { attachOrStartMissionControl, ServiceClient } from '../src/core/control-client.js';
import { loadConfig, normalizeConfig, saveConfig } from '../src/core/config.js';
import { discoverGitRepositories } from '../src/core/projects.js';
import { MultiProjectService } from '../src/core/multi-project-service.js';
import { TerminalUI } from '../src/ui.js';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    columns: { type: 'string', default: '100' },
    rows: { type: 'string', default: '30' }
  }
});
const workspace = path.resolve(values.project ?? '.');
const repositories = await discoverGitRepositories(workspace);
if (!repositories.length) throw new Error(`No Git repositories found under ${workspace}`);

const hub = new MultiProjectService(repositories, async project => {
  const git = await GitWorkspace.open(project.root, { initializeEmpty: true });
  const configPath = path.join(git.directory, 'config.json');
  const saved = await loadConfig(configPath);
  const config = normalizeConfig(saved, {});
  await saveConfig(configPath, config);
  const info = await attachOrStartMissionControl(git.root, git.directory);
  const client = new ServiceClient(info);
  await client.start();
  project.saveSettings = next => saveConfig(configPath, next);
  return { client, dataDirectory: git.directory, configPath };
});
await hub.start();

let stopped = false;
let ui;
const cleanup = async () => {
  if (stopped) return;
  stopped = true;
  ui?.stop();
  await hub.stop();
};
const stop = async code => {
  await cleanup();
  process.exit(code);
};

hub.on('disconnect', () => {
  process.send?.({ type: 'disconnected' });
  void stop(0);
});
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

ui = new TerminalUI(hub, {
  virtualTerminal: true,
  virtualSize: { columns: Number(values.columns), rows: Number(values.rows) },
  settings: hub.config,
  saveSettings: next => hub.saveSettings(next),
  openMonitor: worker => process.send?.({
    type: 'openMonitor', worker,
    project: hub.activeProject.root, dataDirectory: hub.activeProject.dataDirectory
  }),
  quit: () => void stop(0),
  reload: async () => {
    await hub.shutdown().catch(() => {});
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
