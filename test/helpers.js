import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const tempRoot = fileURLToPath(new URL('../.tmp/', import.meta.url));
export async function temporary(prefix) { await mkdir(tempRoot, { recursive: true }); return mkdtemp(path.join(tempRoot, prefix)); }
export async function cleanup(directory) {
  const target = await realpath(directory), root = await realpath(tempRoot), relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe test cleanup path');
  for (let attempt = 0; ; attempt++) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
