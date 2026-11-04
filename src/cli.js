import { parseArgs } from 'node:util';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { GitWorkspace } from './core/git.js';
import { findCommand, capture, providerCommand } from './core/process.js';
import { PROVIDERS } from './core/tools.js';
import { loadConfig, normalizeConfig, saveConfig } from './core/config.js';
import { openWorkerMonitor } from './core/monitor.js';
import { attachOrStartMissionControl, ServiceClient } from './core/control-client.js';
import { TerminalUI } from './ui.js';

const help = `Last Order (lo) — coding-agent workspace\n\nnode bin/last-order.js --project PATH --manager codex --worker codex\nnode bin/last-order.js doctor\n\nAll sessions use the selected real CLI and its existing login/model configuration.\nProviders: claude, codex, dsh (DeepSeek Harness), opencode\nOptions: --manager-model MODEL  --manager-effort LEVEL  --worker-model MODEL  --worker-effort LEVEL  --codex-approvals auto_review|user (default auto_review)  --message TEXT  --max-workers 4  --silence-minutes 10  --help\nCommands inside TUI: /help, /settings, /reload, /monitor, /shutdown, /interrupt, /w, /pause, /resume, /cancel, /retry, /approve, /deny, /answer, /open, /diff, /quit\nNode.js 24+, an interactive terminal, and Git are required. Empty project directories are initialized automatically; existing projects need an initial commit.\n`;
async function choose(label, fallback) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(label + ': ' + PROVIDERS.map((p, i) => `${i + 1}) ${p}`).join('  '));
    const answer = (await readline.question(`选择名称或编号 [${fallback}]: `)).trim();
    const selected = answer ? PROVIDERS[Number(answer) - 1] ?? answer : fallback;
    if (!PROVIDERS.includes(selected)) throw new Error('Unknown provider: ' + selected); return selected;
  } finally { readline.close(); }
}
export async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, manager: { type: 'string' }, worker: { type: 'string' }, 'manager-model': { type: 'string' }, 'manager-effort': { type: 'string' }, 'worker-model': { type: 'string' }, 'worker-effort': { type: 'string' }, 'codex-approvals': { type: 'string' }, 'max-workers': { type: 'string' }, 'silence-minutes': { type: 'string' }, message: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' } } });
  if (values.help) { console.log(help + 'Settings: /settings in the TUI; saved to the project config and applied on restart.'); return; }
  if (values.version) { console.log('0.1.0'); return; }
  if (positionals[0] === 'doctor') {
    for (const provider of PROVIDERS) {
      const command = providerCommand(provider);
      if (!findCommand(command)) console.log(`${provider}: 未安装 / 未加入 PATH`);
      else { try { console.log(`${provider}: ${(await capture(command, ['--version'])).trim()}`); } catch (e) { console.log(`${provider}: 版本探测失败: ${e.message}`); } }
    }
    console.log('版本探测不表示已登录或已通过真实模型联调。'); return;
  }
  if (positionals.length) throw new Error('Unknown command. Use --help');
  if (values['codex-approvals'] && !['auto_review', 'user'].includes(values['codex-approvals'])) throw new Error('--codex-approvals must be auto_review or user');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run in an interactive terminal. Native CLI approvals are handled in the TUI.');
  const git = await GitWorkspace.open(path.resolve(values.project ?? '.'), { initializeEmpty: true });
  const configPath = path.join(git.directory, 'config.json');
  let firstRun = true, message = values.message, service, ui, stopping, finishRun;
  const stopRuntime = async () => {
    if (stopping) return stopping;
    ui?.stop();
    stopping = service?.stop() ?? Promise.resolve();
    await stopping;
    ui = undefined; service = undefined; stopping = undefined;
  };
  const requestStop = async reason => {
    if (!finishRun) return;
    const finish = finishRun; finishRun = undefined;
    await stopRuntime();
    finish(reason);
  };
  const onSignal = () => requestStop('quit').catch(e => { console.error(e.message); process.exitCode = 1; });
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    while (true) {
      const saved = await loadConfig(configPath);
      const overrides = firstRun ? {
        manager: values.manager ?? saved.manager ?? await choose('Manager 载体', 'codex'),
        worker: values.worker ?? saved.worker ?? await choose('默认 worker 载体', 'codex'),
        managerModel: values['manager-model'],
        managerEffort: values['manager-effort'],
        workerModel: values['worker-model'],
        workerEffort: values['worker-effort'],
        codexApprovals: values['codex-approvals'],
        maxWorkers: values['max-workers'],
        silenceMinutes: values['silence-minutes']
      } : {};
      firstRun = false;
      const config = normalizeConfig(saved, overrides);
      for (const p of [config.manager, config.worker]) if (!findCommand(providerCommand(p))) throw new Error(`${p} is not installed. Run node bin/last-order.js doctor and configure an installed provider.`);
      await saveConfig(configPath, config);
      const info = await attachOrStartMissionControl(git.root, git.directory);
      service = new ServiceClient(info);
      await service.start();
      const run = new Promise(resolve => { finishRun = resolve; });
      service.on('disconnect', () => { void requestStop('quit'); });
      const reload = async () => {
        await service.shutdown().catch(() => {});
        await requestStop('reload');
      };
      ui = new TerminalUI(service, {
        quit: () => requestStop('quit'),
        settings: service.config,
        saveSettings: next => saveConfig(configPath, next),
        openMonitor: worker => openWorkerMonitor(worker, git.directory, git.root),
        reload
      });
      await ui.start();
      if (message) { await service.sendManagerMessage(message); message = undefined; }
      const reason = await run;
      await stopRuntime();
      if (reason !== 'reload') break;
      process.exitCode = 42;
      return;
    }
  } finally {
    await stopRuntime();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
  }
}
