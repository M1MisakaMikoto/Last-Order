import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['.git', '.tmp', 'node_modules', 'vendor', 'coverage', 'dist', 'build', '.next', '.venv']);

export function projectCode(index) {
  let value = index + 1, code = '';
  while (value > 0) {
    value--;
    code = String.fromCharCode(65 + value % 26) + code;
    value = Math.floor(value / 26);
  }
  return code;
}

async function isDirectory(directory) {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

async function isGitRepository(directory) {
  return isDirectory(path.join(directory, '.git'));
}

export async function discoverGitRepositories(root, { limit = 100 } = {}) {
  const workspace = path.resolve(root);
  if (!(await isDirectory(workspace))) throw new Error(`Workspace is not a directory: ${workspace}`);
  const candidates = [];
  if (await isGitRepository(workspace)) {
    candidates.push(workspace);
  } else {
    let entries;
    try { entries = await readdir(workspace, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      const directory = path.join(workspace, entry.name);
      if (await isGitRepository(directory)) candidates.push(directory);
    }
  }
  return candidates
    .slice(0, limit)
    .map(directory => ({ root: directory, name: path.basename(directory) }))
    .sort((a, b) => a.root.localeCompare(b.root))
    .map((repository, index) => ({ ...repository, code: projectCode(index) }));
}
