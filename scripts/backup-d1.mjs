#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildClearSql, buildRestoreDataSql } from './lib/d1-restore.mjs';

const { values } = parseArgs({
  options: {
    database: { type: 'string', default: 'DB' },
    config: { type: 'string', default: 'worker/wrangler.toml' },
    output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help || !values.output) {
  console.log('Usage: node scripts/backup-d1.mjs --output <new-directory> [--database DB] [--config worker/wrangler.toml]');
  process.exit(values.help ? 0 : 1);
}

process.umask(0o077);
const root = resolve(import.meta.dirname, '..');
const workerDirectory = resolve(root, 'worker');
const config = resolve(root, values.config);
const output = resolve(values.output);
if (existsSync(output)) throw new Error(`refusing to overwrite existing backup directory: ${output}`);
mkdirSync(output, { recursive: true, mode: 0o700 });

const fullPath = resolve(output, 'd1-full.sql');
const dataPath = resolve(output, 'd1-data.sql');
function exportD1(path, extra = []) {
  try {
    execFileSync('pnpm', [
      'exec', 'wrangler', 'd1', 'export', values.database,
      '--remote', '--skip-confirmation', '--config', config,
      `--output=${path}`, ...extra,
    ], { cwd: workerDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('D1 export failed; Wrangler output was suppressed because it can contain a temporary signed download URL');
  }
  chmodSync(path, 0o600);
}

exportD1(fullPath);
exportD1(dataPath, ['--no-schema']);

const schemaSql = readFileSync(fullPath, 'utf8');
const dataSql = readFileSync(dataPath, 'utf8');
const clearPath = resolve(output, 'd1-clear.sql');
const restorePath = resolve(output, 'd1-restore-data.sql');
const prepared = buildRestoreDataSql(schemaSql, dataSql);
writeFileSync(clearPath, buildClearSql(schemaSql), { mode: 0o600, flag: 'wx' });
writeFileSync(restorePath, prepared.sql, { mode: 0o600, flag: 'wx' });

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let commit = null;
let workingTreeDirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
} catch {
  // A source archive may not include Git metadata; the operator can record its release separately.
}
const files = ['d1-full.sql', 'd1-data.sql', 'd1-clear.sql', 'd1-restore-data.sql'];
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({
  createdAt: new Date().toISOString(),
  database: values.database,
  sourceCommit: commit,
  sourceWorkingTreeDirty: workingTreeDirty,
  preparedTables: prepared.tableCount,
  splitOversizedRows: prepared.oversizedRows,
  files: Object.fromEntries(files.map(name => [name, { sha256: sha256(resolve(output, name)) }])),
}, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

console.log(`Created a restricted D1 backup in ${output}.`);
console.log(`Prepared ${prepared.tableCount} populated tables and split ${prepared.oversizedRows} oversized row(s) for restore.`);
