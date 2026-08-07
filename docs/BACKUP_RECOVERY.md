# Backup and recovery

This runbook covers Beacon's persistent state, a portable Cloudflare backup,
restoration into isolated resources, and recovery from failed application or
agent releases. Test it against disposable resources before relying on it for a
fleet.

## What must be protected

| State | Purpose | Recovery requirement |
|---|---|---|
| D1 database | Users, companies, device credential hashes, configuration, policies, jobs, alerts, audits, and agent release catalog | Export both schema/data and data-only forms. Keep the Beacon commit recorded by the backup. |
| Private R2 buckets | The active host-uploaded branding logo and Application Component files | Back up the logo object referenced by `branding_identity.logo_key` and every object in the private application-file bucket, including keys and content types. |
| `CONFIG_ENCRYPTION_KEY` | Decrypts SSO, email-provider, and company secrets stored in D1 | Preserve the exact value in an encrypted secret store. A replacement key cannot decrypt a restored database. |
| `ADMIN_SECRET` | Break-glass administration | Preserve it separately from routine user credentials. It can be rotated after normal admin access is recovered. |
| Agent signing private key | Signs releases accepted by deployed agents | Preserve the exact key. Losing it breaks automatic updates; a new key is not a recovery mechanism. |
| Deployment inventory | Worker/Pages names and origins, D1 ID/name, R2 bucket, Durable Object binding, cron, DNS, dashboard environment, GitHub Actions variables/secrets, and external IdP redirect URIs | Store an encrypted copy outside the Cloudflare account and repository. Secret values must come from the secret store because Cloudflare cannot reveal Worker secrets after upload. |

The `SessionRelay` Durable Object holds only live WebSocket connections and has
no durable storage. It is deliberately not backed up; active remote sessions
end during an outage and must be reopened.

Endpoint `credential.json` files remain on their individual devices. Do not
centralize their plaintext credentials in the host backup. Restoring D1 keeps
the matching hashes, so devices present at the snapshot can authenticate again.
Devices enrolled after the snapshot must be re-enrolled.

## Backup cadence and handling

- Take a D1 backup at least daily, before each production release, and before a
  risky operational change. Retain several generations outside the Cloudflare
  account.
- Back up R2 whenever the branding logo or an Application Component changes.
  The logo bucket needs only the active key referenced by D1; application files
  require a complete copy of the private application-file bucket.
- Update the encrypted deployment inventory whenever origins, bindings, DNS,
  Pages settings, GitHub Actions configuration, or IdP redirects change.
- Back up secrets and the agent signing key when created or rotated. Keep a
  tested offline copy under access controls appropriate for production keys.
- Treat every SQL export as sensitive. It contains password and device-token
  hashes, active session hashes, and encrypted configuration. `wrangler d1
  export` can also print a temporary signed download URL; do not send its output
  to shared CI logs.

## Create the portable backup

Run from a clean checkout of the repository revision currently deployed. The
output directory must not already exist:

```bash
node scripts/backup-d1.mjs \
  --database DB \
  --config worker/wrangler.toml \
  --output /secure/beacon-backups/2026-08-02T2300Z
```

The script suppresses Wrangler's potentially signed output, creates files with
restricted permissions, records SHA-256 checksums and the Git commit, and emits:

- `d1-full.sql`: the untouched full D1 export, retained as the authoritative
  portable snapshot.
- `d1-data.sql`: the untouched data-only export.
- `d1-clear.sql`: clears a migration-created target schema transactionally.
- `d1-restore-data.sql`: orders parent rows before child rows and splits large
  text values into import-safe updates.
- `manifest.json`: commit, checksums, and preparation counts.

The prepared files are necessary with the current Beacon schema. A live drill
found that Wrangler placed `devices` before its referenced tables, and emitted
a device-audit `INSERT` larger than D1 would accept on import. A raw export is
therefore not considered a tested backup until the prepared restore succeeds.

Query the active logo key without sharing the command output, then download that
exact private object and record its key, content type, and SHA-256 checksum next
to the D1 manifest. Set these variables to the values from the deployment and
query rather than typing the example text literally:

```bash
cd worker
pnpm exec wrangler d1 execute DB --remote --json \
  --command 'SELECT logo_key FROM branding_identity WHERE id = 1'
R2_BUCKET=beacon-logos
LOGO_KEY=00000000-0000-0000-0000-000000000000.svg
pnpm exec wrangler r2 object get "$R2_BUCKET/$LOGO_KEY" \
  --remote --file "/secure/beacon-backups/2026-08-02T2300Z/$LOGO_KEY"
```

If `logo_key` is `null`, there is no host-uploaded logo object to back up. Copy
the complete `COMPONENT_FILES` bucket with the R2 S3 API or `rclone`; its
object keys are referenced by `component_files.object_key` and must be restored
unchanged alongside D1.

Finally, copy the deployment inventory and encrypted secret/key backups into
the protected backup set. Verify every recorded checksum from a separate
machine or storage system.

## Restore into isolation

Never test a restore by overwriting production. Create a separate D1 database,
R2 bucket, Worker name/origin, and recovery Wrangler configuration. Do not add a
cron trigger or point production DNS at it yet.

1. Verify the backup checksums and check out `sourceCommit` from the manifest in
   a separate working tree. Install that revision's Worker dependencies.
2. Create the recovery D1/R2 resources and put their IDs/names in a separate
   Wrangler configuration with the same `DB`, `LOGOS`, `COMPONENT_FILES`, and
   `SESSION` bindings.
3. Create the matching schema, clear migration seed data, and import the
   prepared snapshot:

   ```bash
   cd worker
   pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.recovery.toml
   pnpm exec wrangler d1 execute DB --remote --config wrangler.recovery.toml \
     --file /secure/backup/d1-clear.sql
   pnpm exec wrangler d1 execute DB --remote --config wrangler.recovery.toml \
     --file /secure/backup/d1-restore-data.sql
   ```

4. Upload the logo under the same object key and content type:

   ```bash
   RECOVERY_BUCKET=beacon-recovery-logos
   LOGO_KEY=00000000-0000-0000-0000-000000000000.svg
   LOGO_CONTENT_TYPE=image/svg+xml
   pnpm exec wrangler r2 object put "$RECOVERY_BUCKET/$LOGO_KEY" \
     --remote --file "/secure/backup/$LOGO_KEY" --content-type "$LOGO_CONTENT_TYPE"
   ```

5. Deploy the recovery Worker and restore `ADMIN_SECRET` and the exact
   `CONFIG_ENCRYPTION_KEY` from the secret store. Keep its origin isolated from
   agents and users while validating it.
6. If recovering onto a newer Beacon revision, apply newer migrations only
   after the snapshot works at its recorded revision. Then deploy and validate
   each intervening supported release in order.

Before reconnecting endpoints, decide how to handle work that was queued at the
snapshot. A conservative disaster recovery treats old `queued`/`sent` commands
as expired and old active jobs as cancelled; otherwise an endpoint can repeat a
stale action when it reconnects. Make and audit that decision explicitly rather
than allowing restored work to replay accidentally.

## Acceptance checks before cutover

- `GET /health` returns `{"ok":true}`.
- A restored normal admin can sign in and `/v1/auth/me` resolves the expected
  identity and role; break-glass access also works.
- Companies, approved devices, policies, dashboards, and settings load.
- The branding identity's R2 object exists and matches its recorded checksum.
- Dispatching a disposable component to an isolated test device proves an
  encrypted company secret can still be decrypted. Never print the value.
- `PRAGMA foreign_key_check` returns no rows, and large audit/inventory records
  match the source snapshot.
- A device credential that existed at backup can check in against the recovery
  Worker. Do this only with a disposable endpoint or a direct, isolated request.
- The dashboard build points at the recovery Worker and loads without CORS
  errors. Remote-session URLs use the configured recovery `WORKER_URL`.
- Cron remains disabled until data review is complete. Re-enable `*/2 * * * *`
  only when the recovered instance is ready to become authoritative.

After acceptance, update the Worker/dashboard custom domains and DNS according
to the recorded inventory, deploy Pages, re-enable cron, and monitor check-ins,
alerts, and command queues. Re-enroll devices created after the snapshot.

## D1 Time Travel versus portable restore

D1 Time Travel is useful for a recent data incident in the existing database:

```bash
cd worker
pnpm exec wrangler d1 time-travel info DB
pnpm exec wrangler d1 time-travel restore DB --bookmark <confirmed-bookmark>
```

It is an in-place, destructive operation. Stop writes and cron, record the
current bookmark so the operation can be undone, verify the requested point,
and obtain explicit operational approval before restoring. Cloudflare retains
Time Travel history for a limited plan-dependent window, so it does not replace
portable, off-account backups.

## Failed production release

The release workflow runs migrations, Worker deployment, Pages deployment, and
health checking in order. Diagnose which boundary failed before acting:

| Failure point | State left behind | Recovery |
|---|---|---|
| Migration fails | Previous Worker and Pages remain deployed; the migration step stops the workflow | Correct the migration in a new PR and roll forward. Inspect D1 before retrying; do not assume a hand-written reverse migration is safe. |
| Worker deploy fails after migrations | D1 may be newer while the previous Worker/Pages remain | Prefer a compatible forward fix. Roll back Worker code only when the previous code is known to tolerate the new schema. |
| Pages deploy fails | New D1 and Worker may be live with the previous dashboard | Fix forward or select the prior successful production deployment in Cloudflare Pages and choose **Rollback**. Preview deployments cannot be used as production rollbacks. |
| Health check fails | All release steps may have completed | Inspect Worker logs and bindings. Roll back Worker/Pages only within their compatibility window; restore D1 separately if data itself was damaged. |

List Worker deployments and roll back code when schema compatibility is proven:

```bash
cd worker
pnpm exec wrangler deployments list
pnpm exec wrangler rollback <version-id> --message "incident reference"
```

A Worker rollback changes code and bindings associated with that version; it
does not reverse D1 migrations, D1 data, R2 objects, Pages, DNS, or external
configuration. Cloudflare retains only a limited deployment history, and some
binding or Durable Object lifecycle changes cannot be crossed by rollback.

## Failed agent release

During self-update, the agent keeps `<agent>.prev` and `update-state.json`. If
the replacement does not complete a successful check-in within ten minutes,
the updater automatically restores the previous binary. Check those files and
the agent log when diagnosing an endpoint.

If a bad build still checks in successfully, publish a corrected, higher
semantic version signed by the same host-controlled key. Do not replace assets
under an existing version or attempt to downgrade the release catalog. An
endpoint that cannot self-recover requires a manual reinstall; preserve its
credential file when appropriate or re-enroll it deliberately.

Worker rollback does not alter GitHub agent assets or the D1 agent-version
catalog. Treat the application release and endpoint binary release as separate
recovery decisions.

## Drill record

Record the backup timestamp/commit, resource names, checksums, operator, restore
duration, verification results, discovered defects, and cleanup. A backup is
not proven merely because export commands succeeded; repeat an isolated restore
drill after material schema/storage changes and at least once per release cycle.
