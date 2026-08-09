import { decryptSecret } from './crypto';

// Bulk-fetches every targeted company's Variables/Secrets (both kinds),
// decrypting secrets once here rather than per-device/per-config, and keys
// the result by company_id -- a company variable applies identically to
// every device (or, for Credentialed Network Discovery, every scan) under
// that company, so this needs no further join at all. Same "fetch once per
// invocation, never per device" rule as fetchCustomFieldVars and the
// policy-targeting helpers in alerts.ts.
//
// Extracted out of worker/src/routes/admin/jobs.ts (its original, and
// still a, consumer) once worker/src/lib/discovery.ts became a second real
// consumer -- same reuse-not-duplicate move this codebase already makes
// elsewhere once a second consumer shows up (e.g. deviceMatchesPatchPolicy
// being reused by windowsUpdateManagement.ts/microsoftUpdateManagement.ts).
export async function fetchCompanyVariables(
  db: D1Database,
  configEncryptionKey: string,
  companyIds: string[],
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const uniqueIds = [...new Set(companyIds)];
  if (uniqueIds.length === 0) return out;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT company_id, key, is_secret, value, value_ciphertext, value_nonce
     FROM company_variables WHERE company_id IN (${placeholders})`
  ).bind(...uniqueIds).all<{
    company_id: string; key: string; is_secret: number;
    value: string | null; value_ciphertext: string | null; value_nonce: string | null;
  }>();

  for (const row of rows.results) {
    let value: string | null;
    if (row.is_secret) {
      if (!row.value_ciphertext || !row.value_nonce) continue;
      value = await decryptSecret(row.value_ciphertext, row.value_nonce, configEncryptionKey);
    } else {
      value = row.value;
    }
    if (value === null) continue;
    if (!out.has(row.company_id)) out.set(row.company_id, {});
    out.get(row.company_id)![`CV_${row.key}`] = value;
  }
  return out;
}
