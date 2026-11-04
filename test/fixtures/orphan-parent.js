import { launch } from '../../src/core/process.js';
import { fileURLToPath } from 'node:url';
const child = launch(process.execPath, [fileURLToPath(new URL('./idle-cli.js', import.meta.url)), process.argv[2]], { guard: true });
child.stdout.on('data', b => { if (String(b).includes('READY')) process.exit(0); });
child.once('error', () => process.exit(1));
