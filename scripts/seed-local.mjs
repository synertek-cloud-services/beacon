import { createHash, randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');

const sql = `
INSERT OR IGNORE INTO tenants (id, name, auto_approve_default, privacy_mode_default, status, created_at)
VALUES ('ten_001', 'Synertek', 1, 0, 'active', unixepoch());

INSERT OR IGNORE INTO enrollment_tokens (id, tenant_id, token_hash, agent_type, use_count, created_at, created_by)
VALUES ('tok_001', 'ten_001', '${hash}', 'standard', 0, unixepoch(), 'seed');
`;

const sqlFile = '/tmp/beacon-seed.sql';
writeFileSync(sqlFile, sql);

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '../worker');
execSync(`npx wrangler d1 execute beacon --local --file=${sqlFile}`, {
  stdio: 'inherit',
  cwd: workerDir,
});

console.log('\n✓ Seeded local DB');
console.log(`\nEnrollment token (copy this):\n${token}`);
