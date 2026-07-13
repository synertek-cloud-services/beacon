# Beacon — CLAUDE.md

Self-hosted RMM platform built for Synertek Cloud Services (developed by CodeNexus). Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard.

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
- Module: `github.com/synertekcs/beacon/agent`
- Check-in interval: 60 seconds
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, cpu_percent, memory_percent, detected_class, av_status, av_product
- Audit (full inventory snapshot) fires 5 min after startup, then every 24 h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them)

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

Latest migration: `0011_default_policies.sql` (seeds default global policies).

## Two-Tier Policy / Monitor System

The alert/monitoring system uses a **policy → monitor** hierarchy. The old flat `alert_definitions` table is gone.

### Tables
- `policies` — named policy with scope (`global` or `company`), OS/class targeting (JSON arrays), enabled flag
- `policy_monitors` — individual check rules attached to a policy: check_type, config (JSON thresholds), alert_priority, sustained_minutes, auto_resolve, auto_resolve_after_minutes
- `alert_state` — per (device, policy_monitor) pair: condition_first_seen, is_alerting, alerted_at, resolved_at

### Check types

| Type | Config key | Evaluated |
|---|---|---|
| `disk_space` | `bytes_free_min` | On each check-in |
| `cpu_usage` | `percent_max` | On each check-in |
| `memory_usage` | `percent_max` | On each check-in |
| `offline` | `offline_after_seconds` | Cron (every 2 min) |
| `av_status` | `av_state` | On each check-in |

### Scope resolution
Company-scoped policies win over global for the same check_type on a device belonging to that company. The map key for av_status monitors is `av_status:${av_state}` (allows multiple AV monitors per policy).

### Default global policies (seeded)
- **Antivirus Health** — 3 monitors: not_detected (critical/5m), not_running (high/10m), running_not_up_to_date (moderate/60m)
- **Disk Space** — 1 monitor: < 10 GB free (high/5m)
- **Device Offline** — 1 monitor: offline after 30 min (high, auto-resolves in 30m)

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

## Commit rules

- No `Co-Authored-By` or Claude attribution lines in commits
- Do not add AI-generated co-author footers
