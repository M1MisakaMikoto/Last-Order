import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], String(process.pid));
process.stdout.write('READY\n');
setInterval(() => {}, 1000);
