import { createHash } from 'node:crypto';
import { realpathSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 200_000;
const MAX_LINES = 400;

function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g)) result[match[1]] = match[2];
  return result;
}

function languageFor(file, explicit) {
  if (explicit) return explicit;
  const extension = path.extname(file).slice(1);
  return ({ ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', md: 'md', py: 'py', ps1: 'powershell', sh: 'bash' })[extension] ?? extension ?? '';
}

export function expandIncludes(text, repositoryRoot) {
  const source = String(text ?? '');
  if (!source.includes('{{include')) return source;
  const root = realpathSync(repositoryRoot);
  return source.replace(/\{\{include\s+([^}]+)\}\}/g, (_directive, body) => {
    const options = attributes(body);
    if (!options.path) return '**Include error: missing path**';
    let file;
    try {
      const requested = path.resolve(root, options.path);
      file = realpathSync(requested);
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('path escapes project root');
      const stat = statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
      if (stat.size > MAX_BYTES) throw new Error(`file exceeds ${MAX_BYTES} bytes`);
    } catch (error) {
      return `**Include error: ${error.message}**`;
    }
    let content;
    try { content = readFileSync(file, 'utf8'); }
    catch (error) { return `**Include error: ${error.message}**`; }
    if (content.includes('\x00')) return '**Include error: binary file is not supported**';
    let start = 1, end = content.split(/\r?\n/).length;
    if (options.lines) {
      const range = /^(\d+)(?:-(\d+))?$/.exec(options.lines.trim());
      if (!range) return '**Include error: lines must be N or N-M**';
      start = Number(range[1]); end = Number(range[2] ?? range[1]);
      if (!start || end < start) return '**Include error: invalid line range**';
    }
    const allLines = content.replace(/\r\n?/g, '\n').split('\n');
    const selected = allLines.slice(start - 1, end);
    const truncated = selected.length > MAX_LINES;
    if (truncated) selected.length = MAX_LINES;
    const actualEnd = Math.min(end, start + selected.length - 1);
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    return [
      `\`${relative}:${start}-${actualEnd}\` · sha256:${hash}${truncated ? ' · truncated' : ''}`,
      '```' + languageFor(file, options.lang),
      ...selected,
      '```'
    ].join('\n');
  });
}
