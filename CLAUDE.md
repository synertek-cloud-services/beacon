# Beacon — CLAUDE.md

Self-hosted RMM platform built for Synertek Cloud Services (developed by CodeNexus). Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard.

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations (0000 … 0008)
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
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, cpu_percent, memory_percent, detected_class
- Audit (full inventory snapshot) fires 5 min after startup, then every 24 h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them)

**Dashboard** (`dashboard/src/`)
- Router: Vue Router with hash history (`createWebHashHistory`)
- Routes defined in `main.ts`
- All API calls via `dashboard/src/api.ts`; base URL from `VITE_API_URL` env var
- `VITE_API_URL` set in `dashboard/.env.production` — must not be undefined in prod or all requests hit Pages origin

## Database

Migrations live in `migrations/` (not inside `worker/`). Drizzle points there via `wrangler.toml`. When adding a schema change:
1. Add a new migration file `migrations/XXXX_description.sql`
2. Run `make db-generate` to regenerate Drizzle types
3. Run `make migrate-local` to test locally
4. Run `make migrate-remote` after deploying the worker

## Alert / Monitor system

Check types: `disk_space`, `offline`, `cpu_usage`, `memory_usage`

| Type | Threshold key | Evaluated |
|---|---|---|
| `disk_space` | `bytes_free_min` | On each check-in |
| `cpu_usage` | `percent_max` | On each check-in |
| `memory_usage` | `percent_max` | On each check-in |
| `offline` | `offline_after_seconds` | Cron (every 2 min) |

Alert state is tracked per (device, alertDefinition) pair in the `alert_state` table. Webhooks fire on `alert.triggered` / `alert.resolved` events.

## Key backend routes

```
POST /v1/enroll                         Agent enrollment
POST /v1/check-in                       Agent heartbeat + command exchange
POST /v1/audit                          Agent inventory audit snapshot

GET  /v1/admin/summary                  Device counts by status/OS/class
GET  /v1/admin/tenants                  List companies
GET  /v1/admin/devices                  List devices (filterable)
GET  /v1/admin/alerts                   Global alert state feed
GET  /v1/admin/alert-definitions        Monitor rules (global or ?tenant_id=)
POST /v1/admin/alert-definitions        Create monitor rule
GET  /v1/admin/jobs                     Automation jobs
GET  /v1/admin/components               Script component library
```

## Commit rules

- No `Co-Authored-By` or Claude attribution lines in commits
- Do not add AI-generated co-author footers
