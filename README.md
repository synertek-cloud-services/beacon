# Beacon

Beacon is a self-hosted Remote Monitoring & Management (RMM) platform. It runs a lightweight Go agent on managed endpoints (Windows, macOS, Linux), a Cloudflare Workers backend for check-ins and administration, and a Vue 3 dashboard for day-to-day operations.

It covers the core of what a commercial RMM product does — device enrollment and approval, policy-based monitoring and alerting, remote shell sessions, scripted automation jobs, and inventory auditing — without a per-endpoint license fee, running entirely on infrastructure you control.

## Architecture

```
agent/        Go agent — runs on managed endpoints, checks in every 60s
worker/       Cloudflare Worker (Hono + D1) — backend API, cron alert evaluation,
              Durable Object for remote shell/TCP tunnel sessions
dashboard/    Vue 3 + Vite SPA — the admin UI (Cloudflare Pages)
migrations/   D1 SQL migrations
scripts/      Utility scripts (local dev seeding, etc.)
```

Data flow: agents enroll against the Worker API, then check in once a minute with host metrics (disk, CPU, memory, uptime, AV status). The Worker evaluates check-ins against a **policy → monitor** system (see below) and raises alerts. Remote shell/TCP sessions are proxied through a Durable Object so a technician's browser can reach an endpoint with no inbound firewall rule needed.

## Features

- **Device enrollment & approval** — token-based enrollment, per-tenant auto-approve or manual review
- **Policy-based monitoring** — global or per-company policies, each made of one or more monitors (disk space, CPU/memory usage, antivirus health, device online/offline, file size, ping reachability/latency/packet-loss, process state, Windows service state, software install/uninstall/version-change)
- **Alerting** — sustained-condition debounce, auto-resolve, webhook notification
- **Remote shell & TCP tunnel sessions** — browser-based, no agent-side listening port
- **Scripted automation** — a reusable script/component library, dispatched as one-off or scheduled jobs across a device selection
- **Inventory auditing** — full hardware/software/services snapshot on enrollment, every 24h, or on demand
- **Multi-tenant** — companies, contacts, locations, per-tenant defaults

## Quick start (self-hosting)

### Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- Go 1.22+
- A [Cloudflare account](https://dash.cloudflare.com/) (Workers + D1 + Pages)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (`npx wrangler`, no global install needed)

### 1. Worker setup

```bash
cd worker
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`: set your own D1 `database_name`/`database_id` (`npx wrangler d1 create beacon`), and your own custom domain route (or remove the `[[routes]]` block to use the default `workers.dev` subdomain).

Create `worker/.dev.vars` for local development:

```
ADMIN_SECRET="pick-a-long-random-string"
```

Then:

```bash
make migrate-local     # apply migrations to local D1
make dev                # wrangler dev
```

For production: `make migrate-remote` (after creating your D1 database and setting the `ADMIN_SECRET` secret via `npx wrangler secret put ADMIN_SECRET`), then `make deploy`.

### Optional fictional demo worlds

After migrations, an operator can populate a **fresh** D1 database with a
fictional demo world for evaluation, screenshots, or local development. Demo
worlds are never applied by migrations and do not create users, SSO settings,
real enrollment tokens, or usable agent credentials.

Available worlds: `matrix`, `minecraft`, `holy-grail`, `fallout`, and
`star-trek`. Each provides sites, contacts, mixed endpoint states, inventory,
device groups, custom fields, alerts, and job history.
They intentionally cannot open Remote Shell or TCP sessions because no live
agent is behind a demo endpoint.

```bash
# Seed a fresh local database.
make seed-demo-local WORLD=matrix

# Rebuild the local database from all migrations, then seed it. This destroys
# local D1 data and requires the explicit reset target.
make seed-demo-reset WORLD=minecraft

# Seed a fresh remote database. This refuses a non-empty database and requires
# an explicit acknowledgement; remote reset is deliberately unsupported.
node scripts/seed-demo.mjs --world fallout --remote --allow-remote
```

Run `node scripts/seed-demo.mjs --help` for a custom database binding or local
Wrangler persistence path. Demo packs use lore-inspired names only; they do
not include third-party images, logos, or dialogue excerpts.

### Maintainer release automation

Beacon's own production releases are performed by GitHub Actions after an
approved PR is merged to `main`. The workflow applies D1 migrations, deploys
the Worker, builds/deploys Pages, and checks Worker health in that order. It
requires these one-time GitHub repository settings:

- Secret `CLOUDFLARE_API_TOKEN` — scoped to deploy the Worker and Pages and
  modify the production D1 database.
- Secret `WORKER_WRANGLER_TOML` — the organization-specific
  `worker/wrangler.toml` content, kept out of source control.
- Variable `CLOUDFLARE_PAGES_PROJECT` — the Pages project name.
- Variable `PRODUCTION_WORKER_URL` — the Worker health-check origin.

Disable automatic production Pages deployments in Cloudflare; otherwise Pages
can publish the frontend before its Worker and database changes are released.

### 2. Dashboard setup

```bash
cd dashboard
cp .env.production.example .env.production
```

Edit `.env.production` to point `VITE_API_URL` at your deployed Worker URL. Then:

```bash
pnpm install
pnpm dev          # local dev server on :5173
pnpm run build    # production build (type-check + vite build) for Cloudflare Pages
```

Set the dashboard's Cloudflare Pages project root directory to `dashboard`, build command to `pnpm run build`, output directory to `dist`.

### 3. Agent

```bash
make build-agent-windows   # dist/agent-windows-amd64.exe
make build-agent-linux     # dist/agent-linux-amd64
make build-agent-darwin    # dist/agent-darwin-arm64
```

The agent needs the Worker's enrollment endpoint URL and a per-tenant enrollment token (create one from the dashboard's Companies page) at first run.

## Database migrations

Migrations live in `migrations/`, applied via Wrangler/D1 — see `make migrate-local` / `make migrate-remote` above. `worker/src/db/schema.ts` is hand-kept in sync with the migrations rather than auto-generated; when adding a schema change, add a new migration file and hand-edit `schema.ts` to match.

## Security notes

- `ADMIN_SECRET` is a single shared bearer token gating all `/v1/admin/*` routes and remote session access — treat it like a root password. There's no per-user account system yet.
- The agent-to-Worker enrollment/check-in flow uses per-device tokens, not the admin secret.
- Released agent binaries are Ed25519-signed; see `agent/tools/keygen` and `agent/tools/sign`. Keep the private key out of source control (CI secret only).

## License

Beacon is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See `LICENSE`.
