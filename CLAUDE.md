# Beacon — CLAUDE.md

Self-hosted RMM platform, originally built for Synertek Cloud Services (developed by CodeNexus), now open-sourced under AGPL-3.0. Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard. See `README.md` for the human-facing overview and self-hosting quick start — this file is the AI-assistant-facing architecture/convention reference.

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations (0000 … 0011)
scripts/      Utility scripts
Makefile      Top-level task runner
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
| `CLOUDFLARE_API_TOKEN` | direnv `.envrc` (gitignored) |
| Ed25519 private key (agent signing) | Password manager only |

`worker/.dev.vars` already has `ADMIN_SECRET="beacon-local-admin-secret"` for local dev.

`ADMIN_SECRET` is compared via `worker/src/lib/auth.ts`'s `requireAdmin`/`timingSafeEqual` (hash-then-compare, not `===`) everywhere it gates a route — never add a new inline `auth === \`Bearer ${secret}\`` check, import the shared helper instead.

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
- All admin routes under `/v1/admin/*` require `Authorization: Bearer <ADMIN_SECRET>`
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
- Sidebar is resizable (drag handle, stored in `localStorage` as `beacon-sidebar-w`) and collapsible (hamburger button, stored as `beacon-sidebar-collapsed`)

## Database

Migrations live in `migrations/` (not inside `worker/`). Drizzle points there via `wrangler.toml`. When adding a schema change:
1. Add a new migration file `migrations/XXXX_description.sql`
2. Run `make db-generate` to regenerate Drizzle types
3. Run `make migrate-local` to test locally
4. Run `make migrate-remote` after deploying the worker

Latest migration: `0015_check_interval.sql` (adds `policy_monitors.check_interval_minutes`). Migrations 0012-0015 (disk_space config v2, Memory Usage seed, CPU Usage seed, check_interval_minutes) all shipped this session — none of them touched `check_type`, since that column has no `CHECK` constraint (see Two-Tier Policy System below).

`worker/src/db/schema.ts` is hand-kept in sync with the migrations rather than generated — `migrations/meta/_journal.json` only tracks through migration 0003, so running `drizzle-kit generate` now would diff against a stale snapshot and produce a bogus catch-up migration. Don't run `make db-generate`; hand-edit `schema.ts` to match new migrations instead, consistent with how 0004 onward were actually done.

## Two-Tier Policy / Monitor System

The alert/monitoring system uses a **policy → monitor** hierarchy. The old flat `alert_definitions` table is gone.

### Tables
- `policies` — named policy with scope (`global` or `company`), OS/class targeting (JSON arrays), enabled flag
- `policy_monitors` — individual check rules attached to a policy: check_type, config (JSON, shape varies by check_type), alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes
- `alert_state` — per (device, policy_monitor) pair: condition_first_seen, is_alerting, alerted_at, resolved_at

`check_type` is a bare `TEXT` column with no SQL `CHECK` constraint — adding a new check type is a TS-enum-only change (`schema.ts`, `routes/admin/policies.ts` `VALID_CHECK_TYPES`, `dashboard/src/api.ts`) with **no migration required**.

### Check types

Eleven check types across three evaluation shapes:

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
```

## Dashboard routes

```
/                      OverviewPage
/login                 LoginPage
/devices               DevicesPage (filterable by ?company=<id>)
/tenants               TenantsPage
/jobs                  JobsPage
/components            ComponentsPage
/global/alerts         GlobalAlertsPage
/global/policies       GlobalPoliciesPage  (list — table with expand rows)
/global/policies/new   PolicyFormPage      (create — full page form)
/global/policies/:id   PolicyFormPage      (edit — full page form)
```

## Sidebar structure (App.vue)

- **Overview** link
- **Companies** section: "All Companies" link + active-client block (appears when a company is selected via `?company=` query, persists until cleared)
- **Devices** link
- **Global** section: Alerts, Policies
- Resizable via drag handle (`.sidebar-resizer`), collapsible via topbar hamburger button

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
