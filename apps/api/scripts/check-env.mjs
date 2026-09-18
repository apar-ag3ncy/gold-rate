// Fails fast with a readable list of problems. Usage: node apps/api/scripts/check-env.mjs [path/to/.env]
// Run automatically by `npm start` in the API and worker; also handy before a deploy.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const envPath = resolve(process.argv[2] ?? '.env');
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
  process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
try {
  const { loadConfig } = await import('../src/config.ts');
  const cfg = loadConfig();
  console.log(`env OK · NODE_ENV=${cfg.NODE_ENV} DRY_RUN=${cfg.DRY_RUN} storage=${cfg.STORAGE_DRIVER} graph=${cfg.META_GRAPH_VERSION}`);
} catch (e) { console.error(`\nENV CHECK FAILED\n${e.message}\n`); process.exit(1); }
