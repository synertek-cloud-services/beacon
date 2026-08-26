# Beacon — CLAUDE.md

Self-hosted RMM platform, originally built for Synertek Cloud Services (developed by CodeNexus), now open-sourced under AGPL-3.0. Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard. See `README.md` for the human-facing overview and self-hosting quick start — this file is the AI-assistant-facing architecture/convention reference.

For current session-by-session status, recent decisions, and the full development history behind anything summarized here, see `PROJECT_LOG.md`. **This file states current architecture and behavior only — it is not a changelog.** When a feature below reads as settled, its "how we got here" (bugs found, real-hardware sagas, superseded designs) lives in PROJECT_LOG.md under the matching feature heading, not here.

**Terminology**: what the schema/API calls "Company" (`companies` table, `company_id` FK — renamed from `tenants`/`tenant_id`) is a client of the MSP running Beacon. "Location" (`company_locations`, née `tenant_locations`) is a lightweight address/contact sub-record under a Company — an office, not a scoping concept. Devices, Policies, Jobs, etc. all scope directly to **Company**, never Location. The many-to-many *targeting* tables (`policy_companies`, `component_companies`, `dashboard_companies`, `maintenance_policy_companies`, `patch_policy_companies`) and the "Add Company flyout" UI pattern built on them were renamed from `*_sites`/tenant-era names in a follow-on pass. `.sf-*`/`.tf-*` remain the CSS class *prefixes* for these flyouts (unrenamed — arbitrary, non-semantic short codes, not worth touching).

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations, sequential from 0000
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
make migrate-remote    # apply pending migrations to production D1
make db-generate      # regenerate Drizzle schema types
make type-check       # tsc --noEmit
```

### Dashboard (Vue 3 / Vite)
```bash
cd dashboard
pnpm dev              # local dev server on :5173
pnpm run build        # type-check + vite build
```
CI/CD: `.github/workflows/release.yml` runs after a PR merges to `main` and
releases in order: D1 migrations, Worker, dashboard Pages, health check. Pages
automatic production deployment must remain disabled so it cannot race ahead
of this workflow. Root dir: `dashboard`, build command: `pnpm run build`,
output: `dist`.

**Local full-stack testing gotchas**:
- `dashboard/vite.config.ts` already proxies `/v1` → `http://localhost:8787` — for local `pnpm dev` + `wrangler dev` testing, **don't** set `VITE_API_URL` (leave it unset so `api.ts`'s `baseUrl` stays `''`/relative). Setting it directly makes the browser issue cross-origin fetches the worker's CORS allowlist (hardcoded to exactly `http://localhost:5173`) will reject.
- To manually fire the cron locally (needed to test anything in `scheduled()`): `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` against a plain `wrangler dev` — no `--test-scheduled` flag needed.
- A backgrounded `wrangler dev` from an earlier session can be left listening on 8787 while hung (accepts the TCP connection, never responds) — looks like "port busy" rather than "nothing's listening." Check `ss -ltnp | grep 8787` and kill the stale process tree first.
- **`cd dashboard && npx vue-tsc --noEmit` alone can silently check zero files and report false success** — `tsconfig.json` is a solution-style config (`"files": []` + `"references"`), and plain `--noEmit` doesn't reliably walk project references. Use `vue-tsc -b` (build mode, matching `package.json`'s own build script) — that's what actually type-checks. Clear `node_modules/.tmp/*.tsbuildinfo` first if results look suspicious.

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
| `CONFIG_ENCRYPTION_KEY` | `worker/.dev.vars` (gitignored) — AES-GCM key (hex) encrypting SSO/email provider secrets at rest |
| `CLOUDFLARE_API_TOKEN` | direnv `.envrc` (gitignored) |
| Ed25519 private key (agent signing) | Password manager only |

`worker/.dev.vars` already has `ADMIN_SECRET="beacon-local-admin-secret"`, a `CONFIG_ENCRYPTION_KEY`, and `WORKER_URL="http://localhost:8787"` for local dev.

`ADMIN_SECRET` is compared via `worker/src/lib/auth.ts`'s `requireAdmin`/`timingSafeEqual` (hash-then-compare, not `===`) — reachable only through `requireUser` (see Auth System below) as the break-glass fallback path. Never add a new inline `auth === \`Bearer ${secret}\`` check; every route goes through `requireUser`.

## Self-hosting config (not secrets, but org-specific — gitignored with `.example` templates)

`worker/wrangler.toml` and `dashboard/.env.production` are gitignored (real values are Synertek's own domain/D1 database). Tracked `.example` counterparts hold placeholder values for self-hosters. `[[r2_buckets]]` (`LOGOS`, `COMPONENT_FILES`, `SESSION_FILES` bindings) needs R2 enabled on the account and each bucket created via `wrangler r2 bucket create <name>` before `wrangler deploy`/`--remote` migrations resolve them — local `wrangler dev` auto-emulates R2. `worker/wrangler.toml`'s `[vars]` block (`ALLOWED_ORIGIN`, `PAGES_PREVIEW_SUFFIX`) drives the CORS allowlist in `worker/src/index.ts` — don't hardcode a domain back into `index.ts`. `[vars]` also holds `WORKER_URL` (this worker's own public origin) — a deliberately configured value, not derived from the incoming request's URL, since a `[[routes]]` custom-domain block makes `c.req.url` reflect the production route even under `wrangler dev` (previously caused local remote-shell sessions to dial the real production worker — see PROJECT_LOG for the incident).

## Production URLs

| Service | URL |
|---|---|
| Worker API | `https://rmm-api.cloud.synertekcs.com` |
| Dashboard | `https://rmm.cloud.synertekcs.com` |
| Pages previews | `*.beacon-dashboard-6f4.pages.dev` |

## Architecture

The current per-capability Windows/Linux/macOS beta support contract and the
repeatable real-system promotion checklist live in
`docs/BETA_PLATFORM_SUPPORT.md`. A successful cross-compile is not evidence of
platform support. Keep unavailable and unvalidated capabilities labeled
honestly rather than inferring parity from shared Go code.

**Worker** (`worker/src/`)
- Framework: Hono on Cloudflare Workers
- Database: Cloudflare D1 (SQLite) via Drizzle ORM (`worker/src/db/schema.ts`)
- Cron: runs every 2 minutes (`*/2 * * * *`) — evaluates offline alerts and dispatches every scheduled/recurring worker (Jobs, Patch Policy, Discovery, Windows/Microsoft Update management)
- Durable Object: `SessionRelay` for shell/TCP-tunnel/screen-share sessions — see "Remote Shell" and "Web Remote" below
- All admin routes under `/v1/admin/*`, `/v1/auth/*`, and `/v1/sessions*` require `Authorization: Bearer <token>` — either a real user session token or the `ADMIN_SECRET` break-glass token, resolved by `requireUser` (see Auth System below)
- CORS allows: production domain, localhost:5173, `*.beacon-dashboard-6f4.pages.dev` — enabled per route prefix in `index.ts`

**Agent** (`agent/`)
- Module: `github.com/synertek-cloud-services/beacon/agent`
- Check-in interval: 60 seconds, dynamic — see "Fast Poll" below (temporarily 15s per-device when a technician is actively working a device)
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, disks[] (multi-drive), cpu_percent, memory_percent, detected_class, av_status, av_product
- Check-in also carries `pending_{file_size,ping,process,service}_results`; response carries `{file_size,ping,process,service}_checks` — see "Assign → measure → report pattern" below
- Audit (full inventory snapshot) fires 5 min after startup, then every 24h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them) — extending the check-in wire protocol at all is treated as a last resort, not a default: a wire-field rename once broke check-in fleet-wide (see PROJECT_LOG), and most later features (Network Discovery, Patch Policy, Windows/Microsoft Update management) deliberately dispatch through the existing one-shot `commands` table instead of adding new `CheckInRequest`/`CheckInResponse` fields.
- Internal packages worth knowing: `diskutil`, `filesize`, `pingutil`, `procutil`, `svcutil` (shared Two-Tier Policy check helpers), `wuinstall`/`auconfig`/`muconfig` (Patch Management), `wingetupdate` (Software Management), `discovery` (Network Discovery), `rfb`/`rfbserver`/`screencapture`/`screeninject`/`win32`/`x11keysym` (Web Remote), `usersession` (below).
- `agent/internal/usersession` (Windows-only, `_other.go` no-op stub elsewhere) — the primitive that lets the SYSTEM-context agent service launch/act as a real logged-in user's session. `RunAsSession(sessionID, exe, args)` (general form) / `RunAsActiveUser` (console-session convenience wrapper) launch a process in a given session via `WTSQueryUserToken` → `DuplicateTokenEx` → `CreateEnvironmentBlock` → `CreateProcessAsUser`. `ActiveSessions()`/`ActiveSessionDetails()` enumerate every active session (`WTSEnumerateSessions`), which is what makes RDS/AVD/Windows 365 targeting possible (console-only misses all three — AVD/Windows 365 have no console session at all). `RunAsSessionAsSystem` relocates the agent's own SYSTEM token into a target session (used by Web Remote's Elevate, see below). `RunAsSessionElevated`/`RunAsSessionWithCredentials` (split-token / `LogonUserW`-based elevation) exist but are **no longer used by anything** — superseded by the SYSTEM-relocation approach; kept in the package as working primitives. `ErrNoActiveSession` is the expected, common no-op case (no console login yet). **Locking the screen does not trigger a session change** — `WTSQueryUserToken` still succeeds against a locked session; a launched process just sits behind the lock screen until unlock. Verified on real hardware: the core impersonation/launch path, multi-session targeting, and SYSTEM relocation all confirmed working.
- `agent/cmd/beacon-tray` (Windows-only, embedded into the agent binary via `//go:embed`, extracted/launched per active session by `agent/internal/service`'s `EnsureTrayRunning()`) — a `fyne.io/systray`-based tray icon, launched into every active session (RDS/AVD/multi-session aware) via `usersession`. Shows version, a "Visit Dashboard" link (when `--dashboard-url` is set — currently never, since the agent doesn't know the dashboard's origin) and a "Get Support" link (when `support_url` is configured — see Branding's Identity subsection). Polls `agent/internal/rebootmarker`'s `pending-reboot.json` every 30s and shows a Restart Now/Postpone `MessageBox` when a patch install left `RebootRequired` true (the *agent's* check-in loop performs the actual `shutdown /r /t 0`, matching the "agent always does the privileged action" pattern). Every tray launch carries a `--restart-after=10m` flag — the tray exits itself on that timer and the service's existing 60s liveness reconciliation launches a fresh, unflagged replacement, forcing a clean `Shell_NotifyIcon(NIM_ADD)` periodically to self-heal a real, recurring Explorer-taskbar-registration race (`WTS_SESSION_LOGON` can fire before Explorer's own taskbar window exists) that a one-shot recovery attempt was proven on real hardware not to fully cover. A `dialogActive` atomic flag makes a pending restart skip (not block) while the reboot-confirmation dialog is on screen. `service.Install()`/`Uninstall()`/`SelfUninstall()` all `taskkill /IM beacon-tray.exe /F` before removing the install directory (a running tray process's file lock otherwise blocks removal). Verified end-to-end on real hardware including the multi-session, blank-icon-recovery, and duplicate-icon-on-update cases; full history of the recovery-mechanism iterations (one-shot → periodic → bounded 10-minute interval) is in PROJECT_LOG.
- `setupLogging` (`agent/cmd/agent/main.go`, mirrored in `agent/cmd/beacon-screenshare`) opens `agent.log`/`beacon-screenshare.log` synchronously once, then retries every 5s indefinitely in the background on failure (never gives up) — a `MultiWriter(file, os.Stderr)` with the file sink listed *first*, since `MultiWriter` short-circuits on its first writer's error and a headless service's invalid `os.Stderr` handle was silently blacking out all logging otherwise. This was the root cause of several "process is definitely running but its log is completely silent" mysteries across earlier sessions (see PROJECT_LOG for the multi-attempt history).
- `agent/internal/audit/hardware.go` collects: BIOS serial number, last-logged-in-user, architecture, system manufacturer/model/motherboard, display adapters, installed (physical DIMM) vs. usable RAM, domain/Windows display version/installation type (Windows-only), virtualization/hypervisor-guest detection, and `ConsoleUserCanElevate`/`HypervisorHost` (nil = never evaluated, never a false negative from a transient failure). All ride the existing `hardware` audit JSON blob — no migrations needed.
- `agent/internal/updater/` (self-update) — checks `/v1/agent/version` every 24h after a 5-minute initial stagger; writes `<credDir>/update-state.json` on a successful update and hands off to `awaitConfirmation` on next start, which must fall through to `runLoop` again once resolved.
- `agent/internal/session/` — handles `open_session` commands. `session.go` dials the relay WS and switches on `session_type`; `tunnel.go` is a raw byte pump for `tcp_tunnel`; `shell.go` spawns a persistent PTY-backed shell (`pty_unix.go`/`pty_windows.go`, real build-tag-separated files since the Windows ConPTY library needs Windows-only packages); `screenshare.go` dispatches `screen_share` (Web Remote) sessions — see below.

### Agent release process (`scripts/publish-agent.mjs`)

One self-contained script: derives the public half of a host-controlled Ed25519 private key, linker-embeds it into all 5 platform/arch binaries, creates the GitHub release and uploads binaries, rejects any signing-key/public-key mismatch, re-downloads and verifies the public assets, registers them with the Worker, and verifies the unauthenticated Worker version/download path returns the exact hosted bytes. `BEACON_SIGNING_KEY_FILE` (mode `0600`) is preferred over legacy `BEACON_SIGNING_KEY`. Also needs `BEACON_WORKER_URL`, `BEACON_ADMIN_SECRET`, an authenticated `gh` CLI, and optionally `BEACON_RELEASE_REPOSITORY`. The selected GitHub repository must be public. **Run from the repo root.**

```bash
export BEACON_SIGNING_KEY_FILE=/secure/path/beacon-agent-signing.key
export BEACON_WORKER_URL=https://beacon-api.example.com
export BEACON_RELEASE_REPOSITORY=owner/public-beacon-repository
export BEACON_ADMIN_SECRET
node scripts/publish-agent.mjs <version>
unset BEACON_ADMIN_SECRET
```

Published version assets are immutable: a same-version retry verifies identical hosted bytes and skips an identical current catalog entry, but never clobbers or duplicates. `agent/internal/releasekey.PublicKeyHex` owns the upstream default, replaced with `-X` for a host-controlled release. Both `tools/sign`/`tools/verify` consume that same value. Signing-key continuity is an operator contract — existing agents only accept releases signed by the private half of their embedded public key; there's no automatic key rotation.

**`git status` showing `agent/internal/service/embedded/beacon-tray.exe` and `agent/internal/session/embedded/beacon-screenshare.exe` as modified at the start of a session is expected, not a mystery.** The script's pre-build step rebuilds both files in place (plain `go build`) every run but never commits them — the only things that ever modify this repo are Claude sessions and this script (run directly by the user). Just commit them (low-risk, no PR needed) the same session they're noticed.

## Database

Migrations live in `migrations/` (not inside `worker/`). Drizzle points there via `wrangler.toml`. When adding a schema change:
1. Add a new migration file `migrations/XXXX_description.sql`
2. Hand-update `worker/src/db/schema.ts` to match (do not run `make db-generate` — `migrations/meta/_journal.json` only tracks through migration `0003`, so generating now would diff against a stale snapshot)
3. Run `make migrate-local` to test locally
4. Merge the approved PR and let the release workflow apply migrations before deploying the Worker and dashboard (self-hosters run migrations manually before their own deploy)

Latest migration: `0081` (`RATE_LIMIT` fields on `alert_state`, see Alert Notifications' rate-limiting subsection). Check `migrations/` directly for the full ordered list; PROJECT_LOG.md has the session-by-session story for anything not covered here.

`worker/src/db/schema.ts` is hand-kept in sync with the migrations rather than generated.

### Backup and recovery

`docs/BACKUP_RECOVERY.md` is the operator contract. D1 is the authoritative
persistent state; R2 currently holds the active branding logo plus transient Component/session-file blobs; `SessionRelay` has no durable state. The exact `CONFIG_ENCRYPTION_KEY` and agent signing key are irreplaceable recovery material.

`scripts/backup-d1.mjs` creates both original exports plus a migration-schema-clear, parent-first, large-row-safe restore file — a raw Wrangler export is **not** proven restorable on its own (foreign-key table ordering and an oversized audit `INSERT` blocked a real hosted restore drill). Restore at the manifest's source commit in isolated resources, validate there, apply newer migrations afterward. Before reconnecting agents, explicitly expire or accept restored queued work so stale commands cannot replay accidentally.

## Auth System

Multi-user auth: local accounts + Microsoft Entra ID SSO, global RBAC (no per-company scoping — Beacon's users are internal MSP staff).

### Roles
`admin` > `technician` > `readonly` (`worker/src/lib/auth.ts`'s `ROLE_RANK`/`roleAtLeast`). Convention: GET/list → `readonly`; routine mutations (approve device, run job, resolve alert, edit policy) → `technician`; identity, secrets, host-wide config, shared dashboards/branding, fleet agent-release registration → `admin` only. `docs/AUTHORIZATION.md` is the concise route-family matrix and redaction contract.

### `requireUser` (`worker/src/lib/auth.ts`)
Every `/v1/admin/*` and `/v1/sessions` route calls `requireUser(c.req.header('Authorization'), c.env, minRole)`. Accepts either `Bearer <ADMIN_SECRET>` (break-glass, synthetic admin identity, never surfaced in the UI) or `Bearer <session token>` (opaque random token, hashed and looked up in `user_sessions` joined to `users` — not a JWT, chosen so logout/disable/role-change take effect on the very next request with no denylist). `user_sessions.last_used_at` only bumps when stale by more than 5 minutes.

### Local auth routes (`worker/src/routes/auth.ts`)
`POST /v1/auth/login` (email+password, generic error either way), `POST /v1/auth/logout`, `GET /v1/auth/me`.

### Microsoft Entra ID SSO (`worker/src/lib/oidc.ts`, `worker/src/routes/auth-microsoft.ts`)
Admin maps one or more Entra security groups to a Beacon role via `/v1/admin/sso/providers` + nested `/group-mappings` (client secret AES-GCM-encrypted at rest — the one place a secret is decrypted back to plaintext, since it must be sent to Microsoft's token endpoint). PKCE + a `state` row in `sso_login_state` drives the redirect; the callback verifies the ID token via `jose`, then **always** calls Graph `GET /me/transitiveMemberOf` (not `/me/memberOf` — misses nested groups, the norm in real tenants) for group membership rather than the ID token's own `groups` claim (only populated below ~200 direct-membership groups anyway). Zero matching mappings rejects the login with no user created; multiple matches pick the highest-privilege role; role is re-resolved on every login. The callback hands the SPA a one-time exchange code via redirect (`POST /v1/auth/microsoft/exchange` trades it for the real token) so the session token never appears in a URL.

**Entra app registration**: redirect URI `<worker-url>/v1/auth/microsoft/callback`; two Graph permissions, both needing admin consent — `GroupMember.Read.All` (Delegated, login-time) and `Group.Read.All` (Application, used by the group-search feature below via client-credentials).

**Group search** (`GET /v1/admin/sso/providers/:id/groups?search=`, admin-only) — searches real Entra groups by display name via `getAppOnlyGraphToken()` (client-credentials) + Graph `/groups?$search=` (`ConsistencyLevel: eventual` header required). Falls back to manual Object ID entry if search fails.

Google Workspace is deferred (v2) but `sso_providers.type` and the group-mapping tables are provider-generic.

**Password hashing runtime limit**: `worker/src/lib/password.ts`'s PBKDF2 iteration count is capped at 100,000 — Cloudflare Workers' real edge `crypto.subtle` throws `NotSupportedError` above that, a limit that doesn't reproduce in local `wrangler dev`.

### Dashboard side
`dashboard/src/auth.ts` is a small `reactive` current-user singleton (no Pinia) — `loadCurrentUser()` calls `/v1/auth/me`, `hasRole(min)` gates nav/routes. `dashboard/src/api.ts`'s `request()` clears the token and hard-redirects to `/login` on any 401 outside a login attempt.

`App.vue` (the persistent root shell) fetches sidebar data (companies, pending-approval count, dashboards) once in `onMounted` — since it never remounts across client-side navigation, a `beacon:auth-changed` window event (dispatched by both login paths right after `saveToken`) re-triggers that fetch so the sidebar populates on a real login, not just a full page reload. Both login paths land on `/` (the home-dashboard redirect), not a hardcoded `/devices`.

### Remote-session WS auth
`worker/src/routes/sessions.ts`'s shell/tunnel/screen-share WebSocket authenticates its client leg with a per-session random token (hashed into `sessions.client_auth_hash`), checked directly as a query param — not via `requireUser`, since technicians (who never hold `ADMIN_SECRET`) also open sessions.

### Login page (`dashboard/src/pages/LoginPage.vue`)
Adaptive: `GET /v1/auth/microsoft/available` decides whether to open into the Microsoft button or local email/password by default; either mode can switch to the other. **Emergency administrator access** is a third, de-emphasized mode reusing `requireUser`'s `ADMIN_SECRET` break-glass path with zero new backend surface (`verifyEmergencyAccess()` just calls `GET /v1/auth/me` with the secret and checks 200) — stored in `sessionStorage`, not `localStorage`, cleared on browser close, and mutually exclusive with the normal token (each save clears the other's storage key).

## Branding (host-configurable color themes)

Host-level color theming — a self-hoster can rebrand Beacon's 16-token dark color system without a code change: built-in presets plus fully custom host-created palettes. Migrations `0033`–`0037`, `0045`, `0073`.

### Tables
- `branding_themes` — `id`, `name`, `source` (`'built_in'|'custom'`), `draft_tokens` (JSON, the 16 `ThemeKey`s), timestamps. `source='built_in'` rows are immutable at the API layer (`PATCH`/`DELETE` 403).
- `branding_theme_revisions` — `id` (`<theme_id>-v<revision>`), `theme_id` FK cascade, `revision`, `tokens` snapshot, `published_at`. Custom themes only.
- `branding_settings` — singleton (`id=1`), `active_theme_id` FK, `active_revision_id` FK **nullable** — set only when the active theme is custom (`NULL` for built-in, which has no revision concept).

### Draft / publish / revision lifecycle (custom themes only)
A custom theme has one freely-`PATCH`-editable **draft** and up to `MAX_PUBLISHED_REVISIONS = 5` immutable **published revisions**. `POST /:id/publish` snapshots the draft into a new revision, then prunes down to 5 — never pruning the currently-active revision even if it's aged out of the most-recent-5 window. Activating a theme (`POST /admin/revisions/:id/activate`) points at one specific revision, enabling rollback and keeping `GET /v1/branding/revisions/:id` safely `immutable`-cacheable.

### Token set
16 fixed keys (`worker/src/routes/branding.ts`'s `THEME_KEYS`, mirrored in `dashboard/src/theme.ts`): `canvas, surface, surfaceRaised, surfaceBrand, border, borderStrong, textPrimary, textMuted, textSubtle, textOnPrimary, primary, primaryHover, success, warning, danger, info`. Server-side `parseTokens()` requires all 16, strict `#rrggbb` hex, no partial-palette merge. `dashboard/src/style.css`'s `:root` tokens are a 1:1 rename to match (see STYLE.md's Design tokens table) — necessary because live re-theming overwrites these exact custom properties at runtime.

### Worker (`worker/src/routes/branding.ts`, mounted at `/v1/branding`)
- `GET /active` (public, `no-store`) — built-in: `{themeId, name, tokens}` directly; custom: `{revisionId, themeId, name, revision, publishedAt}`, tokens fetched via a second call.
- `GET /revisions/:id` (public, `immutable` cache) — a custom theme's real `tokens`.
- `GET/POST/PATCH/DELETE /admin/themes[/:id]`, `.../publish`, `.../activate` (built-ins only), `POST /admin/revisions/:id/activate` (custom only) — admin-only, matching Settings-tier role.
- Delete guard: a theme can't be deleted while active (409).

### Dashboard (`dashboard/src/theme.ts`, `dashboard/src/pages/BrandingSettingsPage.vue`)
`loadActiveTheme()` runs once before `createApp(App).mount()` — applies a hardcoded default synchronously first, then fetches `/v1/branding/active` (+ revision if needed) with a 2.5s `AbortController` timeout, swallowing failure silently. **Login must never be held hostage by branding.** `BrandingSettingsPage.vue` (`/settings/branding`, admin-only) previews a theme selection live against the whole running app (`watch(draft, ..., {flush:'sync'})`, not just a swatch); "Save Draft" persists without publishing, "Publish" snapshots+prunes, only Activate changes what other users see. Inline WCAG contrast warnings are advisory only.

### Seeded built-ins
Default (v2, from `0036`), Sentry-i, Cobalt2-i, SyntaxFM-i, Slate — complete, immutable 16-token palettes, labeled inspired-by/adapted-from rather than implying endorsement.

### Identity (product name + logo + support URL)
- `branding_identity` — singleton (`id=1`), separate from `branding_settings` (different concern/lifecycle). Columns: `product_name` (`''` = falls back to "Beacon"), `logo_key` (nullable R2 key), `support_url` (nullable), `updated_at`.
- First file-upload feature in this codebase — `LOGOS` R2 bucket. `POST /v1/branding/admin/logo` (admin) takes a raw binary body (`Content-Type` carries mime, allow-list `image/jpeg|png|gif|svg+xml`, 1MB cap). Writes a fresh `crypto.randomUUID()` key, updates `logo_key`, **then** deletes the previous R2 object — put-then-commit-then-delete-old, so a mid-failure never leaves zero valid logos.
- `GET /v1/branding/logo/:key` (public, `immutable`) streams the R2 object through. `GET /v1/branding/identity` (public, `no-store`) is the pointer.
- `dashboard/src/brand.ts` — a `reactive` singleton mirroring `auth.ts`'s shape, loaded pre-mount in parallel with `loadActiveTheme()`. Always sets both `productName`/`logoUrl` unconditionally (falling back to defaults when unset), not just when truthy — a cleared value must actually revert, not persist stale.
- Only a single Product Name field (no separate Company Name) — confirmed Beacon has exactly one real UI surface to drive.
- **Support URL** (migration `0073`, issue #90) — the tray's "Get Support" destination, used verbatim with zero query-param injection (no device_id/hostname/company appended). Deliberately delivered via the agent's own independent poll of the already-public `GET /v1/branding/identity` inside its 60s loop (`agent/internal/protocol/client.go`'s `BrandingIdentity()`, its own 30s-timeout client), **not** a `CheckInResponse` extension — `support_url` is one-way config with nothing to report back, the worst-fit case for that wire protocol per the standing rule above. `service.SetSupportURL()` mirrors `SetAgentVersion`'s package-level-state shape; `EnsureTrayRunning()` appends `--support-url=` per session, same eventually-consistent propagation as the agent version string. Server-side, `PATCH /v1/branding/admin/identity` rejects anything that doesn't parse as `new URL(...)` with an http(s) protocol — validated before storage since it's later shelled out as a literal `cmd /c start "" <url>` argument.
- Two static default-logo assets (`dashboard/public/`): `favicon.svg` is a full, self-contained app icon (baked-in background/glow) used as the literal browser favicon; `brand-mark.svg` is a transparent-background crop of just the flame, used everywhere a themed background box already exists (sidebar, login, SSO callback). If replaced, regenerate both.

## Shared Dashboards

Host-wide, admin-configurable dashboards replacing the old fixed `OverviewPage` (migration `0039`).

### Tables
- `dashboards` — `id`, `name`, `sort_order`, `is_home` (bool, exactly one at a time — enforced procedurally: setting one clears every other row's flag in the same batch), timestamps.
- `dashboard_companies` — `(dashboard_id, company_id)` composite PK, cascade delete. Zero rows = unscoped (shows all companies).
- `dashboard_widgets` — `id`, `dashboard_id`, `type` (fixed `WIDGET_TYPES` set, bare TEXT — no migration needed to add one), `title` (nullable override), `config` (JSON), `grid_x/y/w/h` (12-column grid, `1<=w<=24` for `h` — raised from an original `12` cap once a real resize drag exposed the seeded template's own `h:14` widget already exceeding it).

### Templates
`TEMPLATES` (`blank`, `default` — 8 pre-arranged widgets) is an in-code constant copied into a fresh `dashboards` row on `POST /` — no template table/FK, a created dashboard is immediately independent. At least one dashboard must always exist; deleting the home dashboard promotes the next by `sort_order`.

### Routing and data fetching
`/` → `DashboardHomePage.vue` (redirect shim to the `isHome` dashboard, or the first). Real content lives at `/dashboards/:id`. `GET /v1/admin/dashboards/:id/data` calls `buildDashboardData()` once per dashboard (one batched query for every widget, `?company_id=` override wins over saved scope), refreshed client-side every 30s. Returns three top-level keys: `summary` (aggregate counts, including `by_patch_severity`), `alerts` (raw list, client-aggregated), and `devices: DashboardDeviceRow[]` (raw per-approved-device rows — `id, hostname, company_id, class, uptime_seconds, pending_reboot_required` — the shape `reboot_required`/`long_uptime` widgets need, since their per-widget-instance threshold config can't be pre-aggregated server-side).

### Widget library (V1, real data only)
`device_summary`, `online_offline`, `os_distribution`, `class_distribution`, `antivirus_status`, `offline_by_type`, `alerts_by_priority`, `recent_alerts`, `patches_by_severity`, `reboot_required`, `long_uptime`. The last two are single-stat tiles (not donuts) with a "Review →" link to `/devices?ids=<comma-separated ids>` — the widget's own exact client-computed match set, a reusable generic pattern any future single-stat widget can reuse. `long_uptime` is the first real consumer of `dashboard_widgets.config` (`PATCH .../widgets/:id`, admin-authenticated, loosely validated) via a gear-icon settings modal. Explicitly out of scope: M365 widgets (no integration), iframe/arbitrary-query/presentation/cycling widgets (RBAC and data stay inside Beacon).

### Grid engine: gridstack.js
Replaced a hand-rolled CSS Grid + native HTML5 drag system that had no collision detection/auto-compaction and couldn't resize height. `DashboardPage.vue` owns grid mechanics; `dashboard/src/components/DashWidget.vue` owns per-widget-type content rendering (gridstack-vue's `<GridStack :components="{...}">` maps type strings to real Vue components). Shared, independently-changing state (`data`, `editing`) is `provide`/`inject`ed rather than passed as gridstack node props (props only flow through gridstack's own lifecycle, not Vue reactivity). `options.children` **is** re-read on every `updateOptions()` call (`grid.load(children)` when non-empty) — `dashboard.value.widgets` must be kept in sync locally on every mutation (drag/resize/add/remove), not just server-persisted, or the very next unrelated options change (e.g. toggling edit mode) snaps everything back to stale positions. `cellHeight: 20` (not `8`, ported-then-corrected from the old CSS Grid system's `row-gap`-inclusive height model). Verified end-to-end via Playwright against local `wrangler dev`; `float` vs `float:true` gap behavior and mobile/narrow-viewport responsive columns are unresolved product-feel questions, not bugs.

## Two-Tier Policy / Monitor System

**policy → monitor** hierarchy. The old flat `alert_definitions` table is gone.

### Tables
- `policies` — scope (`global`/`company`, now derived — see Policy Targeting below), OS/class targeting (JSON arrays), enabled flag.
- `policy_monitors` — check_type, config (JSON, shape varies), alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes, notify_webhook, notify_email.
- `alert_state` — per (device, policy_monitor): condition_first_seen, is_alerting, alerted_at, resolved_at, plus rate-limit fields (see Alert Notifications).

`check_type` is bare `TEXT`, no `CHECK` constraint — a new check type is a TS-enum-only change (`schema.ts`, `routes/admin/policies.ts`'s `VALID_CHECK_TYPES`, `dashboard/src/api.ts`), no migration.

### Check types
Eleven check types across four evaluation shapes:

**A. Sampled every check-in (60s), against `Metrics` directly**: `disk_space` (`{drive, threshold_type, threshold_value, min_disk_gb}`), `cpu_usage` (`{percent_max}`, `>=`), `memory_usage` (`{percent_max}`, `>=`), `av_status` (`{av_state}`, key `av_status:${av_state}` allows 3 sub-monitors per policy).

**B. Cron-evaluated (every 2 min)**: `offline` (`{direction: 'offline'|'online', offline_after_seconds}` — offline = silent-past-threshold, online = continuously-checking-in-for-`sustained_minutes` with a 5-min presence grace).

**C. Agent-measured — "assign → measure → report"** (see below): `file_size`, `ping` (bundles all 3 Datto conditions in one monitor), `process`, `service` (Windows-only, `boot_delay_minutes` gates *assignment*, not evaluation, via `metrics.uptime_seconds`).

**D. Audit-evaluated (not check-in), event-driven**: `software` (`{name_pattern, mode: installed|uninstalled|version_changed}`, evaluated from `diffSoftware()` on every `POST /v1/audit`; never auto-resolves; `sustained_minutes` always `0` — fires on first detection), `windows_update_drift` (`{}`, no config — verifies `NoAutoUpdate==1` stays set once Beacon has taken AU management; only assigned when `devices.windowsUpdateManaged===true`, resolved unconditionally the instant management is reverted, see Patch Management).

### "Assign → measure → report" pattern
Used by `file_size`/`ping`/`process`/`service`/`windows_update_drift`. Mirrors the pre-existing `commands`/`pending_command_results` shape: `evaluateCheckinAlerts` (`worker/src/lib/alerts.ts`) pushes an assignment into the check-in *response* instead of evaluating; the agent dispatches one goroutine per assignment and sends results on the *next* check-in; the worker evaluates each category with its own `evaluate*Alerts` function, all calling shared `processAlertState`. `check_interval_minutes` throttles *assignment* itself (stateless: `Math.floor(now/60) % checkIntervalMinutes === 0`).

### Scope resolution
`resolveEffectiveMonitors` groups matched monitors **by check_type**: if any company-scoped policy has monitors of a given check_type for the device, its monitors entirely replace the global ones for that type — never merged monitor-by-monitor.

### Default global policies (seeded)
Antivirus Health (3 monitors), Disk Space (<10GB free, high/5m), Device Offline (30m, high), Memory Usage (≥90%, high/10m), CPU Usage (2-tier: 100%/critical + 95%/high), Windows Update Drift (15m interval, 30m sustained, auto-resolves 60m). `file_size`/`ping`/`process`/`service`/`software` have no seeded defaults.

## Alert Notifications

Global (hoster-level), not per-company. Two independent channels, both potentially fired from `processAlertState`'s 3 sites (2 triggered, 1 auto-resolved) — never from `reconcileOrphanedAlerts`/bulk-resolve paths.

### Per-monitor opt-in (migration `0047`)
The alert itself always fires and is always visible regardless of notification config. `policy_monitors.notify_webhook`/`notify_email` (both default `false`, including for existing monitors) gate `fireWebhooks`/`sendAlertEmails` independently — matches Datto RMM's real model (per-monitor on/off, recipients configured once globally).

### Webhooks
`webhook_endpoints` (`id`, `url`, `enabled`, `created_at`) — global, not per-company. `fireWebhooks()` POSTs `{event, timestamp, device_id, company_id, hostname, check_type, monitor_id, policy_id, config}` to every enabled row via `Promise.allSettled` (fire-and-forget, no retry). **Deliberately unsigned** — a receiver needing authenticity fronts the URL with something like Hookdeck itself.

### Email — plugin architecture (`worker/src/lib/email/`)
```
types.ts        EmailProvider interface + EmailMessage type
providers/       resend.ts, mailgun.ts, ses.ts — each owns its own auth/encoding
registry.ts      Record<ProviderType, EmailProvider>
index.ts         sendEmail(env, to[], subject, html, text, headers?) — the only export alerts.ts imports
```
SES's SigV4 signer (`providers/ses.ts`) is hand-rolled via `crypto.subtle` — the most fragile piece here, only provably correct against a real AWS key (a wrong-but-parseable signature and a correct one both get rejected against a fake key).

**Config storage**: singleton `email_settings` (`id=1`, mirrors `branding_identity`'s shape), one active provider at a time. `config_ciphertext`/`config_nonce` hold the whole provider-specific blob AES-GCM'd. **"Blank means keep existing" is enforced server-side, per-field** — `PATCH` decrypts existing config and merges key-by-key, treating an empty incoming string as "keep stored value," before re-encrypting. (A real production incident predated this: an SES edit that left Secret Access Key blank, trusting only the dashboard's placeholder text, silently wiped it.) Mailgun's Region stays a plain always-explicit toggle (no blank-capable UI state makes sense there).

### Recipients — two unioned sources
`users.receivesAlerts` (opt-in per Beacon account) + `notification_emails` (standalone addresses, no Beacon account) — `sendAlertEmails()` unions both, deduped, no-ops on zero recipients. Links back via `${ALLOWED_ORIGIN}/#/global/alerts/<alertStateId>`.

### PSA-ready email contract (issue #88)
Subject has a stable prefix across the whole open→resolved lifecycle (only a trailing `[Open]`/`[Resolved]` tag differs) so a PSA can correlate the two messages as one incident. Body is a labeled field block (Alert ID, Company, Device, Check Type, Priority, State, Opened/Resolved At, Dashboard link) — same order/fields in both states. `X-Beacon-{Alert-Id,Device-Id,Company-Id,Event,Priority,Schema-Version:1}` headers thread through `EmailMessage`/all three providers for programmatic PSA routing. `resolveAlertRecipients(db, companyId)` is the extracted recipient-union+company-name-lookup, shared by `sendAlertEmails` and the rate-limit meta-notification below. `POST /v1/admin/email-settings/test` (admin) sends a real test email directly to the requesting admin, bypassing the fire-and-forget fan-out, so a broken provider surfaces synchronously rather than only in a swallowed `console.error`.

### Rate limiting / circuit breaker for flapping monitors (issue #169, migration `0081`)
Scoped to the `alert_state` row (per device+monitor), not `policy_monitors` (which has no `deviceId` and is shared across every device a policy targets — muting there would silently kill notifications fleet-wide). Tripping the breaker only mutes the notification channel — `isAlerting`/dashboard visibility/evaluation are untouched. `manuallyResolveAlert()` is never rate-limited (a technician's deliberate action shouldn't be swallowed) and resets the counters; bulk-close paths (`reconcileOrphanedAlerts`/`resolveAllOpenAlerts`) leave them untouched. `RATE_LIMIT_WINDOW_SECONDS = 900` / `RATE_LIMIT_THRESHOLD = 10`, hardcoded — matches this codebase's "one fixed thing, not a builder" convention. `computeRateLimit(existing, now)` is a pure function: frozen while an existing mute is in the future, otherwise rolls the window and trips at >10. The one-time-per-trip meta-notification repeats every window a monitor keeps re-tripping it (~1 email/15min bound, confirmed with the user). Dashboard shows a self-expiring amber "Muted" badge on Global Alerts, Alert Detail, and Device Detail — no manual unmute, purely automatic.

## Components / Job System

Script/application library (`components`) + delivery mechanism (`jobs` → `commands`).

### Tables
- `components` — `type` (`script`|`application` — file-backed, executes via `msiexec`), `origin` (`custom`|`store`), `scope` (`global`|`company`, restricted via `component_companies` many-to-many — `company_id` itself is vestigial), `category` (shown as "Group"), `shell`/`script`/`timeout_seconds`, `post_conditions` (JSON array), `target_os`, `requires_admin` (bool, admin-only to set/clear — see below).
- `component_variables` — `name` (env-var identifier), `label`, `type` (`string`|`selection`|`boolean`|`date`), `options`, `default_value` (always a string, Datto's own convention), `required`, `sort_order`.
- `component_companies` — many-to-many `(component_id, company_id)`.
- `jobs`/`commands` — `jobs.component_ids` is a JSON array of `ComponentRef` (`{type:'library',...}` or `{type:'inline',...}`); `commands.payload` for `run_script` carries `variables`; `commands.warning` is set independently of `status` by post-conditions.

### ComStore
`origin='store'` components (seeded, migration `0020`) are read-only at the API layer. `POST /:id/clone` copies any component into a fresh `origin='custom'` row.

### Input variables
Full 4 types (String/Selection/Boolean/Date), prompted per-job via `ComponentVariablePrompt.vue` from two call sites (`JobFormPage.vue`, Quick Job on `DeviceDetailPage.vue`). All values pass through as strings. Resolution order server-side: supplied → `default_value` → (if required) a named 400.

### Post-conditions
`{id, stream, match_type, pattern, enabled}[]`, evaluated in `checkin.ts` at result-persist time (`worker/src/lib/postConditions.ts`) — sets `commands.warning`, never `status`.

### Scheduling
`POST /v1/admin/jobs` branches on `type`: `quick` dispatches immediately; `scheduled` inserts with zero commands, and the 2-min cron's `dispatchDueScheduledJobs` resolves target devices and dispatches **at that time**, not creation time (a job targeting "All Devices" today picks up a device enrolled tomorrow). `cancelExpiredScheduledJobs` flips a never-dispatched job to `cancelled` once `expires_at` passes. `insertJobCommands` is the one shared dispatch primitive both paths call — also where Custom Field (`CF_`) and Company Variable (`CV_`) script-variable resolution and the `requires_admin` gate all hook in (see their own sections).

### Dashboard
`ComponentsPage.vue` (list only, My Library/Browse Store tabs) → "Run as Job" pushes to `/jobs/new?components=`. `ComponentFormPage.vue` (full-page create/edit) uses a right-side "Add Company" flyout. `JobFormPage.vue` (`/jobs/new`) sections: Name, Components, Targets (Datto-style flyout: All Devices/Companies/Devices/Device Groups, OR'd), Schedule (Immediately/scheduled), Execution (System/Logged-in-user, see below). `JobDetailPage.vue` shows a flow diagram (Pending→Running→Successes/Warnings/Failures) and per-device command output.

### Execution context ("run as a logged in user")
`jobs.run_as_system` (default `true`) drives real execution. **v1 scope**: Windows only, console/active session only (not RDS fan-out — one `CommandResult` slot), PowerShell only — anything else fails the command with a clear `Stderr` message rather than silently falling back to SYSTEM. The script content is wrapped in a PowerShell redirect block (`& { <script> } 1> ... 2> ...`) rather than wiring raw stdout/stderr pipe handles across the token boundary, then invoked via `usersession.RunAsSession` instead of `exec.CommandContext`. Relies on `C:\Windows\Temp`'s default `BUILTIN\Users` ACL for the SYSTEM↔user handoff — a hardened/GPO-locked fleet stripping this fails loud, not silently. `RunAsSystem *bool` (pointer — nil defaults to `true`) on the payload.

### Requires Admin to Run (migration `0069`)
`components.requires_admin` — only an admin may set/clear it (a technician's routine edit of an unrelated field is unaffected). Technicians still see admin-only components everywhere with an "Admin Only" badge, just can't select/run them. The one real enforcement point is `POST /v1/admin/jobs` (covers both the full Job page and Quick Job, which dispatches through the same endpoint) — 403s with the flagged component names before any device resolution.

### Application Components (migrations `0070`–`0071`, issue #91)
File-backed, Windows/MSI-only. Private `COMPONENT_FILES` R2 bucket — object keys never reach the dashboard or agent. `component_files` (per-file metadata) / `component_applications` (one-row installer settings: file, arguments, timeout, detection type/value). Upload is raw-binary with metadata in `X-File-*` headers, `Content-Length`-verified, 100MiB/file + 500MiB/component caps, duplicate names rejected. Dispatch inserts a `type: 'install_msi'` command plus one `component_file_downloads` grant row per file in the same atomic `db.batch()` — an agent can never receive the command before its file grants exist. **Download grants are short-lived and command-scoped**: only a SHA-256 hash of the token is stored; the grant is inserted already-expired and only becomes usable (2h window) once `checkin.ts` actually hands the command to the agent. `POST /v1/component-files/download` (agent-facing) requires both the device's long-lived credential *and* the short-lived per-file token. Detection (`msi_product_code` or `powershell`) runs before any download; a match short-circuits to `completed`. Installer arguments are `${CV_KEY}`/`${CF_KEY}`-expanded entirely agent-side, immediately before the `msiexec` call, so a secret-bearing argument never lands in the `commands.payload` row the worker/dashboard can read back. Always runs as the system account (400 if `run_as_system: false` is requested alongside an application ref). Verified end-to-end on real Windows hardware with an official 7-Zip MSI.

### Explicitly out of scope
Monitor-as-component-category (future `check_type` idea, separate work); component access Levels (redundant with 3-role RBAC — not the same as Requires Admin, which is about execution risk); email-on-job-completion (no email infra hook for this yet); full recurrence patterns beyond one scheduled run.

## Remote Shell / session system

### Architecture
`worker/src/durable-objects/session-relay.ts`'s `SessionRelay` DO is a fully generic, byte-agnostic bidirectional relay — forwards bytes between tagged `agent`/`client` WebSocket roles, one DO instance per session ID (`idFromName(sessionId)`), with zero shell/tunnel/screen-share protocol awareness. `worker/src/routes/sessions.ts`: `POST /v1/sessions` (technician) validates the device, generates a session ID + per-session client auth token, inserts a `sessions` row, queues `open_session` via the normal command-queue channel (picked up on the agent's next check-in, up to 60s). `GET /v1/sessions/:id/ws` upgrades and proxies to the DO. `sessions.sessionType` is plain `TEXT` (`'shell'|'tcp_tunnel'|'screen_share'`), no SQL `CHECK`. `sessions.status` exists in schema but is dead code (never transitioned past `pending`).

### Agent-side protocol (`shell.go`)
One persistent PTY-backed shell process per session. Binary WS frames carry raw PTY bytes both ways; text WS frames carry a small JSON control envelope (currently just `{type:'resize',cols,rows}`). Default shell: Unix picks `$SHELL`→`/bin/bash`→`/bin/sh`; Windows uses `powershell.exe`.

### Dashboard (`RemoteShellModal.vue`)
`@xterm/xterm` + `@xterm/addon-fit`. Opens a native `WebSocket`, shows "Connecting… up to 60 seconds" until the first message arrives. **The client must connect to the relay before the agent does** — RFB/shell's server speaks first and `SessionRelay` doesn't buffer a pre-attach message, so connecting the agent side first silently drops the opening handshake and both sides hang. Production ordering already matches this (browser connects immediately on `POST /v1/sessions`; agent attaches later).

### Hosted-relay status
Linux Remote Shell is confirmed Supported on real hardware — interactive command output, a real PTY child process, relay disconnect metadata, and confirmed PTY cleanup after modal close. Along the way, a real close-code bug was found and fixed: `ws.close()` with no code reports as reserved code `1005`, which the relay then tried to forward verbatim and threw — the dashboard now always closes with code `1000`, and the relay normalizes any other incoming code to `1000`/accepts only `1000` or `3000`–`4999` for peer propagation. Full incident history (an earlier apparent hosted-relay traffic-forwarding failure, later found non-reproducible and unrelated to this fix) is in PROJECT_LOG.

### Explicitly out of scope
File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot-only, shutdown/restart, network device deploy/wake, in-session Quick Jobs, session history/audit UI — all reuse this same relay/auth plumbing when built. "Remote takeover" is now built — see Web Remote below.

## Fast Poll (migration `0077`)

Every session-open (Remote Shell/Web Remote/Elevate) and direct device command only gets picked up on the agent's next regular 60s check-in — no other wake mechanism exists. `devices.fast_poll_until` (nullable timestamp, same self-expiring shape as `maintenanceEndsAt`) — `extendFastPoll()` arms/resets (not accumulates) to `now + 15min`; `isFastPollActive()` is the pure read. Armed from exactly two call sites: `POST /v1/sessions` and `POST /v1/admin/devices/:id/commands`. While active, `checkin.ts` adds `next_checkin_seconds: 15` to the response; omitted entirely (not `0`) once expired, so old and new agents both fall back correctly. **Job dispatch never arms it** — a Job can target hundreds of devices, and flipping a whole fleet to 15s polling as a side effect would be a real cost problem. Known limitation: doesn't speed up the very first action against a cold device (still up to 60-70s) — only actions after the window is already warm. Dashboard: a read-only "Fast Poll" badge on Device Detail only.

## Web Remote

Beacon's zero-install, browser-based remote-desktop viewer — a hand-rolled Go RFB (VNC, RFC 6143) server plus GDI capture/`SendInput` injection, chosen after real research ruled out RDP (needs Windows login credentials up front, and even RDG/Datto's own native Agent Browser RDP tool can't watch an already-active session without RDS Shadow, which doesn't exist on client Windows) and RustDesk (its web client only speaks its own proprietary protocol). Opens in a new browser tab (`/remote/:sessionId`), reuses `sessions`/`SessionRelay` with `session_type: 'screen_share'`.

### Current scope (v1, now extended)
Captures and controls an already-logged-in user's desktop, or (via SYSTEM fallback, PR #167) a machine sitting at its logon screen with nobody signed in. Login/Winlogon-screen capture for an *already-signed-in* session's secure-desktop prompts, multi-monitor, RDS/AVD per-session targeting, and file transfer are all now built (see below) — genuinely out of scope: clipboard remote→local sync, non-Windows targets, full X11-keysym coverage (dead keys, IME, non-US punctuation).

### Process architecture
The SYSTEM-context agent service has no desktop access to a logged-in session, so a per-session helper binary (`agent/cmd/beacon-screenshare`, embedded via `//go:embed`, same extract-if-stale pattern as the tray) does the real work — launched into the target session via `usersession.RunAsActiveUser` (normal) or `usersession.RunAsSessionAsSystem` (Elevate, see below), passing `--session-id`/`--ws-url`. Only the helper ever dials the relay for `screen_share` — `session.go`'s `Handle()` special-cases this session type *before* its normal dial, since two `agent`-role sockets on one session would corrupt RFB's single-byte-stream protocol.

### RFB server (`agent/internal/rfb`, `agent/internal/rfbserver`)
Pure wire-format encode/decode with zero OS dependency, fully unit-tested — handshake (Security(None), since the relay's own per-session token already gates the WebSocket), `SetPixelFormat` (honored — noVNC allocates its render buffer to match), `FramebufferUpdate`, RFB DesktopSize (`-223`, in-place monitor-switch resize, see below) and Cursor (`-239`, client-side-rendered cursor for latency-independent mouse movement) pseudo-encodings. `rfbserver` orchestrates the codec against `Capturer`/`Injector` interfaces, unit-testable with fakes over `io.Pipe()` independent of real Windows code. Raw encoding only, band-chunked into 128-row rectangles (Cloudflare's 32MiB WS message limit). Capture-on-`FramebufferUpdateRequest`, matching real noVNC's own request-driven model (confirmed against `core/rfb.js` before building).

### Windows capture + injection (`agent/internal/win32`, `screencapture`, `screeninject`)
First place this codebase calls raw Win32 APIs directly (`NewLazySystemDLL`/`NewProc` — `x/sys/windows` wraps none of gdi32/user32's `BitBlt`/`GetDC`/`SendInput`). `GDICapturer`: DPI-aware, `BitBlt(SRCCOPY)` + `GetCursorInfo`/`DrawIconEx` composite (cursor baking is gated off once a client signals Cursor pseudo-encoding support), `GetDIBits` into a 32bpp buffer, `rfb.PackRow` per row. Diffs against the previous frame (row-range only, not full 2D) and only sends the changed range — a static desktop returns a zero-height rectangle. `Injector`: `x11keysym` maps RFB keysyms to VK codes; pointer normalization targets the full virtual desktop (`MOUSEEVENTF_VIRTUALDESK`) so multi-monitor injection lands correctly. `FollowInputDesktop` mode (built for Elevate) has capture/injection call `OpenInputDesktop`/`SetThreadDesktop` every cycle instead of a fixed `winsta0\default` attachment — the mechanism that lets a SYSTEM-relocated helper actually see and click a UAC secure-desktop prompt.

### Multi-monitor (PRs #142/#143/#145)
`win32.EnumMonitors()` (`EnumDisplayMonitors`/`GetMonitorInfoW`) keys each monitor by its real GDI device name (`\\.\DISPLAY1`), not a recomputed enumeration index — index-based identity was flagged in review as a silent-wrong-monitor risk across separate processes. Switching monitors is **in-place on the live connection**, not a new session: RFB DesktopSize pseudo-encoding tells the already-connected client to resize; the helper polls a lightweight `sessions.pending_monitor` worker endpoint (~1s) rather than a fresh `open_session` round trip (the first design took 10+ seconds per switch and was rejected on real-hardware testing). A Displays dropdown appears only when >1 monitor is reported.

### Server-class session picker (PR #141)
A server-class Windows device (RDS/AVD, multiple concurrent logged-in sessions) can target a specific session via `usersession.ActiveSessionDetails` + a `list_remote_sessions` command; client-class devices are unaffected (still shadow the single console session).

### On-demand elevation ("Elevate")
Rebuilt (PR #140) around **SYSTEM token relocation**, not an Administrator-privileged token: clicking Elevate relaunches `beacon-screenshare.exe` under the agent service's own SYSTEM token via `usersession.RunAsSessionAsSystem`, with `FollowInputDesktop` capture/injection — this is what actually lets a technician see *and click* a live UAC secure-desktop prompt (an Administrator token, split or credentialed, can never open the secure desktop at all; only SYSTEM can). Opens as a **new, independent session** (a fresh relay DO instance, zero RFB protocol changes) — `WebRemotePage.vue` connects the new elevated instance in the background against an inactive screen target and only swaps/tears down the old one once the new one is proven connected, so a failed elevation attempt never loses the working session. A real dashboard-side stale-event race (the old connection's async `disconnect` event landing after the new one had already set `status='connecting'`, clobbering it) is guarded by a `connectionSeq` generation counter. `ActiveUserCanElevate()`/`console_user_can_elevate` (audit-collected, nil = never evaluated) and a company-level `hasElevationCredentials` check give real visibility into whether Elevate is likely to work *before* a technician clicks it — surfaced on Device Detail and inside the Elevate confirmation modal, confirmed live on real production hardware. Once elevated, `launchElevatedShell` also opens a second, independently elevated PowerShell window (inherits elevation automatically, no further UAC prompt) presenting a small TUI menu (`menu` function, re-invokable) of common admin destinations (Task Manager, Control Panel applets, Services, Device Manager, Event Viewer, Disk Management, Programs and Features, Network Connections, System Properties, File Explorer) — this is what "access to all the administrative tools" actually means in practice, delivered through one already-open elevated window rather than per-tool launch mechanics. Uses `-EncodedCommand` (base64 UTF-16LE), not `-File` — a real execution-policy bug (Windows client editions default PowerShell to `Restricted`, which blocks `-File` script loading but not inline/encoded commands) was found live and fixed this way; the same gap was separately fixed with `-ExecutionPolicy Bypass` at the two Job/Component `-File` call sites (`run.go`, `run_as_user_windows.go`), which don't have the encoded-command option available to them.

**What Elevate still cannot do**: if the *end user* independently triggers their own UAC prompt outside anything Beacon initiated (or a technician manually right-clicks "Run as Administrator" on something outside the provided elevated window), that still can't be seen/clicked — the secure-desktop-following capture only exists for the SYSTEM-relocated helper session itself. Steered against via UI copy, not solvable at the OS level with the current design.

### File transfer (PR #145)
Upload always lands on the target session's logged-on user's Desktop (no destination picker, matching Datto's own real flow); Download opens a remote directory browser (drive list → descend → up), since there's no other way to know what exists on a machine the technician isn't physically at. `session_file_requests` table (assign-then-poll-then-report, same shape as the monitor-switch/Two-Tier-Policy agent-measured checks), private `SESSION_FILES` R2 bucket. Known gaps: uploads use the standard non-redirected Desktop path (not folder-redirection-aware); R2 object cleanup after download isn't solved (transient objects, acceptable at self-hosted scale).

### Toolbar and UX
An icon-based toolbar (kebab-style Keyboard dropdown covering 8 real shortcuts including Ctrl+Shift+Esc/Alt+Tab/Alt+F4/Windows-key combos via a `sendCombo()` helper on top of noVNC's real `sendKey` method; Paste/Fullscreen as plain icons; Elevate kept as a labeled, shield-iconed, warning-tinted button since it's meaningfully different from the other one-click utilities; Disconnect as an icon-only X — not a power icon, which read as "power off the remote machine," which it never did). `scaleViewport`/`clipViewport` must be set as real property writes on the live `RFB` instance after construction, not passed in the constructor options object (the constructor silently ignores unrecognized keys — confirmed by reading noVNC's own source after a first attempt shipped inert).

### Windows Defender / Smart App Control (operational requirements)
Both `C:\Program Files\Beacon` (install dir) **and** `%PROGRAMDATA%\Beacon` (credential/log dir — a genuinely separate directory) need a real-time-protection exclusion, confirmed via controlled on/off testing, not assumed — Defender's *behavioral* protection (not a signature detection, no Protection History entry) interfered with screen capture/injection and with `agent.log`/`beacon-screenshare.log` writes independently. Windows **Smart App Control** additionally blocked a self-update from ever starting the service at all (Error 4551, "Application Control policy has blocked this file") — a materially worse failure than a Defender exclusion gap, since the whole agent goes dark with no remote recovery path; root cause is that release binaries are Ed25519-signed internally but not Authenticode-signed, so every release is a zero-reputation new file hash. Both requirements are documented in `docs/SELF_HOSTING.md` as pre-deployment checks, not just discovered-after-the-fact notes.

### Verification status
Core flow (SYSTEM relocation, `FollowInputDesktop`, Elevate reconnect-and-swap) and multi-monitor in-place switching are confirmed on real hardware with a local administrator console user. **Not yet confirmed on real hardware**: Elevate as a standard (non-administrator) console user (SYSTEM elevation doesn't depend on the console user's privilege level, so this is expected to work identically, but has never actually been exercised); file transfer (source/cross-compile-verified only); PR #167's nobody-logged-in SYSTEM fallback. Full chronological bug-fix history (UAC-related session/injection/capture fatal-error paths found and fixed one at a time across several real-hardware passes; the Elevate credential-based Administrator-token approach that was built, tested, and then fully superseded by SYSTEM relocation; the RDP/RDG detour that was researched and ruled out) is in PROJECT_LOG.md.

## Custom Fields

Beacon's equivalent of Datto RMM's UDFs — reduced from Datto's 300 fixed pre-numbered slots to dynamic named fields.

### Tables
- `custom_fields` — `id`, `name`, `key` (identifier form, `''` = not yet script-referenceable, partial-unique), `sort_order`. Global — every field is visible on every device.
- `device_custom_field_values` — `(device_id, field_id)` composite PK, `value` (nullable), both FKs cascade.

### Scope decisions
Dynamic named fields (not Datto's fixed 300); manual entry only (no agent-write path exists); no Job/Policy targeting by field value (deferred — would need new filter logic in both `jobs.ts` and `alerts.ts`).

### Script variables (`CF_<KEY>`)
A component script references `${CF_<KEY>}`/`$env:CF_<KEY>`/`%CF_<KEY>%` with no per-component declaration. Resolution lives in `insertJobCommands` — `fetchCustomFieldVars` bulk-fetches every target device's values in one query, never injects an empty-string var for an unset value, merges as `{...cfVars, ...payload.variables}` (component's own declared variable wins on collision). No agent-side change — `run.go` already treats `commands.payload.variables` as an opaque flat map. **Rename guard, not a hard lock**: `PATCH .../custom-fields/:id` blocks a `key` change if any `components.script` still contains the literal `CF_<OLDKEY>` substring (plain JS `.includes()` scan, not SQL `LIKE` — key values contain `_`, which `LIKE` treats as a wildcard). Key format `^[A-Z_][A-Z0-9_]*$`.

### Worker / Dashboard
`worker/src/routes/admin/custom-fields.ts` — field-definition CRUD, **admin-only** (Settings-tier). `devices.ts` gains `GET/PATCH .../custom-fields[/:fieldId]` (technician). `CustomFieldsSettingsPage.vue` (admin) manages definitions with an auto-suggested Key column. `DeviceDetailPage.vue` gained a Custom Fields section (between Network and Security) with inline-editable values. `ComponentFormPage.vue` shows a discoverability hint listing available `CF_<KEY>`s under the script textarea.

## Dedicated Company Detail Page (issue #77)

`CompaniesPage.vue` is list-only (row click navigates to `/companies/:id`, matching this codebase's established "list only — row click navigates" convention). `CompanyDetailPage.vue` holds everything that used to be an inline expandable table row: Contacts/Locations/Tokens/Variables/Discovery as a **tab bar**, not `DeviceDetailPage.vue`'s scroll-spy continuous-page pattern (deliberate — 5 lightweight tabs vs. Device Detail's 13 heavier sections, and the tab UI already existed and was already known-good). Edit lives on the detail page's own topbar with its own modal; `CompaniesPage.vue`'s modal is create-only. A "Devices" row-action button on the list page and a "View Devices" topbar button on the detail page both preserve the old one-click shortcut to `/devices?company=<id>`. No new backend route — the detail page reuses the existing `GET /v1/admin/companies` list and finds the matching row client-side (cheap at self-hosted scale, same reasoning as other full-table-scan conveniences in this codebase).

## Company Variables / Secrets

Per-Company key/value config, referenceable from component scripts as `CV_<KEY>` — Cloudflare-Workers-variables/-secrets-style. Company-level only, no Location override.

### Table
`company_variables` (migration `0061`) — `id`, `company_id` FK cascade, `key`, `is_secret`, `value` (cleartext, only when `!is_secret`) or `value_ciphertext`/`value_nonce` (AES-GCM, only when `is_secret`), `description`. `UNIQUE(company_id, key)`. A secret's plaintext is never returned once saved — reads report `hasValue: boolean` instead.

### Resolution and access
`fetchCompanyVariables()` bulk-fetches and decrypts once per targeted-company set (not per device — a company variable's value is identical fleet-wide, unlike Custom Fields' genuinely per-device values), merged in `insertJobCommands` as `{...cvVars, ...cfVars, ...payload.variables}`. `worker/src/routes/admin/companies.ts`'s nested `/:id/variables` CRUD is **admin-only** even for non-secret values, since it's the same dispatch-time configuration namespace secrets live in. `CompaniesPage.vue`'s expand-row gained a 4th admin-only Variables tab (not rendered for non-admins at all).

## Network Discovery

Live-host sweep (ping + ARP table cross-reference), plus optional credentialed SNMP/SSH fingerprinting on top (issue #78, migration `0076`). Deliberately reduced from full Datto parity: list only, no new alert channel, one probe device per company.

### Architecture
Dispatched through the existing `commands` table (`type: 'network_scan'`), not the check-in wire protocol — a direct lesson from a real production incident where a wire-field rename broke check-in fleet-wide. `dispatchDueDiscoveryScans` (cron) inserts a command targeted at a company's designated probe device once `scan_interval_minutes` has elapsed; the agent JSON-encodes its result straight into `CommandResult.Stdout`; `checkin.ts`'s existing `pending_command_results` loop gained one branch to parse and upsert it.

### Tables (migration `0062`, extended `0076`)
`network_discovery_configs` — one row per company, `probe_device_id` FK, `cidr_ranges` (JSON array, capped at `/20` both client- and agent-side), `scan_interval_minutes` (default 360), plus `snmp_enabled`/`ssh_enabled` toggles (no credential columns here — see below). `discovered_devices` — keyed by `(company_id, ip_address)` (not MAC — simpler upsert, known DHCP-reassignment tradeoff), `mac_address`/`hostname`/`open_ports`/`snmp_sys_descr`/`snmp_sys_name`/`ssh_banner`/`ssh_os_info` all nullable and never blanked by a scan that finds nothing new, `dismissed` to quiet a recognized device. No automatic correlation against already-enrolled Beacon devices.

### Worker / Agent
`dispatchDueDiscoveryScans` re-verifies the probe device before dispatching. `POST .../discovery` validates `probe_device_id` belongs to the company, is `approved`, and isn't a laptop. `agent/internal/discovery.Scan()` — bounded-concurrency (32 workers) fast ping sweep, one `arp -a`/`ip neigh show` dump, best-effort reverse DNS, all bounded to 4096 total addresses and a 5-minute budget. Credentialed enrichment (16 workers, only against already-alive hosts, only for enabled protocols) runs SNMP v1/v2c (`gosnmp`, `sysDescr.0`/`sysName.0` only — fixed OIDs, not a builder) and SSH password-only (`golang.org/x/crypto/ssh`, `ssh.InsecureIgnoreHostKey()`, fixed `uname -a` command). Credentials come from fixed Company-Variable keys (`CV_SNMP_COMMUNITY`, `CV_SSH_USERNAME`, `CV_SSH_PASSWORD`) — a protocol enabled without its credential is silently skipped, not a hard failure. Port-gating (a real `net.DialTimeout` for SSH; the credentialed GET request itself for connectionless SNMP) happens before any credentialed attempt reaches a real auth handshake.

### Dashboard
`CompaniesPage.vue`'s Discovery tab: Scan Configuration (probe device select, CIDR inputs, interval, enabled toggle, Scan Now) + Discovered Devices table (IP/MAC/Hostname/Open Ports/Fingerprint/First-Last Seen/Times Seen/Dismiss/Delete).

**Explicitly out of scope**: WinRM, SSH key-based auth, custom OID/command configuration, ports beyond 22/161, automatic vendor/model parsing of raw `sysDescr`, per-target-host protocol selection.

## Device Groups

Static, manually-curated device collections — Datto's "Groups" half only, not its dynamic criteria-based "Filters."

### Tables
`device_groups` (`id`, `name`, `description`). `device_group_members` — `(group_id, device_id)` composite PK. `policy_groups` — `(policy_id, group_id)` composite PK, one of three OR'd policy-targeting dimensions (see Policy Targeting below).

### Job and Policy targeting
A 4th `resolveDevices()` branch in `jobs.ts` (`JOIN device_group_members`, `DISTINCT`). For policies, `deviceMatchesPolicy`/`matchMonitorsForDevice` take pre-fetched group-ID maps — **always fetched once per invocation by the caller, never per-device inside a loop**, since this runs on real hot paths (every check-in, the 2-min offline cron over the whole fleet).

### Worker / Dashboard
`worker/src/routes/admin/groups.ts` — CRUD + nested membership, `technician` for mutations (operational targeting infrastructure, not Settings-tier config). `GroupsPage.vue`/`GroupFormPage.vue` mirror the Components list/form pattern. `DevicesPage.vue` gained an "Add to Group" bulk action. `JobFormPage.vue`'s target flyout gained a `group` kind. Sidebar link lives in **Devices**, not Automation.

## Policy Targeting (Companies / Devices / Device Groups, migration `0032`)

One unified "Targets" flyout (reusing `JobFormPage.vue`'s `.tf-` pattern) replaced the old Scope seg-bar + single-company combobox + separate Device Groups picker. OS/Class targeting stays a separate, still-ANDed section.

**The one real behavioral fork from Job's flyout**: targeting is a heterogeneous **OR-list**, not single-kind-exclusive — a policy's Targets can mix a Company AND a Device AND a Device Group simultaneously, and a device qualifies if it matches *any* entry of *any* kind (confirmed against Datto's real documented "OR logic across multiple targets" behavior). Zero targets across all three tables = unrestricted.

### Tables
`policy_companies`/`policy_devices` (both composite PK, migration `0032`, mirroring the pre-existing `policy_groups`). `policies.scope` is now **derived**, not directly settable — recomputed by `recomputePolicyScope()` after every target-table mutation (`'global'` when 0 targets, `'company'` when 1+); purely a display/tab-filtering convenience, never read by the actual matching logic. `policies.company_id` is fully vestigial.

### Matching
`deviceMatchesPolicy` has no separate scope-vs-company AND-check anymore — that dimension folded into the OR-list, still ANDed with the OS/Class check. `fetchPolicyCompanyIds`/`fetchPolicyDeviceIds` follow the same fetch-once-per-invocation rule as the group-ID helpers.

**Testing gotcha**: don't use `disk_space` (or any check type a seeded global policy already uses) in a manual targeting test — the pre-existing same-check-type company-override dedup rule will interact with it and produce a confusing count. Use `ping`/`file_size`/etc. for a clean signal.

## Patch Management

Windows Update integration, built in slices: Patch Visibility (scan+report) → approval workflow → install capability → Patch Policy (auto-approval + scheduled recurring install windows) → Windows/Microsoft Update takeover → drift detection → drivers → Server/Client-OS class + Hyper-V exclusion.

### Patch Visibility
`agent/internal/audit/patches.go`'s `collectPatches()` (Windows-only) uses the native `Microsoft.Update.Session` COM API via PowerShell (`IsInstalled=0 and IsHidden=0`) — no `PSWindowsUpdate` dependency, no admin rights needed to search. Definition Updates (AV signatures) are filtered client-side (WUA's criteria language can't filter by friendly category name). Rides the existing `device_audits` JSON-blob-per-category pattern (`patches` column, migration `0052`), no dedicated table. `PatchItem.UpdateID` (WUA's `Identity.UpdateID` GUID) is the stable identity a patch is approved against — a patch entry with no `update_id` (pre-upgrade agent) can't be approved; the worker surfaces a `needsRescan` count instead of erroring.

### Approval workflow (migration `0053`)
**Fleet-wide, not per-device** — one decision per Windows Update, applying everywhere it's detected (matches real-world patch management: you're deciding whether an update is safe, not re-deciding per machine). `patch_approvals` — `update_id` PK, `status` (`approved`/`ignored`), snapshot fields for display. No row = pending. `GET/PATCH /v1/admin/patches[/:updateId]` — readonly view, technician mutate.

### Install capability
`agent/internal/wuinstall.Install(updateIDs)` — re-searches WUA, filters to the requested IDs, downloads+installs (`AllowSourcePrompts=false`), reports per-update success/failure plus an aggregate `RebootRequired`. Runs as SYSTEM (the agent's own service context — no elevation gotcha). Dispatched as a one-shot `install_patches` command (not the assign-measure-report pattern — single user-triggered action), `update_ids` GUID-regex-validated before reaching the shelled-out script. The worker **re-validates server-side** that every requested `update_id` is actually `approved` before dispatch, silently dropping any that aren't (400s if zero survive) — defense in depth beyond trusting the dashboard. A manually-triggered install with `RebootRequired` gets the interactive tray Restart Now/Postpone prompt (see Architecture above); Patch Policy's own `auto_reboot` (below) is the more aggressive opt-in on top of that default.

### Reboot Required — fleet-visible signal (migration `0072`, issue #89)
`devices.pendingRebootRequired`/`pendingRebootDetectedAt` — entirely additive on top of the tray/marker mechanism above, which is purely local. **Set** in `checkin.ts`'s existing `pending_command_results` loop whenever a completed `install_patches` result reports `reboot_required: true`, uniformly regardless of `auto_reboot`. **Cleared** unconditionally at the top of the check-in handler by comparing the pre-fetch device's old `uptime_seconds` against the new check-in's value — a lower value means the device rebooted since last check-in, from *any* cause. The clear fields are only spliced into the update when a reboot is actually detected, never unconditionally with a live `false` (an earlier draft of this would have silently wiped a flag set moments earlier by a different check-in). Feeds the `reboot_required` dashboard widget and a Device Detail Patches-section status row.

### Patch Policy (migration `0057`, class simplification in `0068`)
Modeled on Maintenance Policy's targeting/recurrence shape but **actively dispatches** (`install_patches` commands at each due window), closer to Jobs' scheduled-dispatch shape than to Maintenance Policy's passive suppression gate. `patch_policies` — same recurrence columns as `maintenance_policies` (duplicated, not shared, per this codebase's per-policy-type convention), `auto_approve_classifications` (JSON array of real Windows Update Classification names — **not** an MSRC severity threshold; severity is only meaningfully populated for the Security Updates classification, so a severity-threshold model structurally couldn't ever auto-approve Update Rollups/Feature Packs/etc. — corrected in migration `0066` after confirming this against Microsoft's own docs, then trimmed to just `Security Updates` + `Update Rollups` since the other 5 are effectively obsolete on any current Windows 10 1903+/Server device), `auto_reboot`, `include_drivers` (visibility+manual-approval only, **never** Auto-Approval-eligible — a bad driver can break boot in a way software usually can't), `manage_windows_update`/`manage_microsoft_update` (opt-in AU/Microsoft-Update-service takeover, see below), `target_class` (JSON array — Server/Client OS pill in the UI, see below), `last_dispatched_at`. `patch_policy_{companies,devices,groups}` — the same 3-table OR-list shape as Policy Targeting.

Dispatch avoids re-firing within one continuous recurring-window occurrence via `last_dispatched_at IS NULL OR now > last_dispatched_at + windowDurationSeconds` (a continuous stretch can't outlast its own configured duration). Auto-approval is fleet-wide, matched by classification + non-driver-type only. `worker/src/routes/admin/patch-policies.ts` mirrors `maintenance-policies.ts`'s route shape.

**Company-level exclusion** (`companies.patch_management_excluded`, migration `0065`) — a blanket per-company opt-out (for a company managing Windows Update its own way, e.g. WSUS), checked first, unconditionally, in `deviceMatchesPatchPolicy` — no per-policy override is possible. Since Windows/Microsoft-Update-management and driver-visibility coverage checks all reuse this same function, the exclusion covers all three automatically.

**Server-class targeting + automatic Hyper-V exclusion** (migration `0068`) — `target_class` collapses to two dashboard pills, **Server** / **Client OS** (`['workstation','laptop']`), since Workstation-vs-Laptop is decided purely by battery presence (a hardware form-factor signal with zero patch-management relevance) while "server" alone was too coarse (a Hyper-V host needs categorically different handling — a bad reboot takes every VM down, not just itself). `devices.is_hyper_v_host` (nullable, audit-collected via `vmms` service presence, Windows-only) — `deviceMatchesPatchPolicy` excludes a Hyper-V host from any sweep-style match (Company-list or unrestricted) unless it's **explicitly** Device- or Group-targeted (Company targeting does not bypass the exclusion, since it's just as much an unattended sweep). No opt-out toggle exists — the only way to patch a Hyper-V host is a deliberate, manually-curated Device/Group target.

### Managing Windows' own Automatic Updates (migration `0063`) and Microsoft Update (migration `0067`)
Windows' AU client (governed by AU Group Policy registry keys) and the separate "Microsoft Update" service registration (broadens WUA to Office/other product updates) are both independently opt-in per Patch Policy (`manage_windows_update`/`manage_microsoft_update`) — never automatic for every policy-covered device. `syncWindowsUpdateManagement`/`syncMicrosoftUpdateManagement` (structural mirrors of each other, `worker/src/lib/{windowsUpdateManagement,microsoftUpdateManagement}.ts`, called from `scheduled()`) recompute desired state from scratch every cron tick against real, current Patch Policy coverage and dispatch a `manage_windows_update`/`manage_microsoft_update` command (`{action:'manage'|'revert', prior_state}`) on any mismatch — **coverage lost for any reason (toggle off, policy disabled/deleted, device retargeted, company excluded) reverts automatically on the very next tick**, the one hard safety invariant: never leave a device with Windows' own update mechanism disabled and no Beacon coverage to actually patch it. `agconfig`/`muconfig` (agent packages) shell out to PowerShell (registry `Set-ItemProperty`/`Remove-ItemProperty` for AU; `Microsoft.Update.ServiceManager`'s `AddService2`/`RemoveService` COM methods, keyed to the well-known Microsoft Update service GUID, for Microsoft Update) — reads and reports the pre-write snapshot regardless of action, and `revert` restores (or removes, if it didn't exist before) the caller-supplied prior value rather than guessing a default. Dispatched through `commands`, not the check-in wire protocol, same standing rule as Network Discovery.

### Windows Update Drift Detection (migration `0074`, issue #79)
Closes the gap that nothing ever re-checked the AU registry key after Beacon set it — a domain GPO refresh or local admin could silently re-enable it with zero visibility. Built as a new `windows_update_drift` check_type in the existing Two-Tier Policy system (reusing its assign-measure-report machinery, throttling, debounce, and notification config) rather than a `commands` dispatch or a wire-protocol extension — see that section above for the current shape. `resolveWindowsUpdateDriftAlerts` is a third member of the "unconditional resolve, no notification" family (alongside `reconcileOrphanedAlerts`/`resolveAllOpenAlerts`), called when a `manage_windows_update` revert completes, since a stale open alert must clear the instant management is dropped regardless of `auto_resolve`/grace-period state. `evaluateWindowsUpdateDriftAlerts` re-checks `device.windowsUpdateManaged` itself (not just at assignment time) to close a same-request race where a just-reverted device's own stale in-memory `device` object could otherwise re-open tracking moments after the unconditional resolve closed it.

### Software Uninstall
The Device Detail Software section gained a real Uninstall action — eligibility is deliberately narrow (a `QuietUninstallString`, or an `UninstallString` matching `msiexec` where `/qn /norestart` can be reliably appended): anything else gets no button at all, since the agent dispatches this SYSTEM-context with no visible desktop, and a non-silent installer's UI would render nowhere anyone could answer it. The worker independently re-derives eligibility server-side rather than trusting the dashboard's own mirrored client-side check. Dispatches as an ordinary `run_script` (no new command type) wrapping the resolved command in a small PowerShell script.

## Software Management (third-party app updates via winget)

Complements Patch Management's Windows-Update-only scope. **winget-based, not a hand-rolled catalog** — Datto's own ~200-app catalog is real, ongoing maintenance burden (installer URLs/version detection break over time); Windows Package Manager already has an externally-maintained database with its own detection/silent-install support, so Beacon leans on that instead. Windows-only. **Simple opt-in sweep, no new policy type** in v1 — reuses the existing `commands` mechanism directly (`manage_software`, mirroring `install_patches`), no scheduling/targeting/allowlist tables yet. `agent/internal/wingetupdate.Upgrade(packageIDs)` runs one `winget upgrade --all --silent ...` (empty list) or one invocation per ID (winget's CLI only accepts a single `--id` per call). **No structured per-package result parsing** — winget's own real output is surfaced verbatim through `CommandResult.Stdout`/the existing Command History UI, since there's no reliable stable machine-readable output mode to parse against across winget versions. `DeviceDetailPage.vue`'s kebab menu gains "Update Software (winget)" for Windows devices, no confirmation dialog (non-destructive-action framing). **The actual `winget upgrade` execution is unverified** — no real Windows machine with winget in this codebase's test environment; only the dashboard→worker→D1 dispatch pipeline is confirmed.

## Remote Agent Uninstall

`uninstall_agent` command type — the already-running SYSTEM-context service tears itself down on request. `service.SelfUninstall()` (Windows/macOS: detached helper process; Linux: `systemd-run --collect --no-block` under a transient unit, since systemd keeps an ordinary child in the same cgroup and kills it when the main process exits) is deliberately **not** a reuse of the synchronous `Uninstall()` path (invoked by the separate one-shot CLI `uninstall` command) — calling that from inside the process being torn down races its own termination. No result is ever reported back (fire-and-forget, same as `restart_agent`) — the device going quiet in check-ins is the only confirmation. Every uninstall path on every platform also removes `credential.Dir()` (`%PROGRAMDATA%\Beacon`/`/etc/beacon`/`/Library/Application Support/Beacon`), not just the install directory — a stale `credential.json` left behind previously made a reinstall silently skip re-enrollment and reload the old device identity. Dashboard: "Uninstall Agent" on `DeviceDetailPage.vue`'s kebab menu (danger-styled, `confirm()`-gated), distinct from "Delete Device" — this only removes the remote install, the device record/history stays. **Verified on real hardware** (agent v0.2.17+) — full removal of both `installDir` and `credential.Dir()` confirmed via `verify-uninstall.ps1`; the Windows-side fix history (a locked tray-icon file blocking `rd /s /q`, a console-less `timeout` command silently no-op'ing, and `rd /s /q`'s all-or-nothing abort-on-first-locked-file behavior — replaced with an active `Wait-Process` + `Remove-Item -Recurse -Force`) is in PROJECT_LOG.

## Activity Log

Master audit log — accountability + fleet-wide operational visibility, researched against Datto RMM's real Activity Log. Purely a logging layer on top of the existing 3-tier RBAC, not an RBAC change.

### Two-layer instrumentation (migration `0058`)
**Layer 1** — generic `activityLogMiddleware` registered on five mount-prefix families (`/v1/admin/*`, `/v1/auth/*`, `/v1/sessions`+`/*`, `/v1/branding/*`) *before* `app.route()` mounts. After a successful mutating request, resolves the actor via a second `requireUser()` call, looks up `(method, c.req.routePath)` — read strictly *after* `await next()`, since Hono's `routePath` only reflects the terminal handler once dispatch has actually happened — in a ~90-entry fine-grained table, falling back to a ~24-entry prefix-default map so an unlisted route still logs *something*. A `c.set('activityLogWritten', true)` guard prevents double-logging when one request matches more than one registered prefix (the same double-registration `corsMiddleware` already has for `/v1/sessions`, harmless there but not for a DB insert). **Layer 2** — a handful of explicit `logActivity()` calls for mutations with no user-authenticated HTTP route (`POST /login` both outcomes, the Microsoft SSO callback, `processAlertState`'s three trigger points, scheduled Job/Patch-Policy dispatch).

### Schema and retention
`activity_log` — `actorType`/`actorId`/`actorLabel` (snapshot, survives user deletion), `category`/`action`/`entityType`/`entityId`/`companyId`, `method`/`path`, `details` (nullable JSON). **Deliberately no FK constraints** — must never cascade-delete or be blocked by a since-removed row. `entityId` is not name-snapshotted (a real per-entity-type resolution table was scoped out); the dashboard instead click-throughs to the real entity page via an `ENTITY_ROUTES` map. `pruneActivityLog()` deletes rows older than 180 days, throttled via a persisted `host_settings.activity_log_pruned_at` timestamp (not a stateless tick-bucket, so a missed cron tick can't skip a whole day).

### Dashboard
`GET /v1/admin/activity-log` does real server-side filtering + `LIMIT`/`OFFSET` pagination — the first genuinely unbounded, account-wide-forever table in this codebase (every other "unbounded" list is actually a capped client-side page over a server `LIMIT`).

## Reports

On-demand CSV exports, reduced from Datto's PDF+CSV+scheduling model: **CSV only** (Workers has no filesystem/Node APIs — a Workers-compatible PDF library would be new, real scope; `worker/src/lib/csv.ts` is a ~15-line RFC 4180 writer, not a dependency), **on-demand only, no scheduling/email delivery** (would need new cron dispatch infra plus attachment support the email provider architecture doesn't have). Three report types, each reusing a proven existing query shape: Device Inventory, Patch Compliance, Alert History. Software Inventory was considered and deferred (sparsest/largest candidate, real row-count concern). `worker/src/routes/admin/reports.ts` — three `readonly` GET routes returning `Content-Type: text/csv` + `Content-Disposition: attachment`. `ReportsPage.vue` (`/reports`) — a shared company filter, per-report Download CSV button, no in-dashboard preview. `api.ts`'s `downloadFile()` fetches with the auth header attached (a plain `<a href>` can't carry `Authorization`) and hands the resulting Blob to the browser via a synthetic `<a download>` + `URL.createObjectURL`, reading the real filename back out of `Content-Disposition`.

## Key backend routes

```
POST /v1/enroll                              Agent enrollment
POST /v1/check-in                            Agent heartbeat + command exchange
POST /v1/audit                               Agent inventory audit snapshot

GET  /v1/admin/summary                       Device counts by status/OS/class
GET  /v1/admin/companies                     List companies
GET/POST  /v1/admin/companies/:id/variables          Company Variables/Secrets CRUD
PATCH/DELETE /v1/admin/companies/:id/variables/:varId
GET/POST  /v1/admin/companies/:id/discovery          Network Discovery scan config
POST /v1/admin/companies/:id/discovery/scan-now      Manually trigger a scan immediately
GET  /v1/admin/companies/:id/discovered-devices      List devices found by scans
PATCH/DELETE /v1/admin/companies/:id/discovered-devices/:deviceId
GET  /v1/admin/devices                       List devices (filterable)
PATCH  /v1/admin/devices/:id                 Edit manually-entered metadata (warranty_expires_at)
POST /v1/admin/devices/:id/commands          Queue a command (run_script, reboot, run_audit, restart_agent,
                                              force_update, install_patches, uninstall_agent, manage_software,
                                              uninstall_software)
GET  /v1/admin/devices/:id/commands          Last 50 direct commands for this device (jobId IS NULL)
GET  /v1/admin/alerts?status=active|all      Global alert state feed
GET  /v1/admin/alerts/:id                    Single alert detail (registered before /:id/resolve)
POST /v1/admin/alerts/:id/resolve            Manually resolve an alert
POST /v1/admin/alerts/:id/acknowledge        Acknowledge an alert

GET  /v1/admin/policies?scope=                List policies (monitors + companyIds/deviceIds/groupIds embedded)
POST /v1/admin/policies                      Create policy (supports clone_from=)
PATCH/DELETE  /v1/admin/policies/:id
GET/POST/PATCH/DELETE  /v1/admin/policies/:id/monitors[/:mid]
GET/POST  /v1/admin/policies/:id/{companies,devices,groups}[/:targetId]  DELETE removes a target

GET  /v1/admin/jobs                          List jobs (aggregate device stats, LIMIT 200)
GET  /v1/admin/jobs/:id                      Job detail with per-device command breakdown
POST /v1/admin/jobs                          Create job (technician) — quick dispatches now, scheduled waits for cron
DELETE /v1/admin/jobs/:id                    Retire job: cancel queued cmds, keep history
DELETE /v1/admin/jobs/:id/purge              Hard-delete job + all commands (admin only)

GET  /v1/admin/components?company_id=        Script/application component library
GET  /v1/admin/components/store              Browse ComStore (must be registered before GET /:id)
POST /v1/admin/components/:id/clone          Clone a component into a new origin='custom' one
GET/POST/PATCH/DELETE  /v1/admin/components/:id/variables[/:vid]
GET/POST/DELETE  /v1/admin/components/:id/companies[/:companyId]
POST/DELETE  /v1/admin/components/:id/files[/:fileId]     Application Component file upload/removal
PUT  /v1/admin/components/:id/application    Upsert installer/arguments/detection settings
POST /v1/component-files/download            Agent-facing: device credential + per-command grant → file bytes

POST /v1/auth/login | POST /v1/auth/logout | GET /v1/auth/me
GET  /v1/auth/microsoft/{login,callback,available}
POST /v1/auth/microsoft/exchange             Trade one-time code for a session token

GET  /v1/branding/active                     Public, no-store: active theme pointer
GET  /v1/branding/revisions/:id              Public, immutable-cached: a custom revision's tokens
GET/POST/PATCH/DELETE  /v1/admin/branding/themes[/:id]
POST /v1/admin/branding/themes/:id/publish   Snapshot draft → new revision, prune past 5
POST /v1/admin/branding/themes/:id/activate  Activate a built-in theme
POST /v1/admin/branding/revisions/:id/activate  Activate a specific custom revision
GET  /v1/branding/identity                   Public, no-store: {productName, logoKey, supportUrl}
GET  /v1/branding/logo/:key                  Public, immutable-cached: raw logo bytes
PATCH  /v1/branding/admin/identity           Set product name / support URL
POST/DELETE  /v1/branding/admin/logo         Upload / remove logo (admin)

GET/POST  /v1/admin/users                    List / create local user
PATCH  /v1/admin/users/:id                   Update role/name/status
POST /v1/admin/users/:id/reset-password
DELETE /v1/admin/users/:id                   Soft-disable

GET/POST/PATCH/DELETE  /v1/admin/sso/providers[/:id]
GET/POST/DELETE  /v1/admin/sso/providers/:id/group-mappings[/:mid]
GET  /v1/admin/sso/providers/:id/groups?search=      Live Entra group search

GET/POST  /v1/admin/webhooks[/:id]           Global alert webhook CRUD (admin only)
GET  /v1/admin/email-settings                Active provider config (secret never returned)
PATCH  /v1/admin/email-settings
POST /v1/admin/email-settings/test           Send a real test email to the requesting admin
GET/POST/PATCH/DELETE  /v1/admin/notification-emails[/:id]

GET/POST  /v1/admin/custom-fields[/:id]      Definition CRUD (admin only)
GET/PATCH  /v1/admin/devices/:id/custom-fields[/:fieldId]

GET/POST  /v1/admin/groups[/:id]
GET/POST  /v1/admin/groups/:id/members[/bulk]
DELETE /v1/admin/groups/:id/members/:deviceId

GET  /v1/admin/patches                       Fleet-wide distinct pending patches + approval status
PATCH  /v1/admin/patches/:updateId           Set/clear (status:'pending') fleet-wide approval

GET/POST/PATCH/DELETE  /v1/admin/patch-policies[/:id]
GET/POST/DELETE  /v1/admin/patch-policies/:id/{companies,devices,groups}[/:targetId]

POST /v1/sessions                            Open a remote session (shell, tcp_tunnel, screen_share)
GET  /v1/sessions/:id/ws?role=agent|client   WebSocket upgrade, proxied to SessionRelay DO

GET  /v1/admin/activity-log                  Server-side filtered + paginated audit log

GET  /v1/admin/reports/device-inventory      CSV export
GET  /v1/admin/reports/patch-compliance      CSV export
GET  /v1/admin/reports/alert-history         CSV export
```

## Dashboard routes

```
/                      DashboardHomePage  (redirect shim → /dashboards/:homeId)
/dashboards/:id        DashboardPage
/login                 LoginPage
/sso-callback          SsoCallbackPage
/devices               DevicesPage (?company=<id>) — list only
/devices/:id           DeviceDetailPage   (?section= for deep-linking)
/devices/:id/change-log DeviceChangeLogPage
/remote/:sessionId     WebRemotePage       (opened via window.open(), not a sidebar link)
/groups                GroupsPage
/groups/new, /groups/:id  GroupFormPage
/companies             CompaniesPage      (list only)
/companies/:id         CompanyDetailPage
/jobs                  JobsPage
/jobs/new              JobFormPage        (?components=id1,id2 pre-select)
/jobs/:id              JobDetailPage
/components            ComponentsPage
/components/new, /components/:id  ComponentFormPage
/global/alerts         GlobalAlertsPage (→ /global/alerts/:id)
/global/alerts/:id     AlertDetailPage
/global/policies       GlobalPoliciesPage
/global/policies/new, /global/policies/:id  PolicyFormPage
/global/patches         PatchesPage
/global/patch-policies      PatchPoliciesPage
/global/patch-policies/new, /global/patch-policies/:id  PatchPolicyFormPage
/global/activity        ActivityLogPage
/reports                ReportsPage
/settings/users         UsersPage (admin only)
/settings/users/new, /settings/users/:id  UserFormPage (admin only)
/settings/sso           SsoSettingsPage (admin only)
/settings/custom-fields CustomFieldsSettingsPage (admin only)
/settings/branding      BrandingSettingsPage (admin only)
/settings/notifications NotificationSettingsPage (admin only)
```
Admin-only routes carry `meta: { minRole: 'admin' }`; the router guard redirects non-admins to `/`.

## Sidebar structure (App.vue)

- **Dashboards** section: one link per dashboard (live list)
- **Companies** section: "All Companies" + active-client block (from `?company=`)
- **Devices** section: Device Approvals, All, Device Groups
- **Global** section: Alerts, Policies, Maintenance Policies, Patches, Patch Policies, Activity Log, Reports
- **Automation** section: Jobs, Components
- **Settings** section (admin only): Users, Single Sign-On, Custom Fields, Branding, Notifications
- Resizable via drag handle (`localStorage: beacon-sidebar-w`), collapsible via a floating chevron (`beacon-sidebar-collapsed`) — not a topbar hamburger, see STYLE.md

## Device detail page (`dashboard/src/pages/DeviceDetailPage.vue`)

**One continuous scrollable page, not tabs** — explicit user correction ("it is still supposed to be one page. The links just make it quicker to navigate"). Nav order: **Summary → System → Command History → Alerts → Policies → Software → Patches → Services → Memory → Storage → Network → Custom Fields → Security**. All sections render simultaneously; the left-nav only scrolls/highlights, never hides content. Data is fetched eagerly once per device load (`Promise.all`), not lazily per-section.

**Command History** — surfaces `commands` (`jobId IS NULL`, last 50), reusing `JobDetailPage.vue`'s output-expansion pattern. Every direct-command action function refreshes it immediately after queuing; the page's existing 30s poll also refreshes it (a `queued`/`sent` row otherwise looked permanently stuck until a manual reload). Excludes Job-dispatched commands (those have full visibility on the Job's own detail page already).

**Identity header**: large hostname (22px/700) with the online/offline dot inline before it, OS icon on the right edge (Windows-only currently, a simple square-grid glyph, not a licensed logo).

**Summary section** — three columns (System/Identifiers/Activity), deliberately not duplicating System below. Company, Class, Enrolled/Device ID, Agent Version, AV status badge, Last seen, Last Reboot (derived: `lastSeen - uptime_seconds`), Last Audit, Uptime. Deliberately excludes anything with no real Beacon data behind it (M365 User, PSA Device ID, SNMP Credential, Patch Status summary badge) rather than faking values.

**System section** — Change Log button, then two columns: System (OS/Version/Display Ver./Install Type/Architecture/Domain/Last User/AV Product/Firewall/Warranty [the one editable field]/Services count) and Hardware (Manufacturer/Model/Motherboard/Serial/Processor/Cores/BIOS/Display Adapters). No RAM/disks/network here (those own sections).

**Memory / Storage / Network** — single-topic sections, no two-column grid. Network shows External IP (from `checkin.ts`'s `CF-Connecting-IP`) above the audit-sourced adapter list.

**Policies** — a plain Policy/Scope/Monitor-count table, click-through to the policy edit page (deliberately not a full per-monitor breakout).

**Change Log is a separate page** (`DeviceChangeLogPage.vue`, `/devices/:id/change-log`) — un-inlined once the inline section's lack of pagination/filtering became a real problem on `device_audit_changes`' unbounded growth.

## Coding patterns — Dashboard

### Reactive expand/select state
Use `reactive<Record<string, boolean>>`, not `ref<Set>` — Vue 3 doesn't reliably track Set mutations:
```typescript
const expanded = reactive<Record<string, boolean>>({});
function toggleExpand(id: string) {
  if (expanded[id]) delete expanded[id];
  else expanded[id] = true;
}
```

### API calls in parallel
```typescript
const [devices, companies] = await Promise.all([api.devices.list(), api.companies.list()]);
```

### `loading` ref must start `true` on an edit page, not `false`
A real bug found on `PatchPolicyFormPage.vue` and copy-pasted across four other full-page edit forms: `const loading = ref(false)` plus sequential preliminary fetches (companies/devices/groups/timezone) before `loading.value = true` meant the form rendered blank, then "Loading…", then real data — three renders, two visible flickers. Fix, applied everywhere this pattern exists:
```typescript
const loading = ref(!isNew.value); // never a bare false on an edit page

onMounted(async () => {
  const [companiesRes, devicesRes, groupsRes] = await Promise.allSettled([
    api.companies.list(), api.devices.list(), api.groups.list(),
  ]); // parallelized, not sequential — Promise.allSettled preserves each
      // fetch's independent "swallow failure, leave empty" behavior
  // ...then the real record fetch, gated on !isNew.value.
});
```
Verified live with Playwright (artificial 400ms delay, DOM sampled every 100ms) — the old code showed the blank-then-flicker sequence exactly as reported; the fix showed only "Loading…" throughout.

### Scroll-spy nav (one-page-with-anchor-nav, e.g. DeviceDetailPage)
`IntersectionObserver` rooted at `.page` (the app's real scroll container, not `window`), thin top-of-viewport detection band:
```typescript
scrollSpy = new IntersectionObserver((entries) => {
  const visible = entries.filter(e => e.isIntersecting);
  if (visible.length === 0) return;
  const topMost = visible.reduce((a, b) => a.boundingClientRect.top <= b.boundingClientRect.top ? a : b);
  activeSection.value = topMost.target.id.replace('ddev-sec-', '');
}, { root, rootMargin: '-16px 0px -70% 0px', threshold: 0 });
```
Doesn't touch the URL on scroll — only an explicit nav-item click does, via `router.replace`. **Bottom-of-scroll edge case**: a short trailing section can lose the topmost-visible tie-break even when fully scrolled down, since a taller preceding section still overlaps the detection band too. Fixed by explicitly forcing the last section active when `root.scrollTop + root.clientHeight >= root.scrollHeight - 2`, checked both inside the IO callback and in a `scroll` listener deferred via `setTimeout(fn, 0)` (covers the case where the final scroll increment changes no element's `isIntersecting` at all). `.page` is a persistent app-wide element — remove the `scroll` listener explicitly in `onUnmounted`.

### Policy list includes monitors
`GET /v1/admin/policies` returns `Policy[]` with `.monitors` already embedded — no second round-trip needed.

### New-vs-existing nested resource: defer-and-batch, or hit immediately
Established across every many-to-many nested relationship in this codebase (Component Companies/Variables, Policy Monitors/Targets, Group Members): on a `/new` page, every add/remove/edit is a local array mutation with zero API calls until the parent's own Save, which POSTs the parent then loops the accumulated items. On an edit page (real parent id in hand), every nested add/remove/edit hits its own endpoint immediately — no separate save step. A `removeAll`-style bulk action loops individual best-effort `DELETE`s rather than needing a dedicated bulk endpoint (self-hosted scale).

### Add-item flyout (multi-select, stays open across picks)
The `.sf-overlay`/`.sf-panel` right-side flyout (search + per-row Add/Remove toggle), originated in `ComponentFormPage.vue`'s Companies section, is now reused verbatim (same class names, duplicated per convention) anywhere a record needs "pick several of X" — Group members, Policy Device Groups, Policy/Job Targets. Full markup/CSS in STYLE.md.

### Settings list (`.pf-monitors`): label outside the box, always add an empty state
A section label must be a sibling above `.pf-monitors`, not a child (that element has no internal top-left padding). Any list with a `.pf-tbl-head` header needs a `v-if="!items.length"` empty-state branch, or a zero-row list renders as a bare header with nothing below it. Full markup in STYLE.md.

### Adding a new check_type to the Add Monitor drawer (PolicyFormPage)
Established over many check types added across sessions — each touches the same ~9 spots, always in this order: `checkTypeOptions` entry → `LocalMonitor` interface fields → `monPanel.form` defaults/reset/populate → `buildConfig()` → the `onMounted` config-parse mirror of `buildConfig()` → a `xSummary(m)` helper + switch case → matching cases in `GlobalPoliciesPage.vue` (duplicated, not shared) → a new `.chip-{type}` CSS color (palette is 10+ colors deep, check existing chips first) → the new UI block before the shared period/interval/priority row. Type-specific side effects on switching type go through `selectCheckType(ct)`, not an inline `@click`. Optional numeric fields use a checkbox toggling the value to `null` (meaning "condition disabled"), not a separate boolean flag.

## Icebox

Features explicitly considered and deferred — not rejected, just not now — are
tracked as issues in the **Beacon Development** GitHub Project with Status set
to **Icebox**. The Project is the source of truth; do not maintain a second list
here. Icebox issues should have no release milestone or Project Priority until
they are promoted into the active backlog. Preserve the reason for deferral and
the condition that would justify revisiting the work in the issue body.

## Commit rules

- No `Co-Authored-By` or Claude attribution lines in commits
- Do not add AI-generated co-author footers

## License

AGPL-3.0 (see `LICENSE` — added via GitHub's license template picker, not generated inline, since generating the full license text in-session reliably trips the content filter).
