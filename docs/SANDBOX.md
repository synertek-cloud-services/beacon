# Persistent test sandbox

A standing Beacon deployment for real end-to-end testing (agent
install/enrollment, check-in, commands, Web Remote session behavior, etc.)
without provisioning and tearing down a throwaway Worker/D1/R2 stack every
time. Shared by both Claude and Codex sessions working in this repo — see
`CLAUDE.md`/`AGENTS.md`.

**Not production, not a customer deployment, not part of Spirewick.** It lives
in the same Cloudflare account as Synertek's production Beacon (account
`8fefd04d62780c1624579795cb08f891` — note this is a *different* account than
whatever `CLOUDFLARE_ACCOUNT_ID` a shell's `.envrc` may export; pass it
explicitly or `export CLOUDFLARE_ACCOUNT_ID=8fefd04d62780c1624579795cb08f891`
before any `wrangler`/API call against the sandbox, or you'll get a
same-looking-but-wrong "Authentication error" from a token that's simply
scoped to a different account than the env var assumes).

## Why this exists

Cloudflare (Workers/D1/R2) bills per-request/row/storage, not per-uptime — an
idle deployed Worker with an idle D1/R2 costs effectively nothing. There is no
reason to create and destroy this stack per test run; only genuinely
hourly-billed infrastructure (a Vultr VM, for instance) needs prompt teardown
after use. Keep this sandbox running indefinitely and just reuse it.

## What's deployed

| Resource | Name |
|---|---|
| Worker | `beacon-sandbox` — `https://beacon-sandbox.synertekcs.workers.dev` |
| D1 database | `beacon-sandbox` (id `2ca03fbc-17af-4494-a643-a1570cf02d44`) |
| R2 buckets | `beacon-sandbox-logos`, `beacon-sandbox-component-files`, `beacon-sandbox-session-files` |
| Durable Object | `SessionRelay` (binding `SESSION`) |
| Config | `worker/wrangler.sandbox.toml` (tracked — non-secret, real IDs; this isn't production so there's nothing sensitive in it) |
| Cron | `*/2 * * * *`, same as production |

Migrations are kept current the same way production's are — after adding a
new migration file, also apply it here:

```bash
cd worker
export CLOUDFLARE_ACCOUNT_ID=8fefd04d62780c1624579795cb08f891
npx wrangler d1 migrations apply beacon-sandbox --remote -c wrangler.sandbox.toml
```

To redeploy the Worker itself after a code change you want to test against
real infrastructure (not just `wrangler dev`):

```bash
cd worker
export CLOUDFLARE_ACCOUNT_ID=8fefd04d62780c1624579795cb08f891
npx wrangler deploy -c wrangler.sandbox.toml
```

## Secrets and credentials

Held at `~/.beacon-sandbox-secrets` (outside both repos, gitignored by
definition since it's not inside either repo, mode `0600`) as shell
`KEY=value` lines — same convention as `~/.vultr_api_key`:

```
BEACON_SANDBOX_ADMIN_SECRET=<break-glass admin bearer token>
BEACON_SANDBOX_CONFIG_ENCRYPTION_KEY=<AES-GCM key for SSO/email secrets at rest>
BEACON_SANDBOX_COMPANY_ID=<id of the standing "Sandbox Test Company">
BEACON_SANDBOX_ENROLL_TOKEN=<raw enrollment token — unlimited uses, auto-approve, never expires>
```

Source it before making authenticated calls:

```bash
source ~/.beacon-sandbox-secrets
curl -H "Authorization: Bearer $BEACON_SANDBOX_ADMIN_SECRET" https://beacon-sandbox.synertekcs.workers.dev/v1/admin/devices
```

These secrets are specific to this sandbox and are never reused from/for
production. If they're ever regenerated, this file is the single place to
update — nothing else derives them independently.

## Enrolling a test agent

A standing company ("Sandbox Test Company", `auto_approve_default: true`)
and a reusable enrollment token (unlimited uses, `auto_approve: true`, never
expires) already exist — see `BEACON_SANDBOX_COMPANY_ID`/
`BEACON_SANDBOX_ENROLL_TOKEN` above. Don't create a new company/token per
test; reuse these unless a test specifically needs isolated company-level
config (patch exclusion, RustDesk toggle, etc.), in which case create a
second company the same way (`POST /v1/admin/companies`) rather than mutating
the standing one.

Build and install an agent pointed at the sandbox:

```bash
make build-agent-windows   # or build-agent-linux / build-agent-darwin
```

```powershell
# on the test VM
Invoke-WebRequest -Uri "https://beacon-sandbox.synertekcs.workers.dev/v1/branding/logo/agent-windows-amd64.exe" -OutFile "C:\agent.exe"
C:\agent.exe install --server-url "https://beacon-sandbox.synertekcs.workers.dev" --enroll-token "<BEACON_SANDBOX_ENROLL_TOKEN>"
```

The `/v1/branding/logo/<key>` route is repurposed here purely as a convenient
public binary host — it streams whatever object exists at that R2 key with no
dependency on `branding_identity`'s actual configured logo. Re-upload after
every agent code change you want to test against real hardware:

```bash
cd worker
export CLOUDFLARE_ACCOUNT_ID=8fefd04d62780c1624579795cb08f891
npx wrangler r2 object put beacon-sandbox-logos/agent-windows-amd64.exe \
  --file ../dist/agent-windows-amd64.exe --content-type application/octet-stream --remote
```

(Swap the filename/key for `agent-linux-amd64`/`agent-darwin-arm64` as needed
— nothing reserves this bucket for Windows only, it's just what's been used
so far.)

## Real-hardware VM testing notes

For provisioning a real Windows/Linux test VM to enroll against this sandbox
(e.g. on Vultr — see `~/.vultr_api_key`), a few things learned the hard way
during the first real-hardware pass (PR #214, 2026-09-13):

- Vultr Windows Server images have **no Cloudbase-Init** — the "Startup
  Script" API feature silently never executes anything there. Don't rely on
  unattended provisioning; RDP in and run the install command by hand.
- If running under WSL with WSLg, an `xfreerdp` window opened here actually
  renders on the real Windows desktop — but the native Windows RDP client is
  a better experience for genuinely manual/interactive work. Get the VM's
  IP/password and just RDP in directly rather than scripting `xfreerdp`.
- Only the VM itself bills hourly and needs prompt teardown after a test.
  This sandbox does not.

## Tearing down (only if this whole sandbox is genuinely no longer wanted)

This should be rare — the entire point is to not do this per test run.

```bash
cd worker
export CLOUDFLARE_ACCOUNT_ID=8fefd04d62780c1624579795cb08f891
npx wrangler delete -c wrangler.sandbox.toml
npx wrangler d1 delete beacon-sandbox --remote -y
npx wrangler r2 bucket delete beacon-sandbox-logos
npx wrangler r2 bucket delete beacon-sandbox-component-files
npx wrangler r2 bucket delete beacon-sandbox-session-files
rm ~/.beacon-sandbox-secrets
```

Also delete `worker/wrangler.sandbox.toml` and this file if the sandbox is
being retired rather than just reset.
