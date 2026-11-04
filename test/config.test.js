import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, normalizeConfig, saveConfig } from '../src/core/config.js';
import { temporary, cleanup } from './helpers.js';

test('project config normalizes startup overrides and persists canonical values', async t => {
  const directory = await temporary('config-');
  t.after(() => cleanup(directory));
  const file = path.join(directory, 'config.json');
  const config = normalizeConfig({}, {
    manager: 'claude',
    worker: 'codex',
    managerModel: 'gpt-5.1-codex',
    managerEffort: 'high',
    workerModel: 'gpt-5.1-codex-mini',
    workerEffort: 'medium',
    codexApprovals: 'user',
    maxWorkers: '6',
    silenceMinutes: '7'
  });
  assert.deepEqual(config, {
    manager: 'claude', worker: 'codex',
    managerModel: 'gpt-5.1-codex', managerEffort: 'high',
    workerModel: 'gpt-5.1-codex-mini', workerEffort: 'medium',
    managerPrompt: '', workerPrompt: '',
    codexApprovals: 'user', maxWorkers: 6, silenceMs: 420_000,
    mouseSelection: 'native', showShortcutHints: true
  });
  await saveConfig(file, config);
  assert.deepEqual(await loadConfig(file), config);
  assert.throws(() => normalizeConfig({}, { manager: 'unknown' }), /Unknown provider/);
  assert.throws(() => normalizeConfig({}, { silenceMinutes: '0' }), /at least one second/);
  assert.throws(() => normalizeConfig({}, { mouseSelection: 'bad' }), /native or app/);
  assert.throws(() => normalizeConfig({}, { showShortcutHints: 'yes' }), /boolean/);
  const defaults = normalizeConfig({});
  assert.equal(defaults.manager, 'codex');
  assert.equal(defaults.worker, 'codex');
  assert.equal(defaults.managerModel, 'deepseek-flash');
  assert.equal(defaults.workerModel, 'deepseek-flash');
  assert.equal(defaults.managerEffort, 'high');
  assert.equal(defaults.workerEffort, 'high');
});
