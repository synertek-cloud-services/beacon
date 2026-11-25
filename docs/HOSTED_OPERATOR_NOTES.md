# Notes for anyone hosting Beacon for others

For operators who run Beacon on behalf of customers (a control plane that
provisions one Worker + D1 + R2 + Durable Objects per customer, for example
Spirewick on Workers for Platforms). Self-hosters get the same changes through
`wrangler.toml.example`; this file lists what a **provisioning/deployment
layer must change** when Beacon changes. Newest first.

**Rule for contributors (human or AI):** any Beacon change that adds or alters a
binding, var, secret, migration, scheduled-job behavior, WebSocket route, or
dashboard/Worker version coupling gets an entry here in the same PR.

Each entry: what changed, what a hosted deployment must do, what happens if it doesn't.

---

## 2026-11-25 — Instant push, feature flags, scale fixes (Beacon agent v0.4.1 / v0.4.2)

Source: PRs #232–#244; design in `docs/SCALABILITY_DESIGN.md`.

### 1. New Durable Object binding: `DEVICE_HUB` (required for instant push)
- Add to each tenant Worker: binding `DEVICE_HUB` → class `DeviceHub`
  (exported from the same bundle as `SessionRelay`).
- Add migration **`tag = "v2"`, `new_sqlite_classes = ["DeviceHub"]`** after the
  existing `v1`. SQLite-backed is required on the Workers free plan.
- Optional by design: without the binding, `GET /v1/agent/ws` returns 404 and
  agents fall back to polling every 60s. Nothing breaks.
- Must still be proven on Workers for Platforms: that adding a Durable Object
  class to an existing tenant script applies the migration, and that a content
  update does not strand existing objects (same open question as `SessionRelay`).
- Routing: agents v0.4.1+ open `wss://<tenant-host>/v1/agent/ws`
  (`Authorization: Bearer <device credential>`). A dispatch layer that proxies
  by hostname must pass WebSocket upgrades on that path through to the tenant
  Worker unbuffered. The socket is hibernating and idle almost all the time.

### 2. New var: `FEATURES_ALL=true` (required for a hosted offering)
- Beacon now ships five opt-in feature switches that are **off on a fresh
  install**: Network Discovery, Application Components, Webhooks,
  Windows/Microsoft Update management, agent-measured monitors.
- A new tenant's D1 has no devices when migration `0087` runs, so every flag
  starts off. A managed host should set the plain-text var **`FEATURES_ALL=true`**
  on each tenant Worker: every feature is treated as on, and the Settings >
  Features page shows them as managed by the host (edits return 409).
- If not set, tenants see "turned off" notices and the matching APIs return 403
  `{code:"feature_disabled"}` until an admin turns them on.

### 3. New D1 migrations: `0086`, `0087`
- `0086_commands_device_status_index.sql` (indexes that cut the main D1 read cost)
  and `0087_feature_flags.sql` (five columns on `host_settings`).
- Apply to every tenant database before (or atomically with) deploying the new
  Worker code. Code that reads the new columns fails on an unmigrated database.

### 4. Scheduler: each run is now bounded
- `POST /internal/scheduled` (header `X-Beacon-Scheduler-Secret`, secret var
  `INTERNAL_SCHEDULER_SECRET`) still runs the 2-minute maintenance. Behavior
  changes a hosted scheduler should expect:
  - Work per run is capped so one tenant stays under Cloudflare's per-invocation
    D1 query limit: first-time Windows/Microsoft Update management commands go
    out 200 per run, and at most 80 alert state changes are processed per run.
    Large fleets converge over several runs; it is not a failure.
  - Measured at 2,000 devices in one database: ~160 ms CPU, ~1.1 s median wall
    time (up to ~7 s on a busy run). Fan out per tenant; do not run tenants
    sequentially in one invocation.
  - A run that throws (e.g. D1 "overloaded") is safe to retry on the next tick;
    all of it is stateless.

### 5. Worker and dashboard must be deployed as a matched pair
- The shared dashboard build gained a Settings > Features page and a
  feature-state store that call `GET /v1/admin/settings/features`, and the
  `/v1/admin/devices/:id/fast-poll` route was **removed** (Fast Poll is gone).
  An old dashboard against a new Worker shows a dead "Fast Poll" button; a new
  dashboard against an old Worker 404s on the features call (it fails open, so
  features appear on). Roll both together.

### 5a. Agent releases
- v0.4.1: wake socket + 4-minute poll while connected.
- v0.4.2: ±10% jitter on the poll interval (stops a fleet that restarts
  together from checking in as a synchronized herd).
- Old agents keep working (60 s poll).

### 6. Capacity and cost data for pricing / sizing
Measured on a deployed Beacon with 2,000 simulated devices in one D1 database
(simulated traffic from one machine, not real agents):
- Check-ins sustained up to 100 requests/s all succeeded (~130 ms median,
  ~2.5 ms Worker CPU each). That is about 6,000 devices polling every minute
  or about 24,000 at the 4-minute connected cadence.
- An unpaced burst above ~150 requests/s makes D1 reject some requests with
  `D1_ERROR: D1 DB is overloaded` (agents retry on their next poll).
- Per device per day with instant push: ~360 check-ins, ~360 D1 row writes,
  ~48 WebSocket connects (each a Worker request), +2 audit/update requests.
  Idle keep-alive pings are auto-answered and free. Rough usage cost at
  published paid-plan rates is on the order of a couple of cents per device per
  month; verify current prices before using it commercially.
- Older Beacon Workers stop running scheduled jobs once a fleet passes ~93
  devices (D1's 100-bound-parameter limit). Fixed in #242; make sure no tenant
  runs a Worker older than that.

### 7. Diagnostics
- Unhandled errors now log the underlying D1 error (`cause:`), visible in
  `wrangler tail`. Previously only a generic "Failed query" appeared.

### 8. Not yet verified
- DeviceHub at thousands of simultaneous sockets.
- The Workers Free plan's own (lower) per-invocation D1 query limit.
- Any of the above on Workers for Platforms specifically.
