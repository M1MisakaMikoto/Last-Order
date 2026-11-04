import { homedir } from 'node:os';
import path from 'node:path';
import { access, readdir, readFile, realpath } from 'node:fs/promises';

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (field) metadata[field[1]] = field[2].replace(/^["']|["']$/g, '').trim();
  }
  return metadata;
}

async function scanRoot(root, scope) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    const skillPath = path.join(directory, 'SKILL.md');
    try {
      const canonical = await realpath(skillPath);
      const text = await readFile(canonical, 'utf8');
      const metadata = parseFrontmatter(text);
      if (!metadata.name || !metadata.description) continue;
      skills.push({
        name: metadata.name,
        description: metadata.description,
        path: canonical,
        scope,
        enabled: true
      });
    } catch {}
  }
  return skills;
}

function skillDirectories(repositoryRoot) {
  const home = homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  return [
    { directory: path.join(repositoryRoot, '.agents', 'skills'), scope: 'repo' },
    { directory: path.join(repositoryRoot, '.claude', 'skills'), scope: 'repo' },
    { directory: path.join(repositoryRoot, '.codex', 'skills'), scope: 'repo' },
    { directory: path.join(home, '.agents', 'skills'), scope: 'user' },
    { directory: path.join(home, '.claude', 'skills'), scope: 'user' },
    { directory: path.join(codexHome, 'skills'), scope: 'user' },
    { directory: path.join(codexHome, 'skills', '.system'), scope: 'system' }
  ];
}

export async function discoverSkills(repositoryRoot) {
  const seen = new Set(), skills = [];
  for (const root of skillDirectories(repositoryRoot)) {
    for (const skill of await scanRoot(root.directory, root.scope)) {
      const key = await realpath(skill.path).catch(() => skill.path);
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

export async function readSkill(skillPath) {
  const text = await readFile(skillPath, 'utf8');
  return text.slice(0, 100_000);
}

export function selectedSkillNames(text) {
  return [...new Set([...String(text).matchAll(/\$([a-zA-Z0-9][a-zA-Z0-9_-]*)/g)].map(match => match[1]))];
}
