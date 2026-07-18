# Beacon — CLAUDE.md

Self-hosted RMM platform, originally built for Synertek Cloud Services (developed by CodeNexus), now open-sourced under AGPL-3.0. Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard. See `README.md` for the human-facing overview and self-hosting quick start — this file is the AI-assistant-facing architecture/convention reference.

For current session-by-session status, recent decisions, and open follow-ups, see `PROJECT_LOG.md`.

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations (0000 … 0028)
scripts/      Utility scripts
Makefile      Top-level task runner
LICENSE       AGPL-3.0
README.md     Human-facing overview + self-hosting quick start
```

## Commands

### Worker (Cloudflare Worker)
```bash
make dev              # wrangler dev (local)
make deploy           # wrangler deploy (production)
make migrate-local    # apply pending migrations to local D1
make migrate-remote   # apply pending migrations to production D1
make db-generate      # regenerate Drizzle schema types
make type-check       # tsc --noEmit
```

### Dashboard (Vue 3 / Vite)
```bash
cd dashboard
pnpm dev              # local dev server on :5173
pnpm run build        # type-check + vite build
```
CI/CD: Cloudflare Pages auto-deploys on push to main when `dashboard/*` changes.
Root dir: `dashboard`, build command: `pnpm run build`, output: `dist`.

**Local full-stack testing gotchas** (hit repeatedly enough to be worth writing down):
- `dashboard/vite.config.ts` already proxies `/v1` → `http://localhost:8787` — for local `pnpm dev` + `wrangler dev` testing, **don't** set `VITE_API_URL` at all (leave it unset so `api.ts`'s `baseUrl` stays `''`/relative). Setting it to `http://localhost:8787` directly makes the browser issue real cross-origin fetches, which the worker's CORS allowlist (hardcoded to exactly `http://localhost:5173`, see CORS below) will reject for any other local port — a real dead end hit while testing the Job scheduling work, cost real time before realizing the proxy already existed and made the override actively harmful.
- To manually fire the cron locally (needed to test anything in `scheduled()`, e.g. `dispatchDueScheduledJobs`/offline alerts): `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` against a plain `wrangler dev` — no `--test-scheduled` flag needed, that flag only changes the startup banner's messaging, not whether the endpoint exists.
- A backgrounded `wrangler dev` from an earlier session can be left listening on 8787 while completely hung (accepts the TCP connection, never responds — `ss -ltnp` shows it bound, but every request times out). Symptom looks like "the port is busy" (a fresh `wrangler dev` fails to bind) rather than "nothing's listening" (`curl` would connection-refuse, not time out) — check `ss -ltnp | grep 8787` and kill the stale `workerd`/`wrangler` process tree before assuming something's wrong with a new change.

### Agent (Go)
```bash
make build-agent-windows   # dist/agent-windows-amd64.exe
make build-agent-linux     # dist/agent-linux-amd64
make build-agent-darwin    # dist/agent-darwin-arm64
# or from agent/:
go build ./...
```

## Secrets — never commit these

| Secret | Where it lives |
|---|---|
| `ADMIN_SECRET` | `worker/.dev.vars` (gitignored) |
| `CONFIG_ENCRYPTION_KEY` | `worker/.dev.vars` (gitignored) — AES-GCM key (hex) encrypting SSO provider client secrets at rest |
| `CLOUDFLARE_API_TOKEN` | direnv `.envrc` (gitignored) |
| Ed25519 private key (agent signing) | Password manager only |

`worker/.dev.vars` already has `ADMIN_SECRET="beacon-local-admin-secret"`, a `CONFIG_ENCRYPTION_KEY`, and `WORKER_URL="http://localhost:8787"` for local dev.

`ADMIN_SECRET` is compared via `worker/src/lib/auth.ts`'s `requireAdmin`/`timingSafeEqual` (hash-then-compare, not `===`) — now only reachable through `requireUser` (see Auth System below) as the break-glass fallback path. Never add a new inline `auth === \`Bearer ${secret}\`` check or a second hand-rolled admin check; every route goes through `requireUser`.

## Self-hosting config (not secrets, but org-specific — gitignored with `.example` templates)

`worker/wrangler.toml` and `dashboard/.env.production` are gitignored (real values are Synertek's own domain/D1 database, not committed for a public repo). Tracked `.example` counterparts (`worker/wrangler.toml.example`, `dashboard/.env.production.example`) hold placeholder values — anyone self-hosting copies the `.example` file and fills in their own domain/database ID. `worker/wrangler.toml`'s `[vars]` block (`ALLOWED_ORIGIN`, `PAGES_PREVIEW_SUFFIX`) drives the CORS allowlist in `worker/src/index.ts` — don't hardcode a domain back into `index.ts`. `[vars]` also holds `WORKER_URL` (this worker's own public origin) — used by `sessions.ts` to build absolute agent/client WebSocket URLs. Deliberately a configured value rather than derived from the incoming request's own URL: with a `[[routes]]` custom-domain block present (as production's is), `c.req.url` reflects the production route even under `wrangler dev`, which previously caused local-dev remote-shell sessions to silently dial out to the real production worker instead of the local one — found and fixed during the Remote Shell session below.

## Production URLs

| Service | URL |
|---|---|
| Worker API | `https://rmm-api.cloud.synertekcs.com` |
| Dashboard | `https://rmm.cloud.synertekcs.com` |
| Pages previews | `*.beacon-dashboard-6f4.pages.dev` |

## Architecture

**Worker** (`worker/src/`)
- Framework: Hono on Cloudflare Workers
- Database: Cloudflare D1 (SQLite) via Drizzle ORM (`worker/src/db/schema.ts`)
- Cron: runs every 2 minutes (`*/2 * * * *`) — evaluates offline alerts
- Durable Object: `SessionRelay` for shell/TCP tunnel sessions — see "Remote Shell / session system" below
- All admin routes under `/v1/admin/*`, `/v1/auth/*`, and `/v1/sessions*` require `Authorization: Bearer <token>` — either a real user session token or the `ADMIN_SECRET` break-glass token, resolved by `requireUser` (see Auth System below)
- CORS allows: production domain, localhost:5173, `*.beacon-dashboard-6f4.pages.dev` — must be explicitly enabled per route prefix (`app.use('/prefix/*', corsMiddleware)` in `index.ts`); `/v1/sessions` was missing from this list entirely until this session, since nothing had ever called it from a browser before

**Agent** (`agent/`)
- Module: `github.com/synertek-cloud-services/beacon/agent` (matches the GitHub org this repo is published under)
- Check-in interval: 60 seconds
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, disks[] (multi-drive), cpu_percent, memory_percent, detected_class, av_status, av_product
- Check-in request also carries `pending_{file_size,ping,process,service}_results`; response carries `{file_size,ping,process,service}_checks` — see "Assign → measure → report pattern" below
- Audit (full inventory snapshot) fires 5 min after startup, then every 24 h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them)
- Internal packages worth knowing: `diskutil` (shared multi-drive enumeration between check-in and audit), `filesize`, `pingutil`, `procutil`, `svcutil` — each is a small `Find`/`Measure`/`Ping` function following the same shell-out-or-gopsutil convention as the older `audit` package's AV/BIOS collectors
- `agent/internal/audit/hardware.go`'s `collectBIOS{Linux,Windows,Darwin}()` also collect `BIOSInfo.serial_number` now (DMI `/sys/class/dmi/id/product_serial` on Linux — root-only permission, silently empty if the agent isn't running as root; WMI `Win32_BIOS.SerialNumber` on Windows; `system_profiler SPHardwareDataType`'s "Serial Number (system)" line on macOS), and `collectHardware()` also sets `HardwareInfo.last_logged_in_user` via `collectLastLoggedInUser()` (gopsutil `host.Users()` on Linux/Darwin — picks the most-recently-started session; WMI `Win32_ComputerSystem.UserName` on Windows, since gopsutil's `host.Users()` is unimplemented there). Both ride the existing `hardware` audit JSON blob — no new DB column/migration needed for either.
- `HardwareInfo` also carries (v0.2.3/v0.2.4, same "rides the existing JSON blob, no migration" pattern): `Architecture` (free — `runtime.GOARCH`, no collection needed); `System` (`SystemInfo`: Manufacturer/Model/Motherboard — DMI `sys_vendor`/`product_name`/`board_vendor`/`board_name` on Linux, `Win32_ComputerSystem`+`Win32_BaseBoard` on Windows, `system_profiler` "Model Name" on macOS with no motherboard concept there — Macs are unibody); `DisplayAdapters` (`lspci` parse on Linux, `Win32_VideoController` on Windows — wrapped in a `[PSCustomObject]` so `ConvertTo-Json` can't collapse a one-element result to a bare scalar, `system_profiler SPDisplaysDataType` "Chipset Model" on macOS); `RAM.InstalledBytes` (raw physical DIMM capacity, distinct from gopsutil's OS-visible/usable `RAM.TotalBytes` — `dmidecode --type 17` on Linux, same root-only caveat as BIOS serial; `Win32_PhysicalMemory` sum on Windows; `system_profiler` "Memory:" line on macOS); `Domain`/`WindowsDisplayVersion`/`WindowsInstallationType` (Windows-only, no Linux/macOS equivalent — `Domain` only set when `Win32_ComputerSystem.PartOfDomain` is true, since that property returns the *workgroup* name otherwise); `Virtualization` (detected guest platform — `detectVirtualization()` checks `/proc/sys/kernel/osrelease` for WSL2's own kernel signature first, then DMI vendor/product strings for Hyper-V/VMware/VirtualBox/KVM-QEMU/Xen on Linux; `Win32_ComputerSystem` Manufacturer/Model pattern-matching on Windows; `kern.hv_vmm_present` sysctl on macOS — empty string on bare metal or when undetectable. **Not yet in any released agent build**).
- `agent/internal/updater/` (self-update) — `runLoop` checks `/v1/agent/version` every 24h after an initial 5-minute stagger; a successful update writes `<credDir>/update-state.json` and hands off to `awaitConfirmation` on the next process start, which must fall through to `runLoop` again once resolved (a real bug, fixed in v0.2.5) or the device permanently stops checking for updates after one successful cycle. `<credDir>/agent.log` (v0.2.6) is the first thing to check when self-update is ever in question — Windows services have no console, so nothing here was visible in production before this.
- `agent/internal/session/` — handles `open_session` commands (dispatched from `main.go`'s command loop in its own goroutine). `session.go` dials the relay WS and switches on `session_type`; `tunnel.go` is a raw byte pump for `tcp_tunnel` (Secure-RDP-style); `shell.go` (rewritten this session — see "Remote Shell / session system" below) spawns a real persistent PTY-backed shell via `pty_unix.go`/`pty_windows.go`. These two are genuine build-tag-separated files (`//go:build !windows` / `//go:build windows`), not a `runtime.GOOS`-switch single file like `hardware.go` — the Windows ConPTY library needs Windows-only Go packages that don't compile cross-platform, unlike `hardware.go`'s shell-out-to-native-CLI approach.

### Agent release process (`scripts/publish-agent.mjs`)

Builds all 5 platform/arch binaries, signs each with `BEACON_SIGNING_KEY`, and registers each with the worker via `POST /v1/admin/agent/versions` — needs `BEACON_WORKER_URL`, `BEACON_ADMIN_SECRET`, `BEACON_SIGNING_KEY` env vars (signing key lives in the password manager only, never export it into a session whose transcript you don't want holding a private key). **Must be run from the repo root**, not `agent/` — it resolves `scripts/publish-agent.mjs` and `agent/` relative to its own script location, but the working directory still matters for the relative build paths it shells out to.

**The dead-placeholder-`download_url` gotcha is now actually fixed, not just worked around by hand.** For v0.2.0–v0.2.7, the script's default `downloadUrl` (`${workerUrl}/dist/<name>`) was a dead URL nothing served — registration succeeded and `update_available` correctly flipped `true`, but any agent attempting the download got a 404. The standing workaround was creating the GitHub Release *before* registering, then hand-crafting the real asset URL. As of the v0.2.8 release, `publish-agent.mjs` accepts a `BEACON_DOWNLOAD_BASE_URL` env var (e.g. `https://github.com/<org>/<repo>/releases/download/v<version>`) and uses it to build `downloadUrl` directly — set it once the GitHub Release exists (`gh release create vX.Y.Z dist/beacon-agent-*` first, same as always) and the script does the rest in one pass; omitting it still falls back to the old dead placeholder with a loud warning, so a dry run without a release doesn't silently look successful.

**Known gotcha — a corrupted `BEACON_SIGNING_KEY` silently invalidates every signature without any error anywhere.** Happened for real with v0.2.2: the password-manager entry holding the signing key had been overwritten with data that happened to embed the tail of an old *signature* rather than the actual 64-byte Ed25519 private key. Every step of the release process (build, sign, register, download) reported success — `tools/sign` doesn't validate that its input key's derived public half matches `pinnedPublicKey`, it just signs with whatever it's given. The only symptom was real devices silently never updating, with no error surfaced anywhere (Windows services have no console — see the `agent.log` note above). **Standing practice now: independently verify every release's signature before considering it shippable** — download the real GitHub release asset, then re-run the exact check `verifyBinary` does (SHA-256 digest → `ed25519.Verify` against `pinnedPublicKey` from `agent/internal/updater/verify.go`) in a throwaway Go program, pulling both the public key and the registered `signature_hex` programmatically (from the source file and a `wrangler d1 execute --remote` query) rather than hand-transcribing either — a manual retyping mistake in the verification script itself is indistinguishable from a real failure otherwise. If you ever need to check the key itself without pasting the private key into a session: bytes 32–63 of the 64-byte `BEACON_SIGNING_KEY` *are* the embedded public key in Go's `ed25519.PrivateKey` format, so the user can compare that slice against `pinnedPublicKey` locally and only report back match/mismatch.

Verify a release actually works end-to-end via the **unauthenticated** `GET /v1/agent/version?os=&arch=&current=` and `GET /v1/agent/download?os=&arch=` endpoints (`worker/src/routes/agent-update.ts`) — no admin secret needed, since agents themselves call these. A `curl -sIL` through `/v1/agent/download` should end in `HTTP/2 200`, not a 404, before considering a release done. This is necessary but **not sufficient** — it proves the download resolves, not that the signature is valid; do the Ed25519 re-verification above too.

**Known gotcha — `direnv` (used in this repo for `CLOUDFLARE_API_TOKEN`, see Secrets above) can silently drop manually-`export`ed env vars between shell prompts.** If `BEACON_SIGNING_KEY`/`BEACON_WORKER_URL`/`BEACON_ADMIN_SECRET` are exported in one command and the release script run in a separate command afterward, direnv's hook re-evaluating on the next prompt can reset the environment to whatever `.envrc` defines, dropping anything exported outside it — the script then fails with "Required env vars" even though `echo $VAR` just showed them set. Fix: export and run in a single chained command (`export BEACON_SIGNING_KEY=... BEACON_WORKER_URL=... BEACON_ADMIN_SECRET=... && node scripts/publish-agent.mjs ...`) so nothing can reload in between. Confirmed real during the v0.2.8 release — `node -e "console.log(process.env.X)"` printed empty despite bash's own `echo $X` printing a value moments earlier, in the same terminal.

**If you already built and uploaded a GitHub release from one machine/directory but need to sign+register from another**, don't just re-run `publish-agent.mjs` — it always rebuilds from source, and without `-trimpath` a Go binary embeds its absolute build path, so a rebuild from a different machine/directory produces **different bytes** than what's already hosted, and the freshly-computed signature won't match the already-uploaded asset. Instead, download the exact already-uploaded release assets fresh (`gh release download vX.Y.Z`) and sign+register *those* files directly — this is what happened for real during the v0.2.8 release (binaries were built in one environment, signed from the user's own machine).

**Dashboard** (`dashboard/src/`)
- Router: Vue Router with hash history (`createWebHashHistory`)
- Routes defined in `main.ts`
- All API calls via `dashboard/src/api.ts`; base URL from `VITE_API_URL` env var
- `VITE_API_URL` set in `dashboard/.env.production` — must not be undefined in prod or all requests hit Pages origin
- Sidebar is resizable (drag handle, stored in `localStorage` as `beacon-sidebar-w`) and collapsible (floating chevron button at the sidebar's edge, stored as `beacon-sidebar-collapsed` — see STYLE.md, this used to be a topbar hamburger button)

## Database

Migrations live in `migrations/` (not inside `worker/`). Drizzle points there via `wrangler.toml`. When adding a schema change:
1. Add a new migration file `migrations/XXXX_description.sql`
2. Run `make db-generate` to regenerate Drizzle types
3. Run `make migrate-local` to test locally
4. Run `make migrate-remote` after deploying the worker

Latest migration: `0032_policy_targets.sql` — adds `policy_sites`/`policy_devices` (both composite PK, mirroring `policy_groups`' shape), plus a backfill of any existing single-site `scope='company'` policies into `policy_sites`. Generalizes policy targeting from "Groups only" to a three-way OR-list (Sites/Devices/Groups) — see "Policy Targeting (Sites / Devices / Device Groups, migration 0032)" below. `0031_device_groups.sql` — adds `device_groups`, `device_group_members` (composite PK), and `policy_groups` (composite PK) — static, manually-curated Device Groups usable to target Jobs and Policies (Datto's "Groups", adapted; not the dynamic "Filter" half of that system). See "Device Groups" below. `0030_custom_fields_key.sql` — adds `custom_fields.key` (identifier form of `name`, e.g. `ASSET_TAG`) plus a partial unique index (`WHERE key != ''`, since SQLite can't add a UNIQUE column via `ALTER TABLE`). Lets a script reference a device's custom field value as the env var `CF_<KEY>`, resolved fresh per-device at job dispatch time — see "Custom Fields" below. `0029_custom_fields.sql` — adds `custom_fields` (id, name, sort_order) and `device_custom_field_values` (composite PK `device_id`+`field_id`, both FKs `ON DELETE CASCADE`) — dynamic admin-defined "UDF"-equivalent fields, manual entry only, see "Custom Fields" below. `0028_component_target_os.sql` — adds `components.target_os TEXT DEFAULT NULL` and updates the two Linux ComStore scripts to use a backgrounded 5-second-delayed restart. `0027_alert_acknowledgment.sql` adds `alert_state.acknowledged_at`/`acknowledged_by` (was missing from production and caused 500s on `GET /v1/admin/alerts?status=all` until manually applied). `0026` and earlier carry the jobs/reboot/alert work from prior sessions. `0023_device_external_ip.sql` (single-column add, `devices.external_ip` — see Device detail page below). `0022_component_sites_multi.sql` adds the `component_sites` many-to-many join table (see "Components / Job System" above for why this replaced `0021`'s single-`company_id` design within the same session). `0020_component_variables_store_postconditions.sql` adds `component_variables`, `components.origin`/`post_conditions`, `commands.warning`, plus the ComStore seed rows. `0019_device_warranty.sql` adds `devices.warranty_expires_at` (manually-entered, no agent collector, see Device detail page below). `0017`/`0018` are small fixes (narrowing the seeded offline policy to servers-only; a `commands.component_id` FK `ON DELETE` fix) worth knowing exist since they're easy to miss between the bigger `0016_users_auth.sql` (adds `users`, `user_sessions`, `sso_providers`, `sso_group_role_mappings`, `sso_login_state`, `sso_exchange_codes`, plus `sessions.client_auth_hash` — see Auth System below) and this one.

`worker/src/db/schema.ts` is hand-kept in sync with the migrations rather than generated — `migrations/meta/_journal.json` only tracks through migration 0003, so running `drizzle-kit generate` now would diff against a stale snapshot and produce a bogus catch-up migration. Don't run `make db-generate`; hand-edit `schema.ts` to match new migrations instead, consistent with how 0004 onward were actually done.

## Auth System

Multi-user auth replacing the old single-`ADMIN_SECRET`-only model. Local accounts + Microsoft Entra ID SSO, global RBAC (no per-tenant scoping — Beacon's users are internal MSP staff, not client-facing).

### Roles
`admin` > `technician` > `readonly` (hierarchy in `worker/src/lib/auth.ts`'s `ROLE_RANK`/`roleAtLeast`). Per-route convention: GET/list → `readonly`; routine mutations (approve device, run job, resolve alert, edit policy) → `technician`; user accounts and SSO config → `admin` only.

### `requireUser` (`worker/src/lib/auth.ts`)
Every `/v1/admin/*` and `/v1/sessions` route calls `requireUser(c.req.header('Authorization'), c.env, minRole)` instead of the old `requireAdmin`. It accepts either:
1. `Bearer <ADMIN_SECRET>` — the break-glass token, resolves to a synthetic admin identity, kept working forever (bootstrap + recovery, never surfaced in the dashboard UI), or
2. `Bearer <session token>` — hashed and looked up in `user_sessions` joined to `users`; rejected if revoked, expired, or the user is `disabled`; role checked against `minRole`.

Sessions are opaque random tokens (`generateToken()`/`sha256hex()`, the same convention as `enrollmentTokens.tokenHash`), not JWTs — chosen so logout/disable/role-change take effect on the user's very next request, with no denylist. `user_sessions.last_used_at` is only bumped when stale by more than 5 minutes, to avoid a D1 write on every authenticated request.

### Local auth routes (`worker/src/routes/auth.ts`)
`POST /v1/auth/login` (email+password, generic error either way to avoid enumeration), `POST /v1/auth/logout` (revokes the current session), `GET /v1/auth/me`.

### Microsoft Entra ID SSO (`worker/src/lib/oidc.ts`, `worker/src/routes/auth-microsoft.ts`)
Admin configures one or more Entra security groups mapped to a Beacon role via `/v1/admin/sso/providers` + nested `/group-mappings` (client secret AES-GCM-encrypted at rest using the `CONFIG_ENCRYPTION_KEY` secret — the one place a secret is encrypted rather than hashed, since it must be recovered in plaintext to call Microsoft's token endpoint).

Flow: `GET /v1/auth/microsoft/login` generates PKCE + a `state` row in `sso_login_state` (the row's own id *is* the `state` value — no cookie needed) and redirects to Microsoft requesting `openid profile email GroupMember.Read.All` scope; `GET /v1/auth/microsoft/callback` exchanges the code, verifies the ID token via `jose` (the one deliberate third-party-crypto dependency in the codebase, justified by how easy JWKS/JWT verification is to get wrong by hand), then **always** calls Microsoft Graph `GET /me/transitiveMemberOf` for group membership (not `/me/memberOf` — that only returns direct membership and silently misses nested groups, which are the norm in real Entra tenants; caught during this session's real Entra rollout) — never the ID token's `groups` claim, since Entra only embeds direct-membership claims below ~200 groups and requires a Graph call above that anyway. Zero matching group mappings rejects the login with no user created; multiple matches pick the highest-privilege role (`highestRole()`); role is re-resolved from current group membership on every login. The callback hands the SPA a one-time `sso_exchange_codes` code (not the real token) via redirect, so the session token never appears in a URL; `POST /v1/auth/microsoft/exchange` trades it for the real token.

**Entra app registration requirements** (see README/PROJECT_LOG for the full walkthrough): redirect URI `<worker-url>/v1/auth/microsoft/callback`; API permissions need **two** separate Graph permissions added, both requiring admin consent — `GroupMember.Read.All` as a **Delegated** permission (used at login time, in the scope above) and `Group.Read.All` as an **Application** permission (used by the group-search feature below, via client-credentials — a signed-in admin configuring SSO may not have a Microsoft delegated token available at all).

**Group search** (`GET /v1/admin/sso/providers/:id/groups?search=`, admin-only) — lets the SSO settings page search real Entra groups by display name instead of requiring a pasted Object ID. Uses `getAppOnlyGraphToken()` (OAuth2 client-credentials grant against the provider's own stored client_id/secret) + `searchGroups()` (Graph `/groups?$search=`, requires the `ConsistencyLevel: eventual` header). Falls back to manual Object ID entry in the UI if search fails (e.g. the Application permission isn't granted yet).

Google Workspace is explicitly deferred (v2) but `sso_providers.type` and the group-mapping tables are provider-generic — adding it later reuses the same tables and the same `oidc.ts` verification helper.

**Password hashing runtime limit**: `worker/src/lib/password.ts`'s PBKDF2 iteration count is capped at 100,000, not OWASP's higher recommended floor — Cloudflare Workers' actual edge `crypto.subtle` implementation throws `NotSupportedError` above 100,000 iterations. This did **not** reproduce in local `wrangler dev` testing, only against the real deployed worker — don't trust local dev alone for anything touching `crypto.subtle` limits.

### Dashboard side
`dashboard/src/auth.ts` is a small `reactive` current-user singleton (no Pinia, consistent with the app's existing no-state-library convention) — `loadCurrentUser()` calls `/v1/auth/me`, `hasRole(min)` gates nav items and admin-only routes. `dashboard/src/api.ts`'s `request()` clears the stored token and hard-redirects to `/login` on any 401 outside a login attempt (`skipAuthRedirect` opt-out used by the login/SSO-exchange calls themselves).

### Remote-session WS auth
The pre-existing shell/tunnel session WebSocket (`worker/src/routes/sessions.ts`) used to authenticate its client leg by embedding the raw `ADMIN_SECRET` in the `?auth=` query param — broken once technicians (who never hold `ADMIN_SECRET`) can open sessions too. Each session now gets its own random token at creation time, hashed into `sessions.client_auth_hash`, checked directly (not via `requireUser`, since it's a query param not a header).

## Two-Tier Policy / Monitor System

The alert/monitoring system uses a **policy → monitor** hierarchy. The old flat `alert_definitions` table is gone.

### Tables
- `policies` — named policy with scope (`global` or `company`), OS/class targeting (JSON arrays), enabled flag
- `policy_monitors` — individual check rules attached to a policy: check_type, config (JSON, shape varies by check_type), alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes
- `alert_state` — per (device, policy_monitor) pair: condition_first_seen, is_alerting, alerted_at, resolved_at

`check_type` is a bare `TEXT` column with no SQL `CHECK` constraint — adding a new check type is a TS-enum-only change (`schema.ts`, `routes/admin/policies.ts` `VALID_CHECK_TYPES`, `dashboard/src/api.ts`) with **no migration required**.

### Check types

Ten check types across four evaluation shapes:

**A. Sampled every check-in (60s), evaluated directly against `Metrics`:**

| Type | Config | Notes |
|---|---|---|
| `disk_space` | `{drive, threshold_type, threshold_value, min_disk_gb}` | `drive: "any"` or a specific device/label match; `threshold_type: gb_free\|gb_used\|percent_used` |
| `cpu_usage` | `{percent_max}` | `>=` comparison ("has reached") |
| `memory_usage` | `{percent_max}` | `>=` comparison |
| `av_status` | `{av_state}` | key `av_status:${av_state}` allows 3 sub-monitors (not_detected/not_running/running_not_up_to_date) per policy |

**B. Cron-evaluated (every 2 min), not tied to check-in:**

| Type | Config | Notes |
|---|---|---|
| `offline` | `{direction: 'offline'\|'online', offline_after_seconds}` | `direction: 'offline'` (default) = alert when silent past threshold; `direction: 'online'` = alert once device has been checking in continuously for `sustained_minutes` (presence grace: 5 min) |

**C. Agent-measured — "assign → measure → report" pattern** (see below): worker tells the agent what to check in the check-in *response*, agent measures async, reports back on the *next* check-in via a `pending_*_results` field:

| Type | Config | Assigned via | Reported via |
|---|---|---|---|
| `file_size` | `{path, mode: below\|over, threshold_mb}` | `file_size_checks` | `pending_file_size_results` |
| `ping` | `{target, packet_count, check_unreachable, packet_loss_pct, latency_ms}` — bundles all 3 Datto conditions into one monitor/one alert | `ping_checks` | `pending_ping_results` |
| `process` | `{process_name, mode: running\|stopped\|cpu\|memory, threshold_pct}` | `process_checks` | `pending_process_results` |
| `service` | `{service_name, mode, threshold_pct, boot_delay_minutes}` — Windows only; `boot_delay_minutes` gates *assignment* (not evaluation) using `metrics.uptime_seconds`, so services still starting after boot don't false-alert | `service_checks` | `pending_service_results` |

**D. Audit-evaluated (not check-in) — event-driven, not state-driven:**

| Type | Config | Notes |
|---|---|---|
| `software` | `{name_pattern, mode: installed\|uninstalled\|version_changed}` | Evaluated from `worker/src/routes/audit.ts`'s existing `diffSoftware()` output on every `POST /v1/audit`, not check-in. `%`-wildcard name matching. **Never auto-resolves** (hardcoded `auto_resolve: false`, hidden in UI) — Datto's own spec requires manual resolution. `sustained_minutes` is always `0` (fire on first detection; see fire-immediately fix below) |

### "Assign → measure → report" pattern (agent-executed checks)

Used by `file_size`/`ping`/`process`/`service`. Mirrors the pre-existing `commands`/`pending_command_results` shape:
1. `evaluateCheckinAlerts` (in `worker/src/lib/alerts.ts`) resolves effective monitors for the device, and for these four types pushes an assignment (`{monitor_id, ...}`) into the check-in *response* instead of evaluating anything — returns a `CheckinAssignments` object (`{fileSizeChecks, pingChecks, processChecks, serviceChecks}`).
2. Agent (`agent/cmd/agent/main.go`) receives the response, dispatches one goroutine per assignment (`agent/internal/{filesize,pingutil,procutil,svcutil}`), buffers results in a `pendingMu`-guarded package var, and sends them on the *next* check-in.
3. Worker evaluates each category with its own `evaluate*Alerts` function (`evaluateFileSizeAlerts`, `evaluatePingAlerts`, `evaluateProcessAlerts`, `evaluateServiceAlerts`), all calling the shared `processAlertState`.
4. `check_interval_minutes` throttles *assignment* (not just evaluation) — a monitor is only assigned on check-ins where `Math.floor(now/60) % checkIntervalMinutes === 0`, stateless (no "last checked" storage needed).

Agent packages added this session (all follow the shell-out-to-native-tool or gopsutil convention already used by AV/BIOS collection): `diskutil` (multi-drive enumeration, shared with the audit collector), `filesize` (stat/walk), `pingutil` (shells to native `ping`, parses output), `procutil` (gopsutil `process` package), `svcutil` (Windows-only, `Get-CimInstance Win32_Service` → PID → gopsutil).

### Scope resolution
`resolveEffectiveMonitors` groups matched monitors **by check_type**, not per-monitor: if any company-scoped policy has monitors of a given check_type for the device, its monitors *entirely replace* the global ones for that type — never merged monitor-by-monitor. This is what lets multiple monitors of the same check_type coexist on one policy (av_status's 3 states, cpu_usage's critical+warning pair, multiple ping targets, etc.) without a company override accidentally leaving a stray global monitor active alongside it.

### Two bugs found and fixed this session (both in `processAlertState`, `worker/src/lib/alerts.ts`)
1. **Dedup collision**: the old scope-resolution key was `checkType` alone (`av_status` special-cased) — two monitors of the same check_type (e.g. two `cpu_usage` thresholds) silently collapsed to one. Fixed by the group-based resolution above.
2. **Fire-immediately**: the first-ever observed `failed=true` for a (device, monitor) pair only ever seeded `condition_first_seen` — it required a *second* consecutive failure to actually set `is_alerting=1`. Invisible for 60s-polled monitors (a confirming sample arrives a minute later) but fatal for one-shot/event-driven checks (`software`) where a transition is only ever observed once. Fixed: when `sustained_minutes === 0`, fire on first detection.

### Default global policies (seeded)
- **Antivirus Health** — 3 monitors: not_detected (critical/5m), not_running (high/10m), running_not_up_to_date (moderate/60m)
- **Disk Space** — 1 monitor: any drive < 10 GB free (high/5m, auto-resolves in 120m)
- **Device Offline** — 1 monitor: offline after 30 min (high, auto-resolves in 30m)
- **Memory Usage** — 1 monitor: ≥ 90% (high/10m, auto-resolves in 30m)
- **CPU Usage** — 2 monitors: ≥ 100% (critical/5m) + ≥ 95% early warning (high/15m) — per Datto's own recommended two-tier pattern
- `file_size`/`ping`/`process`/`service`/`software` have no seeded defaults — no universal target/name/path/process is sane to bake in; operators create their own.

## Components / Job System

Script/application library (`components`) + delivery mechanism (`jobs` → `commands`), extended this session toward Datto RMM's Component Library parity (deliberately not 1:1 — see "explicitly out of scope" below).

### Tables
- `components` — `type` (`script`|`application`, drives behavior: Applications currently execute identically to Scripts, no file-attachment support yet — label-only, groundwork for a later pass once object storage exists), `origin` (`custom`|`store` — ComStore provenance), `scope` (`global`|`company` — **`company` means restricted to the sites listed in `component_sites` below, a real many-to-many list, not a single company**; `company_id` is a vestigial, unused column left over from a superseded single-company design, see below), `category` (freeform organizational tag, shown in the UI as "Group" — deliberately renamed so it isn't confused with `type`), `shell`/`script`/`timeout_seconds`, `post_conditions` (JSON array, see below), **`target_os`** (`null`|`'windows'`|`'linux'`|`'darwin'` — filters at dispatch time in `insertJobCommands`, not at creation time; store-origin components have the Platform field disabled in `ComponentFormPage.vue`; `isStore` ref set on load from `comp.origin === 'store'`).
- `component_variables` — typed input variables per component: `name` (env-var identifier, validated against `^[A-Za-z_][A-Za-z0-9_]*$`), `label`, `type` (`string`|`selection`|`boolean`|`date`), `options` (JSON `{label,value}[]`, only for `selection`), `default_value` (always a string regardless of declared type — Datto's own convention, replicated), `description`, `required`, `sort_order`.
- `component_sites` — many-to-many `(component_id, tenant_id)` membership for `scope='company'` components, `UNIQUE(component_id, tenant_id)`, `ON DELETE CASCADE` both directions. Added in migration `0022` to replace `0021`'s single-`company_id` design once real Datto reference screenshots showed an "Add Site" flyout that adds sites one at a time to a list, not a single-select combobox — worth remembering if `company_id` is ever seen non-null on a `components` row from before this fix, it's dead weight, not the real scoping mechanism.
- `jobs`/`commands` — `jobs.component_ids` is a JSON array of `ComponentRef` (`{type:'library', component_id, order, variable_values?}` or `{type:'inline', shell, script, timeout_seconds, order}`); `commands.payload` for a `run_script` command also carries `variables: Record<string,string>` (folded in by `resolvePayload` in `jobs.ts`), and `commands.warning` (bool) is set independently of `status` when a post-condition matches. `jobs.scheduled_at`/`expires_at`/`run_as_system` are now **live** (see "Scheduling" below) — no longer dead columns.

### ComStore
`origin='store'` components are seeded once via migration `0020` (a handful of trivial examples — clear temp files, flush DNS, list installed software) and are **read-only at the API layer** — `PATCH`/`DELETE` return 403 on a store-origin row. `GET /v1/admin/components/store` lists them (must be registered before `GET /:id` in Hono's route table, or `/store` gets swallowed as an `:id` match); `POST /:id/clone` copies a component (any origin) — including its variables and sites — into a fresh `origin='custom'` row a user can edit freely. This is intentionally a stub: no real marketplace/sharing mechanism, just the schema hook + a minimal browse+clone UI.

### Input variables
Full 4 types (String/Selection/Boolean/Date), matching Datto. Prompted per-job at creation time via the shared `dashboard/src/components/ComponentVariablePrompt.vue` — used by **two independent call sites** that each build a `ComponentRef`: `JobFormPage.vue` (formerly `CreateJobModal.vue`, deleted when Create Job moved to a full page — see "Scheduling" below) and `DeviceDetailPage.vue`'s Quick Job modal. Easy to miss one of these when touching this area again. All values pass through as strings regardless of declared type (Booleans become the literal strings `"true"`/`"false"`) — Datto's own convention, replicated rather than reinvented. Resolution happens server-side in `jobs.ts`'s `resolvePayload`: supplied value → the variable's `default_value` → (if `required`) a named 400 error before any commands are inserted. The agent (`agent/internal/executor/run.go`) injects the resolved map into `exec.Cmd.Env` via `append(os.Environ(), "KEY=value", ...)`.

### Post-conditions
A component's `post_conditions` (JSON array of `{id, stream: stdout|stderr|both, match_type: contains|regex, pattern, enabled}`) get evaluated in `worker/src/routes/checkin.ts`, at the exact point a command result is persisted (`worker/src/lib/postConditions.ts`'s `evaluatePostConditions`) — sets `commands.warning`, **never** touches `status`. Surfaced in `JobsPage.vue` as a distinct amber "Warning" mini-badge alongside the existing queued/sent/completed/failed ones.

### Scheduling ("assign at dispatch time", not "assign at creation time")

`POST /v1/admin/jobs` (`worker/src/routes/admin/jobs.ts`) branches on `type`:
- **`quick`** (default) — target devices resolve immediately, and `insertJobCommands` dispatches right away, same as the original design.
- **`scheduled`** — the job row is inserted with `scheduled_at`/`expires_at` set and **zero commands**. Nothing dispatches until the 2-minute cron's `dispatchDueScheduledJobs` (`worker/src/index.ts`'s `scheduled()` handler) finds it due. Target devices are resolved **then**, not at creation — a job created against "All Devices" today correctly picks up a device enrolled tomorrow, matching Datto's own documented behavior. A job with zero matching devices at a given tick is left `active` and retried every 2 minutes until it either resolves devices or expires. `cancelExpiredScheduledJobs` runs right after — any `scheduled`/`active` job whose `expires_at` has passed with **still zero commands** (i.e., it never got a chance to run) flips to `cancelled` instead of dispatching late. Both functions key off `NOT EXISTS (SELECT 1 FROM commands WHERE job_id = j.id)` as the "not yet dispatched" signal — no separate `dispatched_at` column needed.
- `insertJobCommands` is the one shared dispatch primitive both paths call — extracted from what used to be inline-only in the `POST /` quick-job branch.
- `run_as_system` is stored and returned but **only `true` is ever sent by the dashboard** — see Dashboard below for why "run as a logged in user" is disabled, not just hidden.

### Dashboard
- `ComponentsPage.vue` — list page only (stat cards for Total/Applications/Scripts, My Library / Browse Store tabs, Group+Kind+Sites columns). No longer has a create/edit modal. Its "Run as Job" bulk action now `router.push`es to `/jobs/new?components=id1,id2` instead of opening a modal — `JobFormPage.vue` reads that query param on mount and pre-selects matching library components once loaded.
- `ComponentFormPage.vue` (`/components/new`, `/components/:id`) — full-page create/edit, mirrors `PolicyFormPage.vue`'s breadcrumb/topbar/section-group conventions. Sites use a right-side "Add Site" flyout (search + per-row Add/Remove toggle that stays open across multiple picks, plus a "Remove all" bulk action) — see STYLE.md for the exact markup/CSS.
- New components: variables and sites are held locally and batch-POSTed after the parent component is created (same pattern `PolicyFormPage.vue` already uses for monitors). Existing components: every variable/site add/edit/delete hits the API immediately.
- `JobFormPage.vue` (`/jobs/new`) — third real-world instance of the `.pf-page` full-page-form shell (after `PolicyFormPage.vue`, `ComponentFormPage.vue`). Sections: Name, Components (search-combobox add + reorder, same UI `CreateJobModal.vue` used to have), **Targets** (Datto-style right-side flyout: `<select>` category dropdown → All Devices / Sites / Devices, search input, per-row Add/checkmark-to-remove; same selected-state pattern as the component flyout — see STYLE.md), **Schedule** (seg-bar Immediately/At a scheduled time; a `<input type="datetime-local">` + Expiration `<select>` appear only when Scheduled is picked, feeding `scheduled_at`/`expires_at` as unix timestamps computed client-side), **Execution** (seg-bar with "Run as a logged in user" rendered `disabled` with a `title` tooltip and an explanatory `field-hint` below — a real capability gap being surfaced honestly, not a feature being hidden). No Notification section at all — see below.
- `JobDetailPage.vue` (`/jobs/:id`) — breadcrumb/title with Retire/Purge buttons; 2-column Details card (`.jd-details-grid`); inline SVG flow diagram (viewBox `0 0 680 210`) showing Pending→Running→Successes/Warnings/Failures nodes with dynamic fill/stroke/count bound to `flowStats` computed; Devices table with per-command status badge and StdOut/StdErr inline expansion. `JobsPage.vue` row click and the job name link both navigate here; all prior inline expansion in `JobsPage.vue` is removed. `commands.warning` is exposed on the detail endpoint (`row.warning === 1` coercion — SQLite integer) and drives both the `.jd-status-warning` badge and the `.mini-warning` badge on the list.
- `DeviceDetailPage.vue`'s Quick Job modal — updated to include a ComStore tab alongside Library and Write Script, matching `ComponentsPage.vue`'s split. Store components loaded lazily on first tab activation.

### Explicitly out of scope
- **Monitor** as a component category — Beacon's Policy/Monitor system already owns "run something and alert on it"; a future `component` policy check_type reusing this script library (floated in earlier sessions) is separate, later work.
- File attachments for Applications (no object storage/R2 configured yet — Applications behave identically to Scripts today, just a real, queryable category value).
- Component access **Levels** (Datto's Basic→Super 5-tier visibility) — redundant with Beacon's existing 3-role RBAC.
- **Execution-context switching** ("run as a logged in user") — shown in the UI (disabled) rather than omitted, since the segmented control itself is meaningful documentation of the gap, but not implemented: needs real Windows user-impersonation in the agent (`WTSQueryUserToken`/`CreateProcessAsUser`-style), which doesn't exist anywhere in `agent/internal/executor`.
- **Notification (email on job completion)** — evaluated and declined for the Create Job page entirely (not even a disabled stub, unlike Execution) — Beacon has zero email-sending infrastructure anywhere (see Auth System's "no local password-reset email flow" note), and building that is a separate initiative, not a job-form add-on.
- **Full recurrence patterns** (daily/weekly/etc.) and Datto's "yearly calendar outlook" visual — `scheduled_at` supports exactly one future run, not a repeating schedule. Skipped for the same reason other elaborate reference visuals were skipped elsewhere (historical-metrics-over-time tab, etc.) — real complexity with no clear payoff at Beacon's current scale.

## Remote Shell / session system

The `sessions`/`SessionRelay` machinery predates this session (built as a generic shell/TCP-tunnel WS relay) but was never actually exercised end to end until the Interactive Remote Shell shipped — `POST /v1/sessions` had never been called by anything real before, which is exactly what let two real bugs (below) go unnoticed until now.

### Architecture
- `worker/src/durable-objects/session-relay.ts`'s `SessionRelay` DO is a **fully generic, byte-agnostic bidirectional relay** — forwards whatever bytes arrive from one tagged WebSocket role (`agent`/`client`) to the other, one DO instance per session (`idFromName(sessionId)`). It doesn't know or care about shell-vs-tunnel protocol semantics; that all lives in the agent/dashboard endpoints. This means a future tool (File Manager, etc.) can reuse this exact DO unmodified, just with a new `session_type`.
- `worker/src/routes/sessions.ts`: `POST /v1/sessions` (technician role) validates the device, generates a session ID + per-session random client auth token (see Auth System's "Remote-session WS auth"), inserts a `sessions` row, and queues an `open_session` command via the **existing command-queue channel** — the agent picks this up on its next normal check-in (up to 60s later), not a dedicated push mechanism. `GET /v1/sessions/:id/ws` upgrades and proxies straight to the DO.
- `sessions.sessionType` is a real SQL enum (`'shell' | 'tcp_tunnel'`), unlike the free-text `policy_monitors.check_type` pattern — adding a new session type needs a migration.
- `sessions.status` (`pending`/`active`/`closed`) exists in the schema but is **dead code** — inserted as `pending` and never transitioned anywhere. Not needed for the shell to work; left alone rather than wired up, since a real session-history/audit-log feature would be the natural reason to finally use it.

### Agent-side protocol (`shell.go`, rewritten this session)
One persistent PTY-backed shell process spawned per session (not one-shot-per-message, which is what shipped before this session and had zero real interactivity). Binary WS frames carry raw PTY bytes in both directions (keystrokes in; combined stdout+stderr out, since a PTY interleaves them naturally). Text WS frames carry a small JSON control envelope — currently just `{type:'resize',cols,rows}`. This binary-for-data/text-for-control split is deliberate and leaves room for future control messages without needing a new session type. Default shell: Unix picks `$SHELL` → `/bin/bash` → `/bin/sh`; Windows uses `powershell.exe` (matches the existing Quick Job "shell: auto" convention already documented elsewhere).

### Dashboard (`RemoteShellModal.vue`)
xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) — first terminal-emulator dependency in this codebase. Opens a native `WebSocket`, shows a "Connecting… up to 60 seconds" state until the *first* message of any kind arrives from the agent side (there's no earlier signal without extra relay-side plumbing, since the agent doesn't attach until its next check-in). `term.onData` keystrokes are sent as binary frames; incoming binary frames are written via `term.write(new Uint8Array(...))` (not a manual UTF-8 decode, which risks corrupting multi-byte sequences split across chunks). A `ResizeObserver` on the terminal container drives both `FitAddon.fit()` and a resize control frame. Modal shell duplicates `.modal-backdrop`/`.modal`/`.modal-header`/`.btn-icon` CSS locally (matching this codebase's established per-component duplication convention — see STYLE.md) rather than sharing with `DeviceDetailPage.vue`'s differently-named `.modal-head`/`.modal-foot` variant.

### Two real bugs found and fixed while wiring this up (first time `/v1/sessions` was ever called from a browser)
1. **Missing CORS** — `/v1/sessions*` wasn't in `index.ts`'s CORS middleware list at all (only `/v1/admin/*` and `/v1/auth/*` were).
2. **Origin misdirection** — `sessions.ts` built the agent/client WS URLs from `new URL(c.req.url).origin`, which reflected the *production* domain even under local `wrangler dev` (caused by the `[[routes]]` custom-domain block in `wrangler.toml`) — a local test agent actually dialed out and connected to the real production worker during testing before this was caught. Fixed with a configured `WORKER_URL` env var (see Self-hosting config above) instead of deriving from the request.

### Explicitly out of scope (deliberate, not an oversight)
File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart, network device deploy/wake, in-session Quick Jobs, session history/audit UI — all future work, all able to reuse this same relay/auth/dial-out plumbing. Multiple simultaneous shell sessions per device already "just works" (each gets its own DO instance) — a nice side effect, not a separate feature.

## Custom Fields

Beacon's equivalent of Datto RMM's "UDF" (User-Defined Field) system — scoped against the real Datto spec (300 fixed, pre-numbered, globally-relabeled slots, optionally agent-populated, usable as Job/Policy targeting criteria) and deliberately reduced for this pass, matching the codebase's established pattern of scoping down from Datto's exact feature shape when it doesn't add real value yet (see the Components/Job System's own "Explicitly out of scope" list for the same pattern elsewhere).

### Tables
- `custom_fields` — field definitions: `id`, `name` (display), `key` (identifier form, e.g. `ASSET_TAG` — migration `0030`, `''` means "not yet assigned, not script-referenceable"; partial-unique so multiple unset fields can coexist), `sort_order`, `created_at`. No per-scope/per-tenant restriction — every field is visible on every device, matching how Datto's UDF slots are always global.
- `device_custom_field_values` — `(device_id, field_id)` composite primary key, `value` (nullable text), `updated_at`. Both FKs `ON DELETE CASCADE` — deleting a field definition removes every device's stored value for it; deleting a device removes its values too. A real join table, not a JSON blob on `devices.inventory` — chosen so a future filter/targeting pass (see below) doesn't need a schema change.

### Scope decisions (all confirmed before implementation)
- **Dynamic named fields, not Datto's 300 fixed slots** — an admin creates exactly the fields they need instead of relabeling a fixed pool.
- **Manual entry only** — no agent-write path. Datto lets a script/monitor populate a UDF automatically ("populated by the Agent"); nothing in `agent/internal/executor` exists to write a field value back, and building that is separate work.
- **No Job/Policy targeting by field value** — Datto lets a Job or Policy target devices by UDF value (e.g. "Environment = Production"). Would need new filter logic in both `jobs.ts`'s target resolution and `alerts.ts`'s `deviceMatchesPolicy`; deferred rather than bundled in. Distinct from the script-variable capability below — a script can *read* a field's value once dispatched to a device, but a field's value can't yet be used to *decide which devices* a job/policy targets in the first place.

### Script variables (`CF_<KEY>`) — Datto UDF-style, reference-by-name

A component's script can reference a device's custom field value directly, with no per-component declaration step — researched against Datto's real docs (rmm.datto.com), which distinguish this from Input Variables (Beacon's `component_variables`, declared per-component, prompted at job-creation time, one value for the whole job) via a genuinely separate mechanism: `UDF_1`..`UDF_300`, referenced by fixed naming convention directly in the script body, resolved *per-device* at dispatch time. Beacon's version: `${CF_<KEY>}` (bash), `$env:CF_<KEY>` (PowerShell), `%CF_<KEY>%` (Batch) — `CF_` prefix chosen for the same reason Datto's `UDF_` prefix exists, namespacing against an unrelated `component_variable` of a similar name.

- **Resolution stays inside `insertJobCommands`** (`worker/src/routes/admin/jobs.ts`) — the one shared dispatch primitive both `dispatchDueScheduledJobs` and the quick-job `POST /` handler already call, so one change covers both paths, exactly like `target_os` filtering already does per-device there. A new `fetchCustomFieldVars` helper bulk-fetches every target device's values in one `WHERE device_id IN (...)` query (same placeholder-list shape `resolveDevices` already uses) — early-exits with zero extra queries when no field has a `key` assigned yet, and never injects a `CF_<KEY>` env var for a device/field pair with no stored value (no empty-string vars). Merged into each device's `variables` map as `{...cfVars, ...payload.variables}` — a component's own declared `component_variables` value wins on the (extremely unlikely) literal collision.
- **No agent-side change** — `agent/internal/executor/run.go` already treats `commands.payload.variables` as an opaque flat `map[string]string`, blindly `append`ing every key as `KEY=value` to the child process env. Purely a worker-side merge before serializing the payload.
- **Rename guard, not a hard lock**: `PATCH /v1/admin/custom-fields/:id` blocks a `key` change if any `components.script` still contains the literal `CF_<OLDKEY>` substring — returns `409` with the list of blocking component names/ids, rather than silently breaking a script that references the old key. Deliberately a **plain JS substring scan** over all `components.script` (`SELECT id, name, script FROM components`, then `.includes()`), not SQL `LIKE` — key values contain `_`, which SQLite's `LIKE` treats as a single-char wildcard, so a `LIKE '%CF_<oldKey>%'` query would false-match unrelated scripts. Full-table scan is fine at this scale (self-hosted admin action, tens not thousands of components). Renaming to/from an empty key, or changing `name`/`sort_order` without touching `key`, is never blocked.
- Key format: `^[A-Z_][A-Z0-9_]*$` (uppercase-only — stricter than `component_variables`' mixed-case `VARIABLE_NAME_RE`, since env var convention is uppercase and this is auto-derived from the display name anyway), validated both client- and server-side since the literal `CF_<KEY>` string is what ends up embedded in scripts.

### Worker
- `worker/src/routes/admin/custom-fields.ts` — field-definition CRUD (`GET/POST /`, `PATCH/DELETE /:id`). **Admin-only**, not `technician` — this is Settings-area configuration (same tier as SSO providers, unlike routine per-device mutations). `POST`/`PATCH` also validate/uniqueness-check `key` and run the rename guard described above.
- `worker/src/routes/admin/devices.ts` — `GET /:id/custom-fields` (readonly) returns every field definition left-joined against this device's stored values (`null` when never set); `PATCH /:id/custom-fields/:fieldId` (technician) upserts a value — checks for an existing row, then inserts or updates, since no `onConflictDoUpdate` precedent existed elsewhere in the codebase to follow.
- `dashboard/src/api.ts`'s `request()` now parses a JSON `{error}` response body into the thrown `Error`'s message when present, falling back to the raw response text otherwise — added so the rename guard's 409 message (and its component list) reads cleanly in the UI instead of a raw JSON blob; backward-compatible with every other existing error banner in the app.

### Dashboard
- `CustomFieldsSettingsPage.vue` (`/settings/custom-fields`, admin only) — manages field definitions: inline-editable name (`@change`, same convention as the device page's Warranty field), a Key column (auto-suggested from the name as you type — uppercase, non-alnum runs → `_` — editable before save, stops auto-suggesting once hand-edited), ↑/↓ buttons that swap two fields' `sort_order` and persist both immediately. A blocked key rename reverts the input to its prior value and surfaces the 409 message in the existing `.error-banner`. Modeled directly on `SsoSettingsPage.vue`'s "Group → Role Mappings" list section (`.pf-monitors`/`.pf-mon-row`/`.pf-tbl-head` classes reused as-is).
- `DeviceDetailPage.vue` gained a **Custom Fields** section between Network and Security (matching Datto's own relative UDF placement — second-to-last, just before Security). One inline-editable text input per field definition; values load alongside everything else in `onIdChange`'s `Promise.all`. Editing a field calls `PATCH /v1/admin/devices/:id/custom-fields/:fieldId` directly — no separate save step.
- `ComponentFormPage.vue` fetches the field list once on mount and shows a small discoverability hint under the Script textarea (`Available custom fields: CF_ASSET_TAG, CF_SITE_CONTACT`, only fields with a non-empty `key`) — matches the existing placeholder hint's own "Reference variables as..." text. No autocomplete/insertion, purely informational.
- **State-declaration-order gotcha**: the `customFields`/`customFieldsLoading`/`customFieldSaving` refs must be declared *before* `onIdChange` and the router `watch(..., { immediate: true })` that calls it — that watch fires synchronously during `<script setup>` execution, so any ref it reads must already be initialized textually above it. Declaring them near the bottom of the file (next to unrelated code, e.g. the Warranty-field logic) throws a TDZ `Cannot access '<name>' before initialization` on every page load — a real bug hit once, invisible to `vue-tsc` since it's a runtime evaluation-order issue, not a type error. Fixed by keeping all section-state refs grouped together above `onIdChange`, alongside `auditData`/`deviceAlerts`/`effectiveMonitors`.

## Device Groups

Beacon's equivalent of Datto RMM's "Groups" — a static, manually-curated, named collection of individual devices, usable to target both Jobs and Monitoring Policies. Researched directly against Datto's real Filters/Groups spec (rmm.datto.com) this session: Datto actually has two distinct mechanisms — **Filters** (dynamic, criteria-based, auto-updating membership across ~85 possible attributes) and **Groups** (static, manually-curated). Beacon builds only the Groups half.

### Scope decisions (all confirmed before implementation)
- **No dynamic Filters** — the actual need was "hold a named, reusable set of specific machines," not a live-query engine. A Filter would need real new infrastructure (a criteria builder, `WHERE`-clause evaluation at dispatch time) for a capability not being asked for.
- **No "Site Groups"** (a saved collection of whole sites) — `JobFormPage.vue`'s target flyout already supports adding multiple sites to one job today; a saved site-group would only be a naming convenience for something that already works, not new capability.
- **Flat and global** — a device can belong to more than one group; groups aren't scoped to a site.
- **Usable to target both Jobs and Policies** — matches Datto's own dual usage (its docs confirm Monitoring Policies target through either Device Filters or Device Groups, with OR logic across multiple targets).
- **"Device Groups" label everywhere in the UI, never bare "Groups"** — `components.category` is already surfaced in the UI as "Group" (a different concept — component organizational tags); bare "Groups" would collide with that existing term.

### Tables
- `device_groups` — `id`, `name`, `description`, `created_at`, `updated_at`.
- `device_group_members` — `(group_id, device_id)` composite PK (migration `0031`), both FKs `ON DELETE CASCADE`. A pure association with no independent row identity ever referenced, so composite PK is the better fit than `component_sites`' synthetic-id + separate `UNIQUE` constraint pattern — matches the more recently-established `device_custom_field_values` convention.
- `policy_groups` — `(policy_id, group_id)` composite PK. As of migration `0032` this is one of three OR'd targeting dimensions (alongside `policy_sites`/`policy_devices`) rather than the sole one — see "Policy Targeting (Sites/Devices/Groups)" below for the current full model.

### Job targeting
A 4th `resolveDevices()` branch in `worker/src/routes/admin/jobs.ts` (alongside the existing `devices`/`tenants`/`all`) — `JOIN device_group_members`, `DISTINCT` (so targeting overlapping groups, or a device in more than one targeted group, doesn't double-dispatch), still filtered to `status='approved'`. No migration needed on `jobs` itself — `target_type`/`target_ids` are already unconstrained TEXT/JSON columns, same as when `tenants` targeting was added. Both `dispatchDueScheduledJobs` and the quick-job `POST /` handler flow through this one function, so group targeting works for both dispatch paths automatically.

### Policy targeting — the performance-sensitive part
`worker/src/lib/alerts.ts`'s `deviceMatchesPolicy`/`matchMonitorsForDevice` gained a device's group-ID set and a policy-ID→group-IDs map, both **always pre-fetched by the caller, never queried inside a per-device loop** — this path runs on real hot paths (every device check-in, the 2-minute offline cron over the whole fleet). `fetchPolicyGroupIds`/`fetchDeviceGroupIds` helpers follow the exact same "fetch once per invocation" rule `fetchEnabledPolicyMonitors` already established: `resolveEffectiveMonitors`'s check-in path (called once per device every 60s) fetches both maps for just that one device; `evaluateOfflineAlerts` (the bulk cron) fetches both maps **once for the whole tick**, before its device loop, not per device. `reconcileOrphanedAlerts` (already existing, already called from `policies.ts` whenever `target_os`/`target_class` narrows) bulk-fetches for just its affected rows. Migration `0032` (see below) extended this exact same fetch-once pattern with two more maps (`policySiteIds`/`policyDeviceIds`) rather than inventing a new one.

### Worker
- `worker/src/routes/admin/groups.ts` (new) — group CRUD (`GET/POST /`, `PATCH/DELETE /:id`) and nested membership (`GET/POST /:id/members`, `POST /:id/members/bulk` for the `DevicesPage.vue` bulk action, `DELETE /:id/members/:deviceId`). **`technician` for mutations, `readonly` for viewing** — Device Groups are operational targeting infrastructure like Jobs/Policies, not Settings-area config like Custom Field *definitions*/SSO (which are admin-only). `GET /` and `GET /:id` both include `deviceIds: string[]` per group (via `group_concat` on the list route) so the dashboard can compute accurate deduped device counts without an extra request per group.
- `worker/src/routes/admin/policies.ts` gained nested `/:id/groups` (`GET`/`POST`/`DELETE`), mirroring `components.ts`'s `/:id/sites` shape.

### Dashboard
- `GroupsPage.vue` (`/groups`) — list page mirroring `ComponentsPage.vue`/`CustomFieldsSettingsPage.vue`.
- `GroupFormPage.vue` (`/groups/new`, `/groups/:id`) — reuses `ComponentFormPage.vue`'s "Add Site" flyout convention verbatim, adapted to search/add/remove devices instead of sites.
- `DevicesPage.vue` gained an "Add to Group" bulk toolbar action (next to the existing `bulkAudit`/`bulkEndMaintenance`), using the page's pre-existing bulk-select infrastructure (`selected`/`selectedCount`/`selectedIds`) — pick an existing group or name a new one, then `members.addBulk`.
- `JobFormPage.vue`'s target flyout gained a 4th `TargetItem` kind (`group`) and flyout category ("Device Groups") — `isTargeted`/`toggleTarget` needed no changes (already generic over kind/id); only the template branch, `submit()`, `targetLabel`, and `resolvedDeviceCount` needed a new case each, the same shape of change adding `tenants` targeting already was.
- `PolicyFormPage.vue` originally gained a standalone "Device Groups" section here (independent lifecycle, its own API calls) — **superseded by migration `0032`'s unified Targets section**, see below.
- Sidebar: "Device Groups" link lives in the **Devices** section (alongside Device Approvals/All), not Automation — groups organize devices, they don't do anything by themselves the way Jobs/Components do.

## Policy Targeting (Sites / Devices / Device Groups, migration 0032)

A later-session redesign of policy targeting, triggered by the user comparing `PolicyFormPage.vue` against a real Datto Create Policy reference screenshot and asking to "fix the policy targeting to match the reference aka rest of the site" — Datto's reference shows one unified "Targets" section (a single Add Target flyout, one flat list), while Beacon had it split three ways: a Scope seg-bar (Global/single-Site combobox), OS/Class pill checkboxes, and a separate Device Groups picker.

### Scope decisions (confirmed via AskUserQuestion before implementation)
- **Unify Sites (now multi-site, not one), individual Devices (new), and Device Groups into one Targets flyout**, reusing `JobFormPage.vue`'s `.tf-` flyout pattern verbatim for visual/interaction consistency with the rest of the app.
- **OS/Class targeting stays separate and unchanged** — its own section (relabeled "OS & Class" to free up the word "Targets"), still ANDed with everything else. Not folded into the new flyout as a fake "Device Filters" category, since Beacon deliberately has no dynamic Filters (see Device Groups' own scope decisions above).
- **Targeting is a heterogeneous OR-list, not Job's single-kind-exclusive model.** This is the one genuine behavioral fork from `JobFormPage.vue`'s flyout, worth remembering since the two flyouts now *look* identical but behave differently: Job's flyout restricts to one target kind at a time (picking a Device clears any previously-picked Sites) — Policy's flyout does **not**; a policy's Targets list can mix a Site AND a Device AND a Device Group simultaneously, and a device qualifies if it matches **any** entry, of **any** kind. Confirmed via AskUserQuestion against this project's own prior research into Datto's real documented behavior ("OR logic across multiple targets," already noted above under Device Groups) rather than assumed from `JobFormPage.vue`'s precedent.
- Zero targets across all three tables = unrestricted (matches every device) — generalizes the pre-existing "zero `policy_groups` rows = unchanged" precedent to all three kinds uniformly.
- Per-target Enabled/Disabled overrides (a distinct Datto capability shown in a second reference screenshot — temporarily excluding specific sites/devices from an otherwise-matching policy) — explicitly declined for this pass, no Beacon equivalent exists.

### Tables
- `policy_sites` — `(policy_id, tenant_id)` composite PK, migration `0032`, mirrors `policy_groups`' exact shape. Supersedes the old single `policies.company_id` — a policy can now target multiple sites, not one.
- `policy_devices` — `(policy_id, device_id)` composite PK, migration `0032` — individual-device targeting, previously not possible for policies at all (only Jobs had it).
- `policies.scope` (`'global'|'company'`) is now **derived, not directly user-set** — recomputed by `recomputePolicyScope()` (`worker/src/routes/admin/policies.ts`) after every mutation of any of the three target tables: `'global'` when a policy has zero targets across `policy_sites`/`policy_devices`/`policy_groups`, `'company'` when it has 1+. Purely a display/tab-filtering convenience (`GlobalPoliciesPage.vue`'s Global/Company tabs, `DeviceDetailPage.vue`'s scope badge) — the actual matching logic (`deviceMatchesPolicy`) reads the three tables directly and never looks at this column. `policies.company_id` is now fully vestigial, same fate as `components.company_id` after migration `0022`.

### Matching logic (`worker/src/lib/alerts.ts`)
`deviceMatchesPolicy` no longer has a `scope==='company' && companyId!==tenantId` AND-check at all — that dimension folded into the OR-list. New `fetchPolicySiteIds`/`fetchPolicyDeviceIds` helpers (same whole-table-fetch-once-per-invocation shape as `fetchPolicyGroupIds`) get threaded through the same four call sites `fetchPolicyGroupIds` already reaches (`resolveEffectiveMonitors`, `evaluateOfflineAlerts`, `reconcileOrphanedAlerts`, and `matchMonitorsForDevice` itself) — no new call sites, no change to the "fetch once per invocation, never per device" hot-path rule. A device matches a policy's targeting if `sites.size + devices.size + groups.size === 0` (unrestricted) OR `device.tenantId ∈ sites OR device.id ∈ devices OR (any of device's groups) ∈ groups` — still ANDed with the separate OS/Class check.

### Worker
- `worker/src/routes/admin/policies.ts` gained `/:id/sites` and `/:id/devices` (`GET`/`POST`/`DELETE`), mirroring the pre-existing `/:id/groups` triplet exactly — same role tiers (`technician` mutate, `readonly` view), same "POST skips `reconcileOrphanedAlerts` (widening only), DELETE calls it (can narrow)" rule. The pre-existing `/:id/groups` POST/DELETE handlers gained a `recomputePolicyScope()` call each — a real gap closed, not just new code, since they never touched `scope` before this migration (harmless when `scope` was site-only, incorrect once groups became one of three dimensions).
- `GET /v1/admin/policies` gained `siteIds`/`deviceIds`/`groupIds` (string arrays) per policy, fetched via `inArray(policyId, ids)` batch queries alongside the existing `monitors` fetch in `listWithMonitors` — same "fetch once for the whole list, merge in TS" shape that function already used for monitors, just extended to the three target tables. `siteIds` is the load-bearing one (needed by `GlobalPoliciesPage.vue`'s companyMode filter below); all three included for symmetry.
- `POST /` no longer accepts `scope`/`company_id` in the body — policies always start with zero targets (`scope: 'global'`), Targets are added via the nested routes afterward, same "create empty, then POST nested items" convention every other nested resource in this codebase already follows (Sites/Variables on Components, Monitors/Groups on Policies). `clone_from` now also copies the source's `policy_sites`/`policy_devices`/`policy_groups` rows (parity with monitors), then calls `recomputePolicyScope` rather than copying `source.scope` directly.

### Dashboard
- `PolicyFormPage.vue` — the old Scope seg-bar + single-site combobox is gone entirely. A new "Targets" section (`.tf-overlay`/`.tf-panel` flyout, copied from `JobFormPage.vue`'s markup/CSS per this codebase's duplication convention, **but with `toggleTarget()` rewritten as a flat push/remove — not Job's kind-switch-clears-others logic**) replaces both the old Scope picker and the old standalone Device Groups block. Follows the established "New-vs-existing nested resource: defer-and-batch, or hit immediately" pattern for the third time in this file (Sites/Variables, then Monitors/Device-Groups, now Sites/Devices/Groups together via one `targetItems` array keyed by a `kind` discriminator).
- `GlobalPoliciesPage.vue` — the `col-company` column (shown on the Company tab) is relabeled "Sites" and now shows a joined multi-site summary (`siteSummary()`, "+N" truncated past 2) instead of a single `tenantName(policy.companyId)` lookup. `companyMode`'s merged-view filter changed from `p.companyId === companyIdParam` to `(p.siteIds ?? []).includes(companyIdParam)`. The "Override" bulk action (clone a global policy into a company-scoped copy) changed from a single `create({scope:'company', company_id, clone_from})` call to the same defer-and-batch shape as everywhere else: `create({clone_from})` then `sites.add(newId, companyId)`.

### Verified end-to-end via `wrangler dev` + local D1 (not just type-checked)
The core OR-across-heterogeneous-kinds proof: a device group containing only device A, a policy targeting that group plus device B individually (two different kinds, zero overlap) — confirmed both A and B independently qualify, and removing the group target drops A while B (still individually targeted) keeps qualifying. Also confirmed: zero targets matches every device (regression check against the 5 seeded global policies, which collided with this test's first attempt using `disk_space` as the check type — a reminder that the *pre-existing, unrelated* same-check-type company-override dedup rule in `matchMonitorsForDevice` still applies on top of the new OR-list logic, and can look like a bug in a naive count-based test if you forget it's there); `recomputePolicyScope` flips `global`→`company`→back to `global` correctly as targets are added/removed; `clone_from` copies target rows. Full Playwright pass through `PolicyFormPage.vue` (new + edit) and `GlobalPoliciesPage.vue` (Company tab, Sites column) confirmed the UI end to end, including that switching the flyout's category dropdown away from Sites and back leaves a previously-added Site still checked — the concrete, screenshotted proof that this flyout does **not** share Job's kind-exclusive clearing behavior despite using the same CSS classes.

## Key backend routes

```
POST /v1/enroll                              Agent enrollment
POST /v1/check-in                            Agent heartbeat + command exchange
POST /v1/audit                               Agent inventory audit snapshot

GET  /v1/admin/summary                       Device counts by status/OS/class
GET  /v1/admin/tenants                       List companies
GET  /v1/admin/devices                       List devices (filterable)
PATCH  /v1/admin/devices/:id                 Edit manually-entered device metadata (currently: warranty_expires_at only)
POST /v1/admin/devices/:id/commands          Queue a command (run_script, reboot, run_audit)
GET  /v1/admin/alerts?status=active|all      Global alert state feed
GET  /v1/admin/alerts/:id                    Single alert detail (must be registered before /:id/resolve — Hono order)
POST /v1/admin/alerts/:id/resolve            Manually resolve an alert
POST /v1/admin/alerts/:id/acknowledge        Acknowledge an alert

GET  /v1/admin/policies?scope=                List policies (with monitors + siteIds/deviceIds/groupIds embedded)
POST /v1/admin/policies                      Create policy (supports clone_from=)
PATCH  /v1/admin/policies/:id                Update policy fields + enabled
DELETE /v1/admin/policies/:id                Delete policy (cascades monitors)

GET  /v1/admin/policies/:id/monitors         List monitors for a policy
POST /v1/admin/policies/:id/monitors         Add monitor
PATCH  /v1/admin/policies/:id/monitors/:mid  Update monitor
DELETE /v1/admin/policies/:id/monitors/:mid  Delete monitor

GET  /v1/admin/jobs                          List jobs (with aggregate device stats, LIMIT 200)
GET  /v1/admin/jobs/:id                      Job detail with per-device command breakdown
POST /v1/admin/jobs                          Create job (technician) — dispatches now if type=quick, or waits for the cron if type=scheduled (see "Scheduling")
DELETE /v1/admin/jobs/:id                    Retire job: cancel queued cmds, keep history (technician)
DELETE /v1/admin/jobs/:id/purge              Hard-delete job + all commands (admin only)

GET  /v1/admin/components?company_id=        Script/application component library (filter: global + sites matching that company)
GET  /v1/admin/components/store              Browse ComStore (seeded built-ins, read-only — must be registered before GET /:id)
POST /v1/admin/components/:id/clone          Clone a component (any origin) into a new origin='custom' one (copies variables + sites)
GET/POST  /v1/admin/components/:id/variables[/:vid]     Input variable CRUD (nested, independent lifecycle)
PATCH/DELETE /v1/admin/components/:id/variables/:vid
GET/POST  /v1/admin/components/:id/sites                Sites (multi-site scope) CRUD
DELETE /v1/admin/components/:id/sites/:tenantId

POST /v1/auth/login                          Local email/password login
POST /v1/auth/logout                         Revoke current session
GET  /v1/auth/me                             Current user identity
GET  /v1/auth/microsoft/login                Redirect to Entra authorize endpoint
GET  /v1/auth/microsoft/callback              OAuth callback (code exchange, group resolution)
POST /v1/auth/microsoft/exchange             Trade one-time code for a session token

GET  /v1/admin/users                         List users
POST /v1/admin/users                         Create local user
PATCH  /v1/admin/users/:id                   Update role/name/status
POST /v1/admin/users/:id/reset-password      Admin-driven password reset (local accounts only)
DELETE /v1/admin/users/:id                   Soft-disable

GET  /v1/admin/sso/providers                 List SSO providers (secret never returned)
POST /v1/admin/sso/providers                 Configure a provider
PATCH  /v1/admin/sso/providers/:id           Update config / rotate secret
DELETE /v1/admin/sso/providers/:id           Remove provider
GET/POST/DELETE /v1/admin/sso/providers/:id/group-mappings[/:mid]   Group → role mapping CRUD
GET  /v1/admin/sso/providers/:id/groups?search=      Live Entra group search (app-only Graph token)

GET/POST  /v1/admin/custom-fields[/:id]      Custom field ("UDF") definition CRUD (admin only)
GET  /v1/admin/devices/:id/custom-fields             This device's values, joined against every field definition
PATCH  /v1/admin/devices/:id/custom-fields/:fieldId  Set (upsert) one field's value for this device (technician)

GET/POST  /v1/admin/groups[/:id]                     Device Group CRUD (readonly to view, technician to mutate)
GET/POST  /v1/admin/groups/:id/members[/bulk]        Membership CRUD (single add/remove, or bulk-add for DevicesPage)
DELETE /v1/admin/groups/:id/members/:deviceId        Remove one device from a group (reconciles orphaned alerts)
GET/POST  /v1/admin/policies/:id/groups              Device Group targeting for a policy (nested, independent lifecycle)
DELETE /v1/admin/policies/:id/groups/:groupId        Remove a group target from a policy (reconciles orphaned alerts)
GET/POST  /v1/admin/policies/:id/sites               Site targeting for a policy (nested, OR'd with devices/groups)
DELETE /v1/admin/policies/:id/sites/:tenantId        Remove a site target from a policy (reconciles orphaned alerts)
GET/POST  /v1/admin/policies/:id/devices             Individual device targeting for a policy (nested, OR'd with sites/groups)
DELETE /v1/admin/policies/:id/devices/:deviceId      Remove a device target from a policy (reconciles orphaned alerts)

POST /v1/sessions                            Open a remote session (shell or tcp_tunnel), queues open_session for the agent (technician)
GET  /v1/sessions/:id/ws?role=agent|client   WebSocket upgrade, proxied to the SessionRelay Durable Object
```

## Dashboard routes

```
/                      OverviewPage
/login                 LoginPage
/sso-callback          SsoCallbackPage    (receives the Microsoft SSO redirect)
/devices               DevicesPage (filterable by ?company=<id>) — list only, row click navigates to detail page
/devices/:id           DeviceDetailPage   (?section= for deep-linking to a section, see below)
/devices/:id/change-log DeviceChangeLogPage (category tabs, date-range filter, pagination — see Device detail page below)
/groups                GroupsPage         (list only — row click navigates to edit page)
/groups/new            GroupFormPage
/groups/:id            GroupFormPage      (Add Device flyout for membership, mirrors ComponentFormPage's Add Site)
/tenants               TenantsPage
/jobs                  JobsPage
/jobs/new              JobFormPage        (create — full page form; supports ?components=id1,id2 pre-select from ComponentsPage's "Run as Job")
/jobs/:id              JobDetailPage      (detail — SVG flow diagram, devices table with per-command output expansion)
/components            ComponentsPage     (list only — stat cards, My Library / Browse Store tabs)
/components/new        ComponentFormPage
/components/:id        ComponentFormPage
/global/alerts         GlobalAlertsPage (row click → /global/alerts/:id)
/global/alerts/:id     AlertDetailPage    (Overview/Timeline/Device Alerts — new this session)
/global/policies       GlobalPoliciesPage  (list — table with expand rows)
/global/policies/new   PolicyFormPage      (create — full page form)
/global/policies/:id   PolicyFormPage      (edit — full page form)
/settings/users        UsersPage           (admin only)
/settings/users/new    UserFormPage        (admin only)
/settings/users/:id    UserFormPage        (admin only)
/settings/sso          SsoSettingsPage     (admin only)
/settings/custom-fields CustomFieldsSettingsPage (admin only — manage field definitions; per-device values live on DeviceDetailPage instead)
```
Admin-only routes carry `meta: { minRole: 'admin' }`; the router guard redirects non-admins to `/`.

## Sidebar structure (App.vue)

- **Overview** link
- **Companies** section: "All Companies" link + active-client block (appears when a company is selected via `?company=` query, persists until cleared)
- **Devices** section: Device Approvals, All, Device Groups
- **Global** section: Alerts, Policies
- **Automation** section: Jobs, Components
- **Settings** section (admin role only, `v-if="hasRole('admin')"`): Users, Single Sign-On, Custom Fields
- Sidebar footer shows the signed-in user's name/role above the Sign out button
- Resizable via drag handle (`.sidebar-resizer`); collapsible via a floating chevron button straddling the sidebar's right edge (`.sidebar-toggle-btn`, absolutely positioned relative to `.shell`) — not a topbar hamburger, see STYLE.md

Active client state: `activeClientId` ref set by watching `route.query.company`. Cleared with the × button on the client block.

## Device detail page (`dashboard/src/pages/DeviceDetailPage.vue`)

**One continuous scrollable page, not tabs.** Explicitly corrected after an initial tabs-based (`v-if`/`v-else-if`) implementation — user feedback: "it is still supposed to be one page. The links just make it quicker to navigate." Nav order: **Summary → System → Alerts → Policies → Software → Services → Memory → Storage → Network → Custom Fields → Security**. All render simultaneously as `<section :id="'ddev-sec-' + name" class="ddev-page-section">` blocks in that same DOM order; the left-nav only scrolls to and highlights a section, it never hides content. See STYLE.md for the section-separation/scroll-spy CSS+JS pattern in full.

**Change Log is no longer part of this nav** — originally matched Datto's device page nav exactly (ending in Change Log), but was un-inlined into its own dedicated page (`DeviceChangeLogPage.vue`, `/devices/:id/change-log`) once the inline section's lack of pagination/filtering became a real scaling problem (`device_audit_changes` grows unbounded, one row per detected change per audit). Reached via a "Change Log" button in the System section, matching Datto's own placement there. The `sections` array driving scroll-spy needed no other change — `setupScrollSpy`'s bottom-of-scroll special case already referenced `sections[sections.length - 1]` generically, so Security automatically became the new trailing section.

**Custom Fields was originally deferred, then shipped** — STYLE.md's device-detail-page notes previously listed UDFs among sections "skipped from the reference on purpose... 'not need it for the moment'." Built this session as its own section (values only — field definitions are managed globally, see "Custom Fields" below), placed between Network and Security to match Datto's own relative UDF placement. Security remains the last section, so the scroll-spy's generic `sections[sections.length - 1]` bottom-of-scroll reference still needed no change.

This nav shape went through two real corrections, not just the tabs→one-page one — worth knowing the history since it explains *why* the boundaries land where they do:
1. **System started as an "at-a-glance" section that also included some hardware facts** (introduced after Summary already existed) — this created real, reported duplication ("stuff is getting scattered and duplicated") once OS/Serial/BIOS/CPU/RAM ended up rendering in Summary *and* System *and* the old standalone Hardware section simultaneously. Every fact now lives in exactly one section.
2. **An intermediate fix merged the standalone Hardware section into System entirely** (removing the Hardware nav item). That merge was itself the wrong direction — Datto's actual nav keeps Memory, Storage, and Network as their **own** separate items, not folded into System. Final state: **System is chassis/OS identity only** — no RAM, no disks, no network adapters.

Data for every section is fetched eagerly once per device load (`onIdChange`'s `Promise.all([...])`), not lazily per-section-activation — there's no "activation" moment to hang a lazy fetch off now that nothing is hidden.

**Identity header**: hostname is large (22px/700), with the online/offline status dot inline before it (not on a separate meta line below), and an OS icon (currently Windows-only — a simple 2×2 square grid, not a licensed logo asset) on the header's right edge. No "approved"/OS-text meta line — that reads as clutter once the dot is inline.

**Summary section fields** — three columns (System / Identifiers / Activity), deliberately trimmed to *not* duplicate System (below):
- Populated: Company, Class, Enrolled / Device ID, Agent Version, Antivirus **status** (real check-in `av_status`, badge-styled — `.inv-badge-{ok,warn,danger,muted}`) / Last seen, Last Reboot (**derived**, `lastSeen - uptime_seconds` — no dedicated boot-time field exists), Last Audit (`auditData.createdAt`), Uptime.
- Deliberately excluded, not faked: M365 User, PSA Device ID, Network Node, SNMP Credential, Assigned Network Node, Patch Status, Software Status — none of these have any real data behind them in Beacon (no PSA/M365/SNMP integration, no patch-management feature). Don't add placeholder/fabricated values for these if asked to match a reference more closely — surface the gap instead.
- OS, Windows Version/Build, Last User, and Serial Number **used to live here too** — moved to System exclusively once the duplication above was flagged. "Approved" date was dropped per feedback (not useful at a glance); "Hostname" row was dropped (redundant with the now-large header hostname).

**System section** — a "Change Log" button sits right below the section heading, above the two-column field grid (matches Datto's own placement exactly) — navigates to `DeviceChangeLogPage.vue`, see above.

**System section fields** — two columns, no grid duplication with Summary or Memory/Storage/Network:
- Left ("System"): OS, Version (build), Display Ver. / Install Type (Windows-only, `windows_display_version`/`windows_installation_type` — no cross-platform equivalent), Architecture (`64-bit`/`32-bit`, derived from `runtime.GOARCH`), Domain (Windows-only, only shown when actually domain-joined — `Win32_ComputerSystem.Domain` returns the *workgroup* name otherwise), Last User, **AV Product** (not "Antivirus" — deliberately relabeled so it doesn't read as a duplicate of Summary's antivirus *status* badge; this is the product name instead, e.g. "Windows Defender Antivirus"), Firewall, **Warranty** (the one editable field on the whole page — see STYLE.md's inline-editable-date pattern), Services (count, links to the Services section).
- Right ("Hardware"): Manufacturer, Model, Motherboard, Serial (from BIOS), Processor, Total Physical Cores, BIOS (vendor + version), BIOS Released, Display Adapters. **No RAM, no disks, no network adapters here** — those are Memory/Storage/Network's job.
- `.NET Version`, real vendor-API warranty lookups, and a historical-metrics-over-time section (all present in the Datto reference) were evaluated and explicitly declined/deferred — see STYLE.md's device detail page entry for the reasoning on each.

**Memory / Storage / Network sections** — each a single-topic `.inv-tab-body` > `.inv-section`, no two-column grid (unlike System):
- **Memory**: Usable (`ram.total_bytes` — gopsutil's OS-visible figure) and Installed (`ram.installed_bytes` — raw physical DIMM capacity, root-only on Linux via `dmidecode`) as two rows.
- **Storage**: disks with usage bars, reusing the `.inv-disk-row`/`.inv-disk-bar-wrap` markup that used to live in the old standalone Hardware section.
- **Network**: External IP (unconditional, sourced from `device.externalIp` — set by `checkin.ts` from the check-in request's own `CF-Connecting-IP` header, migration `0023`, no agent change needed) shown above the audit-sourced adapter name/MAC/IPs list.

**Policies section** — simplified from a full per-monitor Type/Condition/Priority/Sustained breakout down to a plain Policy/Scope/Monitor-count table, click-through to the policy edit page ("it literally just needs to show all the policies applied on this machine not every policy with their monitors"). Whether Datto's separate "Monitors" nav item is this same concept under a different name, or something distinct, is an open question tabled for a future session.

## Coding patterns — Dashboard

### Reactive expand/select state
Use `reactive<Record<string, boolean>>` NOT `ref<Set>`. Vue 3 doesn't reliably track Set mutations:
```typescript
const expanded = reactive<Record<string, boolean>>({});
function toggleExpand(id: string) {
  if (expanded[id]) delete expanded[id];
  else expanded[id] = true;
}
```

### API calls in parallel
```typescript
const [devices, tenants] = await Promise.all([api.devices.list(), api.tenants.list()]);
```

### Scroll-spy nav (one-page-with-anchor-nav, e.g. DeviceDetailPage)
`IntersectionObserver` with a thin top-of-viewport detection band, rooted at `.page` (the app's real scroll container, not `window` — see STYLE.md):
```typescript
scrollSpy = new IntersectionObserver((entries) => {
  const visible = entries.filter(e => e.isIntersecting);
  if (visible.length === 0) return;
  const topMost = visible.reduce((a, b) => a.boundingClientRect.top <= b.boundingClientRect.top ? a : b);
  activeSection.value = topMost.target.id.replace('ddev-sec-', '');
}, { root, rootMargin: '-16px 0px -70% 0px', threshold: 0 });
```
Deliberately doesn't touch the URL/`route.query` on scroll — only an explicit nav-item click does that (via `router.replace`), so casual scrolling doesn't spam browser history.

**Bottom-of-scroll edge case** (found via real Playwright scroll testing, not obvious from reading the code): a short trailing section (e.g. "Change Log") can lose the "topmost visible" tie-break to a taller preceding section even once you've scrolled all the way down, because both still overlap the detection band simultaneously. Same edge case Bootstrap's own scrollspy special-cases. Fix: check `root.scrollTop + root.clientHeight >= root.scrollHeight - 2` and force the *last* section active when true — both inside the IntersectionObserver callback (covers most real scrolling) **and** in a separate `scroll` listener deferred one macrotask via `setTimeout(fn, 0)` (covers the remaining case where the final scroll increment doesn't change any element's `isIntersecting` state at all, so the IO callback never fires for it). The `.page` element is the app-wide persistent scroll container (outlives any one page component across navigations) — remove the `scroll` listener explicitly in `onUnmounted`, don't rely on the component unmounting to clean it up.

### Policy list includes monitors
`GET /v1/admin/policies` returns `Policy[]` where each policy has a `.monitors` array already embedded. No second round-trip needed.

### New policy flow (PolicyFormPage)
1. Monitors accumulate in local `ref<LocalMonitor[]>` — no API calls until Save
2. On Save: POST policy → loop POST each monitor → navigate back
3. For edit: monitor add/edit/delete hit API immediately; policy field save is deferred to Save Changes button

### New-vs-existing nested resource: defer-and-batch, or hit immediately
The general form of the pattern above, now established across five independent instances (`ComponentFormPage.vue`'s Sites and Variables, `PolicyFormPage.vue`'s Monitors and Device Groups, `GroupFormPage.vue`'s Members) — reuse this shape rather than re-deriving it for the next nested many-to-many relationship:
- **On a `/new` page** (`isNew.value` true, no parent id yet): every add/remove/edit of the nested items is a purely local array mutation, zero API calls. On Save: POST the parent first, then loop the accumulated local items into their own `POST`s, then navigate away.
- **On an edit page** (`isNew.value` false, real parent id in hand): every add/remove/edit of a nested item hits its own API endpoint immediately — no separate "Save" step for that sub-resource, since there's already a stable parent id to attach it to.
- A `removeAll`-style bulk action still loops individual `DELETE`s in this convention (best-effort — swallow per-item errors and keep clearing locally) rather than requiring a dedicated bulk-delete endpoint, since these lists are small (self-hosted scale).

### Add-item flyout (multi-select, stays open across picks)
The `.sf-overlay`/`.sf-panel` right-side flyout (search + per-row Add/Remove toggle) originated in `ComponentFormPage.vue`'s Sites section and is now a proven, generalized pattern — reused verbatim (same CSS class names, duplicated per this codebase's convention) in `GroupFormPage.vue` (picking devices) and `PolicyFormPage.vue` (picking Device Groups). Full markup/CSS/behavior documented in STYLE.md — copy that, don't re-derive it, for the next "pick several of X for this record" UI.

### Adding a new check_type to the Add Monitor drawer (PolicyFormPage)
Established over 6 check types added this session — each one touches the same ~9 spots, always in this order:
1. `checkTypeOptions` entry (icon + label)
2. `LocalMonitor` interface — new fields prefixed by check type (e.g. `pingTarget`, `pingCount`)
3. `monPanel.form` defaults, `openAddMonitor()` reset, `openEditMonitor()` populate
4. `buildConfig()` — maps form fields → the JSON `config` blob
5. `onMounted`'s config-parse block — maps `config` blob back → form fields (mirror of #4)
6. A `xSummary(m)` helper + its case in `monitorSummaryLocal()`'s switch
7. Matching `checkLabel`/`monitorSummary` cases in `GlobalPoliciesPage.vue` (same summary logic, duplicated by design — not shared, matches this file's existing duplication convention)
8. A new `.chip-{type}` CSS color in both `PolicyFormPage.vue` and `GlobalPoliciesPage.vue` — check existing chips before picking a color, the palette is now 10 colors deep (see STYLE.md)
9. New UI block (`v-if="monPanel.form.checkType === 'x'"`) inserted before the shared `mf-pair` (period/interval/priority)

**Type-specific side effects on switching type**: the type-card click handler is `selectCheckType(ct)`, not an inline `@click` assignment — use it to force config field values that don't make sense for a given type (e.g. `software` forces `sustainedMinutes = 0` and `autoResolve = false` when selected, since that type doesn't support either).

**Optional numeric fields use a checkbox that toggles `null`, not a separate boolean flag**: e.g. ping's packet-loss/latency conditions —
```html
<input type="checkbox" :checked="form.x !== null" @change="form.x = ($event.target as HTMLInputElement).checked ? DEFAULT : null" />
<div v-if="form.x !== null"><input v-model.number="form.x" .../></div>
```
`null` in the saved config means "this condition is disabled," not zero.

**Hiding shared fields that don't apply to a type**: wrap the irrelevant fields in `<template v-if="...">` inside `mf-pair` rather than hiding the whole block, since e.g. `software` hides period+interval but still needs the priority selector alongside them in the same flex row.

## Commit rules

- No `Co-Authored-By` or Claude attribution lines in commits
- Do not add AI-generated co-author footers

## License

AGPL-3.0 (see `LICENSE` — added via GitHub's license template picker, not generated inline, since generating the full license text in-session reliably trips the content filter).
