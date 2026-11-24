# Scalability and cost design

Status: proposal. Describes where Beacon's Cloudflare cost and limits come from, and the
planned changes to keep the self-hosted free tier useful and hosted (Spirewick) cost low.

## Goals

1. **Free tier first.** A family IT tech or small business must be able to run Beacon on
   Cloudflare's free plan for a handful of devices, and more devices is better.
2. **Advanced features are opt-in.** Anything that spends free-tier budget is off by
   default, and enabling it shows a notice that a paid Cloudflare plan may be needed.
   Nothing is paywalled in the open-source project.
3. **No on-prem or offline mode.** Cloudflare is the only supported runtime. Forks may port it.
4. **Hosted (Spirewick) runs the same code**, one Workers for Platforms tenant per customer,
   with every flag available.

## Where the budget goes today

Free-plan limits that bind: 10ms CPU per request, 100k Worker requests/day, 100k D1 rows
written/day, 5M D1 rows read/day.

A steady-state check-in (no command results) issues one `UPDATE devices` that rewrites the
whole row, including the `inventory` JSON blob (all sampled metrics), then evaluates policy,
maintenance and alert logic. After #226-#230 it measures about 9ms CPU. At a 60s interval that
is 1,440 requests and at least 1,440 D1 row writes per device per day, so the free plan caps
out at roughly 50-70 devices, bound by writes and requests, not CPU.

Rough paid-plan cost per device per month at 60s check-ins is dominated by D1 writes
(about $0.03-0.10), with requests and CPU about $0.01 each. Prices must be re-verified before
any commercial projection.

## Cost classes

| Class | Meaning | Default |
|---|---|---|
| Free-safe | Fits the free tier at the documented device count | On |
| Budget-costing | Adds per-check-in CPU, D1 writes or DO usage | Off, opt-in with notice |
| Frozen | No known user; no new work | Unchanged |

Free-safe core: enrollment, check-in, offline/disk/antivirus/memory/CPU alerts with editable
thresholds, inventory audit, Web Remote and Remote Shell, patch approval/install, Jobs and
run-script, local accounts and roles, companies, email notification.

Budget-costing candidates: custom two-tier policies and company overrides, agent-measured
checks (ping, process, service, file size), device groups and maintenance policies,
Network Discovery, Windows/Microsoft Update takeover and drift, webhooks, SSO group mapping,
branding themes, configurable dashboards, instant push (DeviceHub).

## Changes

### 1. Feature flags (`host_settings`)
Read through the existing per-isolate cache so flags add no D1 round trip. A flag must gate
the work, not only the UI: with custom policies off, check-in skips policy resolution,
maintenance lookups and group fetches entirely.

### 2. Alert evaluation off the request path
Move sampled-metric alerts (disk, cpu, memory, av) to the 2-minute cron. Check-in then only
stores metrics. Agent-measured check assignments are precomputed per device (on cron or on
policy edit) and read back by check-in. `runScheduledMaintenance` is already the single entry
point shared by the native Cron Trigger and Spirewick's `/internal/scheduled` route, so this
work lands once for both.

### 3. DeviceHub (instant push + cheap heartbeat)
One hibernating WebSocket per agent to a per-device Durable Object.

- Incoming messages bill 20:1; outgoing messages, pings and auto-response are free; no
  duration billing while hibernated. The DO holds `last_seen` and latest metrics and flushes
  to D1 every few minutes or on a state change, cutting writes roughly 20x.
- Push (commands, sessions, jobs) reaches an idle device in tens of milliseconds.
- Spike result (2h soaks, WSL and a Vultr VM): connections drop (code 1006) every 30-60 min on
  a clean network and more often on a home network, reconnecting in about 2s. Pushes during a
  drop are lost. So: one socket per device (close older on connect), reconnect with backoff,
  real heartbeat messages for liveness (the free auto-response does not prove the agent is
  alive), and an HTTP poll fallback every ~5 minutes as the delivery guarantee.
- Needs an agent release. Old agents keep working over HTTP; Fast Poll remains for them.

### 4. Cost model in the calculator
Extend the runbeacon calculator to model CPU, per-feature budget cost and the DeviceHub write
reduction, and drive the opt-in notice text from it.

## Limits to monitor
- D1: 10GB per database and single-writer throughput. Not a concern at small-business scale;
  the wall for a single tenant with thousands of devices.
- Durable Object and WfP pricing: re-check before Spirewick pricing is fixed.
- Lock-in: the `SessionRelay` and DeviceHub Durable Objects are the hardest parts to port.
  Keep DeviceHub state behind one interface.

## Order of work
1. Measure real per-check-in writes and rows from analytics; load-test on `beacon-sandbox`.
2. Fixed built-in alerts evaluated on cron; precomputed check assignments.
3. Feature flags gating check-in work.
4. DeviceHub server + agent change + fallback.
5. Calculator and docs update.
