import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) await check(name);
    else if (name.endsWith('.js')) { const result = spawnSync(process.execPath, ['--check', name], { stdio: 'inherit', windowsHide: true }); if (result.status !== 0) process.exitCode = 1; }
  }
}
for (const directory of ['src', 'bin', 'scripts', 'test']) await check(directory);
