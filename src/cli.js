import { parseArgs } from 'node:util';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { GitWorkspace } from './core/git.js';
import { findCommand, capture, providerCommand } from './core/process.js';
import { PROVIDERS } from './core/tools.js';
import { loadConfig, normalizeConfig, saveConfig } from './core/config.js';
import { openWorkerMonitor } from './core/monitor.js';
import { attachOrStartMissionControl, ServiceClient } from './core/control-client.js';
import { discoverGitRepositories } from './core/projects.js';
import { MultiProjectService } from './core/multi-project-service.js';
import { TerminalUI } from './ui.js';

const help = `Last Order (lo) - coding-agent workspace

node bin/last-order.js --project PATH --manager codex --worker codex
node bin/last-order.js doctor

All sessions use the selected real CLI and its existing login/model configuration.
Providers: claude, codex, dsh (DeepSeek Harness), opencode
Options: --manager-model MODEL  --manager-effort LEVEL  --worker-model MODEL  --worker-effort LEVEL  --codex-approvals auto_review|user (default auto_review)  --message TEXT  --max-workers 4  --silence-minutes 10  --help
Commands inside TUI: /help, /settings, /reload, /monitor, /shutdown, /interrupt, /w, /pause, /resume, /cancel, /retry, /approve, /deny, /answer, /open, /diff, /quit
Use -A, -B, ... at the start of a message to target a discovered project.
Node.js 24+, an interactive terminal, and Git are required.`;

async function choose(label, fallback) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(label + ': ' + PROVIDERS.map((provider, index) => `${index + 1}) ${provider}`).join('  '));
    const answer = (await readline.question(`选择名称或编号 [${fallback}]: `)).trim();
    const selected = answer ? PROVIDERS[Number(answer) - 1] ?? answer : fallback;
    if (!PROVIDERS.includes(selected)) throw new Error('Unknown provider: ' + selected);
    return selected;
  } finally {
    readline.close();
  }
}

export async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' }, manager: { type: 'string' }, worker: { type: 'string' },
      'manager-model': { type: 'string' }, 'manager-effort': { type: 'string' },
      'worker-model': { type: 'string' }, 'worker-effort': { type: 'string' },
      'codex-approvals': { type: 'string' }, 'max-workers': { type: 'string' },
      'silence-minutes': { type: 'string' }, message: { type: 'string' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }
    }
  });
  if (values.help) { console.log(help); return; }
  if (values.version) { console.log('0.1.0'); return; }
  if (positionals[0] === 'doctor') {
    for (const provider of PROVIDERS) {
      const command = providerCommand(provider);
      if (!findCommand(command)) console.log(`${provider}: 未安装 / 未加入 PATH`);
      else {
        try { console.log(`${provider}: ${(await capture(command, ['--version'])).trim()}`); }
        catch (error) { console.log(`${provider}: 版本探测失败: ${error.message}`); }
      }
    }
    console.log('版本探测不表示已登录或已通过真实模型联调。');
    return;
  }
  if (positionals.length) throw new Error('Unknown command. Use --help');
  if (values['codex-approvals'] && !['auto_review', 'user'].includes(values['codex-approvals'])) throw new Error('--codex-approvals must be auto_review or user');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run in an interactive terminal. Native CLI approvals are handled in the TUI.');

  const workspace = path.resolve(values.project ?? '.');
  const repositories = await discoverGitRepositories(workspace);
  if (!repositories.length) throw new Error(`No Git repositories found under ${workspace}`);
  let firstProject = true;
  const hub = new MultiProjectService(repositories, async project => {
    const git = await GitWorkspace.open(project.root, { initializeEmpty: true });
    const configPath = path.join(git.directory, 'config.json');
    const saved = await loadConfig(configPath);
    const managerFallback = values.manager ?? saved.manager ?? (firstProject && repositories.length === 1 ? await choose('Manager 载体', 'codex') : 'codex');
    const workerFallback = values.worker ?? saved.worker ?? (firstProject && repositories.length === 1 ? await choose('默认 worker 载体', 'codex') : managerFallback);
    firstProject = false;
    const config = normalizeConfig(saved, {
      manager: managerFallback, worker: workerFallback,
      managerModel: values['manager-model'], managerEffort: values['manager-effort'],
      workerModel: values['worker-model'], workerEffort: values['worker-effort'],
      codexApprovals: values['codex-approvals'], maxWorkers: values['max-workers'],
      silenceMinutes: values['silence-minutes']
    });
    for (const provider of [config.manager, config.worker]) {
      if (!findCommand(providerCommand(provider))) throw new Error(`${provider} is not installed. Run node bin/last-order.js doctor and configure an installed provider.`);
    }
    await saveConfig(configPath, config);
    const info = await attachOrStartMissionControl(git.root, git.directory);
    const client = new ServiceClient(info);
    await client.start();
    project.saveSettings = next => saveConfig(configPath, next);
    project.git = git;
    return { client, dataDirectory: git.directory, configPath };
  });

  let ui, stopping, finishRun;
  const stopRuntime = async () => {
    if (stopping) return stopping;
    ui?.stop();
    stopping = hub.stop();
    await stopping;
    ui = undefined; stopping = undefined;
  };
  const requestStop = async reason => {
    if (!finishRun) return;
    const finish = finishRun; finishRun = undefined;
    await stopRuntime();
    finish(reason);
  };
  const onSignal = () => requestStop('quit').catch(error => { console.error(error.message); process.exitCode = 1; });
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    await hub.start();
    const run = new Promise(resolve => { finishRun = resolve; });
    hub.on('disconnect', () => { void requestStop('quit'); });
    ui = new TerminalUI(hub, {
      quit: () => requestStop('quit'),
      settings: hub.config,
      saveSettings: next => hub.saveSettings(next),
      openMonitor: worker => {
        const project = hub.activeProject;
        return openWorkerMonitor(worker, project.dataDirectory, project.root);
      },
      reload: async () => { await hub.shutdown().catch(() => {}); await requestStop('reload'); }
    });
    await ui.start();
    if (values.message) await hub.sendManagerMessage(values.message);
    const reason = await run;
    await stopRuntime();
    if (reason === 'reload') process.exitCode = 42;
  } finally {
    await stopRuntime();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
  }
}
