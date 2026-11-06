import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const distributionVersion = process.env.LAST_ORDER_DISTRIBUTION_VERSION?.trim();

export const APP_VERSION = distributionVersion || packageJson.version;
