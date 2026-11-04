import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS } from './tools.js';

export const DEFAULT_CONFIG = Object.freeze({
  manager: 'codex',
  worker: 'codex',
  managerModel: 'deepseek-flash',
  managerEffort: 'high',
  workerModel: 'deepseek-flash',
  workerEffort: 'high',
  managerPrompt: '',
  workerPrompt: '',
  codexApprovals: 'auto_review',
  maxWorkers: 4,
  silenceMs: 600_000,
  mouseSelection: 'native',
  showShortcutHints: true
});

export function validateConfig(config) {
  if (!PROVIDERS.includes(config.manager) || !PROVIDERS.includes(config.worker)) throw new Error('Unknown provider');
  for (const key of ['managerModel', 'managerEffort', 'workerModel', 'workerEffort']) {
    if (typeof config[key] !== 'string' || config[key].length > 200) throw new Error(`${key} must be a string up to 200 characters`);
  }
  for (const key of ['managerPrompt', 'workerPrompt']) {
    if (typeof config[key] !== 'string' || config[key].length > 50_000) throw new Error(`${key} must be a string up to 50000 characters`);
  }
  if (!['auto_review', 'user'].includes(config.codexApprovals)) throw new Error('Codex approvals must be auto_review or user');
  if (!Number.isInteger(config.maxWorkers) || config.maxWorkers < 1 || config.maxWorkers > 32) throw new Error('maxWorkers must be 1..32');
  if (!Number.isFinite(config.silenceMs) || config.silenceMs < 1000) throw new Error('Silence threshold must be at least one second');
  if (!['native', 'app'].includes(config.mouseSelection)) throw new Error('mouseSelection must be native or app');
  if (typeof config.showShortcutHints !== 'boolean') throw new Error('showShortcutHints must be a boolean');
  return config;
}

export function normalizeConfig(saved = {}, overrides = {}) {
  const silenceMs = overrides.silenceMinutes !== undefined
    ? Number(overrides.silenceMinutes) * 60_000
    : Number(overrides.silenceMs ?? saved.silenceMs ?? DEFAULT_CONFIG.silenceMs);
  return validateConfig({
    manager: overrides.manager ?? saved.manager ?? DEFAULT_CONFIG.manager,
    worker: overrides.worker ?? saved.worker ?? DEFAULT_CONFIG.worker,
    managerModel: overrides.managerModel ?? (saved.managerModel || DEFAULT_CONFIG.managerModel),
    managerEffort: overrides.managerEffort ?? (saved.managerEffort || DEFAULT_CONFIG.managerEffort),
    workerModel: overrides.workerModel ?? (saved.workerModel || DEFAULT_CONFIG.workerModel),
    workerEffort: overrides.workerEffort ?? (saved.workerEffort || DEFAULT_CONFIG.workerEffort),
    managerPrompt: overrides.managerPrompt ?? saved.managerPrompt ?? DEFAULT_CONFIG.managerPrompt,
    workerPrompt: overrides.workerPrompt ?? saved.workerPrompt ?? DEFAULT_CONFIG.workerPrompt,
    codexApprovals: overrides.codexApprovals ?? saved.codexApprovals ?? DEFAULT_CONFIG.codexApprovals,
    maxWorkers: Number(overrides.maxWorkers ?? saved.maxWorkers ?? DEFAULT_CONFIG.maxWorkers),
    silenceMs,
    mouseSelection: overrides.mouseSelection ?? saved.mouseSelection ?? DEFAULT_CONFIG.mouseSelection,
    showShortcutHints: overrides.showShortcutHints ?? saved.showShortcutHints ?? DEFAULT_CONFIG.showShortcutHints
  });
}

export async function loadConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveConfig(configPath, config) {
  validateConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return config;
}
