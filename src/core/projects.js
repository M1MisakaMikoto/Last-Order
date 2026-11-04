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

export async function discoverGitRepositories(root, { maxDepth = 3, limit = 100 } = {}) {
  const workspace = path.resolve(root);
  if (!(await isDirectory(workspace))) throw new Error(`Workspace is not a directory: ${workspace}`);
  const repositories = [];
  async function visit(directory, depth) {
    if (repositories.length >= limit) return;
    if (await isDirectory(path.join(directory, '.git'))) {
      repositories.push({ root: directory, name: path.basename(directory) });
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      await visit(path.join(directory, entry.name), depth + 1);
    }
  }
  await visit(workspace, 0);
  return repositories
    .sort((a, b) => a.root.localeCompare(b.root))
    .map((repository, index) => ({ ...repository, code: projectCode(index) }));
}
