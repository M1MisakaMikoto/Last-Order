import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(extensionRoot, '..');
const backend = path.join(extensionRoot, 'backend');
if (!backend.startsWith(extensionRoot + path.sep)) throw new Error('Unsafe backend path');

await rm(backend, { recursive: true, force: true });
await mkdir(backend, { recursive: true });
await cp(path.join(repositoryRoot, 'bin'), path.join(backend, 'bin'), { recursive: true });
await cp(path.join(repositoryRoot, 'src'), path.join(backend, 'src'), { recursive: true });
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
await writeFile(path.join(backend, 'package.json'), JSON.stringify({
  name: 'last-order-backend',
  version: packageJson.version,
  private: true,
  type: 'module',
  engines: packageJson.engines
}, null, 2));
