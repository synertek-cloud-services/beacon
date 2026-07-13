# Beacon — CLAUDE.md

Self-hosted RMM platform, originally built for Synertek Cloud Services (developed by CodeNexus), now open-sourced under AGPL-3.0. Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard. See `README.md` for the human-facing overview and self-hosting quick start — this file is the AI-assistant-facing architecture/convention reference.

## Project status (as of 2026-07-13)

- **10 check types** shipped across the policy/monitor system (see Two-Tier Policy System below): `disk_space`, `cpu_usage`, `memory_usage`, `av_status`, `offline`, `file_size`, `ping`, `process`, `service`, `software`.
- **Multi-user auth + RBAC shipped and production-validated this session** (see Auth System below) — local email/password accounts, global roles (`admin`/`technician`/`readonly`), Microsoft Entra ID SSO with group-based auto-provisioning. The single shared `ADMIN_SECRET` model (previously the main open-source gap) is now a break-glass fallback only, not the primary auth path. **This went through a real production rollout this session** (real Entra app registration, real `wrangler deploy`, real Microsoft login) — not just local D1/curl testing — and that rollout caught three real bugs now fixed: a missing Graph OAuth scope, direct-only vs. transitive group membership, and a Cloudflare Workers PBKDF2 iteration cap. See PROJECT_LOG.md's "Production rollout follow-up" for details — worth reading before touching `worker/src/lib/password.ts` or `worker/src/lib/oidc.ts` again.
- **SSO group search** — Settings → Single Sign-On now has a live group-name search (backed by an app-only Graph client-credentials call) instead of requiring admins to paste a raw Entra group Object ID, with a manual-entry fallback.
- **Dashboard visual polish this session**: login page rebuilt (wider card, input icons, fixed a real letter-spacing bug, dropped hardcoded hex in favor of the app's actual CSS custom properties); sidebar collapse control replaced — see "Sidebar structure" below, no longer a topbar hamburger.
- **Open-sourced under AGPL-3.0** — repo is public. `LICENSE`, `README.md` in place; org-specific config (`wrangler.toml`, `dashboard/.env.production`) moved to gitignored files with `.example` templates; Go module path corrected to match the actual GitHub org.
- **Known gap**: the worker has no CI/CD — only the dashboard (Cloudflare Pages) auto-deploys on push to `main`. Every worker change needs a manual `cd worker && npx wrangler deploy`; there's no GitHub Actions workflow and no Cloudflare Workers Builds git integration configured.
- Everything else has been verified against local D1 + simulated check-ins/audits via curl, not a real deployed agent fleet — see PROJECT_LOG.md's "Next logical steps" for real-fleet validation status.

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations (0000 … 0016)
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

`worker/.dev.vars` already has `ADMIN_SECRET="beacon-local-admin-secret"` and a `CONFIG_ENCRYPTION_KEY` for local dev.

`ADMIN_SECRET` is compared via `worker/src/lib/auth.ts`'s `requireAdmin`/`timingSafeEqual` (hash-then-compare, not `===`) — now only reachable through `requireUser` (see Auth System below) as the break-glass fallback path. Never add a new inline `auth === \`Bearer ${secret}\`` check or a second hand-rolled admin check; every route goes through `requireUser`.

## Self-hosting config (not secrets, but org-specific — gitignored with `.example` templates)

`worker/wrangler.toml` and `dashboard/.env.production` are gitignored (real values are Synertek's own domain/D1 database, not committed for a public repo). Tracked `.example` counterparts (`worker/wrangler.toml.example`, `dashboard/.env.production.example`) hold placeholder values — anyone self-hosting copies the `.example` file and fills in their own domain/database ID. `worker/wrangler.toml`'s `[vars]` block (`ALLOWED_ORIGIN`, `PAGES_PREVIEW_SUFFIX`) drives the CORS allowlist in `worker/src/index.ts` — don't hardcode a domain back into `index.ts`.

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
- Durable Object: `SessionRelay` for shell/TCP tunnel sessions
- All admin routes under `/v1/admin/*` and `/v1/auth/*` require `Authorization: Bearer <token>` — either a real user session token or the `ADMIN_SECRET` break-glass token, resolved by `requireUser` (see Auth System below)
- CORS allows: production domain, localhost:5173, `*.beacon-dashboard-6f4.pages.dev`

**Agent** (`agent/`)
- Module: `github.com/synertek-cloud-services/beacon/agent` (matches the GitHub org this repo is published under)
- Check-in interval: 60 seconds
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, disks[] (multi-drive), cpu_percent, memory_percent, detected_class, av_status, av_product
- Check-in request also carries `pending_{file_size,ping,process,service}_results`; response carries `{file_size,ping,process,service}_checks` — see "Assign → measure → report pattern" below
- Audit (full inventory snapshot) fires 5 min after startup, then every 24 h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them)
- Internal packages worth knowing: `diskutil` (shared multi-drive enumeration between check-in and audit), `filesize`, `pingutil`, `procutil`, `svcutil` — each is a small `Find`/`Measure`/`Ping` function following the same shell-out-or-gopsutil convention as the older `audit` package's AV/BIOS collectors

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

Latest migration: `0016_users_auth.sql` (adds `users`, `user_sessions`, `sso_providers`, `sso_group_role_mappings`, `sso_login_state`, `sso_exchange_codes`, plus `sessions.client_auth_hash` — see Auth System below).

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

## Key backend routes

```
POST /v1/enroll                              Agent enrollment
POST /v1/check-in                            Agent heartbeat + command exchange
POST /v1/audit                               Agent inventory audit snapshot

GET  /v1/admin/summary                       Device counts by status/OS/class
GET  /v1/admin/tenants                       List companies
GET  /v1/admin/devices                       List devices (filterable)
GET  /v1/admin/alerts?status=active|all      Global alert state feed
POST /v1/admin/alerts/:id/resolve            Manually resolve an alert

GET  /v1/admin/policies?scope=&company_id=   List policies (with monitors embedded)
POST /v1/admin/policies                      Create policy (supports clone_from=)
PATCH  /v1/admin/policies/:id                Update policy fields + enabled
DELETE /v1/admin/policies/:id                Delete policy (cascades monitors)

GET  /v1/admin/policies/:id/monitors         List monitors for a policy
POST /v1/admin/policies/:id/monitors         Add monitor
PATCH  /v1/admin/policies/:id/monitors/:mid  Update monitor
DELETE /v1/admin/policies/:id/monitors/:mid  Delete monitor

GET  /v1/admin/jobs                          Automation jobs
GET  /v1/admin/components                    Script component library

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
```

## Dashboard routes

```
/                      OverviewPage
/login                 LoginPage
/sso-callback          SsoCallbackPage    (receives the Microsoft SSO redirect)
/devices               DevicesPage (filterable by ?company=<id>)
/tenants               TenantsPage
/jobs                  JobsPage
/components            ComponentsPage
/global/alerts         GlobalAlertsPage
/global/policies       GlobalPoliciesPage  (list — table with expand rows)
/global/policies/new   PolicyFormPage      (create — full page form)
/global/policies/:id   PolicyFormPage      (edit — full page form)
/settings/users        UsersPage           (admin only)
/settings/users/new    UserFormPage        (admin only)
/settings/users/:id    UserFormPage        (admin only)
/settings/sso          SsoSettingsPage     (admin only)
```
Admin-only routes carry `meta: { minRole: 'admin' }`; the router guard redirects non-admins to `/`.

## Sidebar structure (App.vue)

- **Overview** link
- **Companies** section: "All Companies" link + active-client block (appears when a company is selected via `?company=` query, persists until cleared)
- **Devices** link
- **Global** section: Alerts, Policies
- **Automation** section: Jobs, Components
- **Settings** section (admin role only, `v-if="hasRole('admin')"`): Users, Single Sign-On
- Sidebar footer shows the signed-in user's name/role above the Sign out button
- Resizable via drag handle (`.sidebar-resizer`); collapsible via a floating chevron button straddling the sidebar's right edge (`.sidebar-toggle-btn`, absolutely positioned relative to `.shell`) — not a topbar hamburger, see STYLE.md

Active client state: `activeClientId` ref set by watching `route.query.company`. Cleared with the × button on the client block.

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

### Policy list includes monitors
`GET /v1/admin/policies` returns `Policy[]` where each policy has a `.monitors` array already embedded. No second round-trip needed.

### New policy flow (PolicyFormPage)
1. Monitors accumulate in local `ref<LocalMonitor[]>` — no API calls until Save
2. On Save: POST policy → loop POST each monitor → navigate back
3. For edit: monitor add/edit/delete hit API immediately; policy field save is deferred to Save Changes button

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
