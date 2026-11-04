#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { GitWorkspace } from '../src/core/git.js';
import { findCommand, providerCommand } from '../src/core/process.js';
import { loadConfig, normalizeConfig, saveConfig } from '../src/core/config.js';
import { MissionControlService } from '../src/core/service.js';
import { runtimeFactory } from '../src/adapters/index.js';
import { publishControlServer } from '../src/core/control-server.js';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    manager: { type: 'string' }, worker: { type: 'string' },
    'manager-model': { type: 'string' }, 'manager-effort': { type: 'string' },
    'worker-model': { type: 'string' }, 'worker-effort': { type: 'string' },
    'codex-approvals': { type: 'string' }, 'max-workers': { type: 'string' }, 'silence-minutes': { type: 'string' }
  }
});

const project = path.resolve(values.project ?? '.');
const git = await GitWorkspace.open(project, { initializeEmpty: true });
const configPath = path.join(git.directory, 'config.json');
const saved = await loadConfig(configPath);
const config = normalizeConfig(saved, {
  manager: values.manager, worker: values.worker,
  managerModel: values['manager-model'], managerEffort: values['manager-effort'],
  workerModel: values['worker-model'], workerEffort: values['worker-effort'],
  codexApprovals: values['codex-approvals'], maxWorkers: values['max-workers'],
  silenceMinutes: values['silence-minutes']
});
for (const provider of [config.manager, config.worker]) {
  if (!findCommand(providerCommand(provider))) {
    throw new Error(`${provider} is not installed. Run node bin/last-order.js doctor.`);
  }
}
await saveConfig(configPath, config);
const service = new MissionControlService(git, runtimeFactory, config);
await service.start();
let endpoint, stopping = false;

const cleanup = async () => {
  if (stopping) return;
  stopping = true;
  await endpoint?.close().catch(() => {});
  await service.stop().catch(() => {});
};
const shutdown = async () => { await cleanup(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('exit', () => { try { if (endpoint?.control_path) unlinkSync(endpoint.control_path); } catch {} });

endpoint = await publishControlServer(service, { onShutdown: shutdown });
console.log('MISSION_CONTROL_READY ' + JSON.stringify(endpoint));
