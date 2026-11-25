import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { runScheduledMaintenance } from '../src/lib/scheduled-maintenance';
import { sha256hex } from '../src/lib/crypto';

// Guardrails for the free-plan budget (docs/SCALABILITY_DESIGN.md): a check-in
// must stay cheap, must not get more expensive as the fleet grows, and the
// scheduled run must keep working (and stay bounded) on a big fleet. Each D1
// call a request makes is a "query"; Cloudflare caps queries per invocation and
// every one costs CPU and latency, so a PR that quietly adds one to the hot
// path should have to change a number here on purpose.

interface Counts { queries: number }

// Wraps a D1 binding and counts executions (run/all/first/raw), plus one per
// batch() or exec() call -- the same units Cloudflare's per-invocation limit uses.
function countingDb(db: D1Database, counts: Counts): D1Database {
  const wrapStatement = (st: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(st, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === 'bind') return (...a: unknown[]) => wrapStatement((v as Function).apply(target, a));
        if (prop === 'run' || prop === 'all' || prop === 'first' || prop === 'raw') {
          return (...a: unknown[]) => { counts.queries++; return (v as Function).apply(target, a); };
        }
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === 'batch' || prop === 'exec') return (...a: unknown[]) => { counts.queries++; return (v as Function).apply(target, a); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const NOW = Math.floor(Date.now() / 1000);
const COMPANY = 'budget-co';

async function seedFleet(count: number, opts: { lowDisk?: boolean } = {}) {
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT OR IGNORE INTO companies(id,name,auto_approve_default,privacy_mode_default,status,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(COMPANY, 'Budget Co', 1, 0, 'active', NOW),
    env.DB.prepare(`INSERT OR IGNORE INTO enrollment_tokens(id,company_id,token_hash,agent_type,use_count,created_at,created_by) VALUES(?,?,?,?,?,?,?)`)
      .bind('budget-tok', COMPANY, 'h', 'windows', 0, NOW, 'test'),
  ];
  for (let i = 0; i < count; i++) {
    const metrics = {
      hostname: `BUDGET-${i}`, os_type: 'windows', os_version: '11', uptime_seconds: 100000,
      disk_free_bytes: opts.lowDisk ? 2e9 : 2e11,
      disks: [{ device: 'C:', label: 'C', total_bytes: 5e11, free_bytes: opts.lowDisk ? 2e9 : 2e11 }],
      detected_class: 'workstation', cpu_percent: 10, memory_percent: 40, av_status: 'healthy', av_product: 'Defender',
    };
    stmts.push(
      env.DB.prepare(`INSERT OR REPLACE INTO devices(id,company_id,enrollment_token_id,agent_type,device_credential_hash,status,hostname,os_type,detected_class,agent_version,last_seen,inventory,created_at,pending_reboot_required) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(`budget-${i}`, COMPANY, 'budget-tok', 'windows', await sha256hex(`budget-cred-${i}`), 'approved', `BUDGET-${i}`, 'windows', 'workstation', '0.4.2', NOW, JSON.stringify(metrics), NOW, 0),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function checkIn(index: number, counts: Counts): Promise<Response> {
  const body = {
    device_id: `budget-${index}`, tenant_id: COMPANY, timestamp: Math.floor(Date.now() / 1000), agent_version: '0.4.2',
    metrics: {
      hostname: `BUDGET-${index}`, os_type: 'windows', os_version: '11', uptime_seconds: 100001, disk_free_bytes: 2e11,
      disks: [{ device: 'C:', label: 'C', total_bytes: 5e11, free_bytes: 2e11 }],
      detected_class: 'workstation', cpu_percent: 10, memory_percent: 40, av_status: 'healthy', av_product: 'Defender',
    },
  };
  const e = { ...env, DB: countingDb(env.DB, counts) } as typeof env;
  return worker.fetch(new Request('https://beacon.test/v1/check-in', {
    method: 'POST',
    headers: { Authorization: `Bearer budget-cred-${index}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), e);
}

// Exact ceilings for an idle check-in (no commands, no assignments): a warm
// check-in is 3 queries (find the device, update it, look for queued commands)
// and a cold isolate is 8 (it also fills the policy/maintenance/feature caches).
// They are deliberately not padded: a PR that adds a query to this path has to
// raise the number here, which puts the cost in front of a reviewer. This path
// runs for every device on every poll, and each query is CPU and latency.
const IDLE_CHECKIN_WARM_QUERY_BUDGET = 3;
const IDLE_CHECKIN_COLD_QUERY_BUDGET = 8;
// Scheduled run over a 250-device fleet with every device breaching: 117 today.
const SCHEDULED_RUN_QUERY_BUDGET = 140;

describe('check-in query budget', () => {
  it('an idle check-in stays within its query budget', async () => {
    await seedFleet(1);
    const counts = { queries: 0 };
    await checkIn(0, counts); // warm per-isolate caches (policy, maintenance, features)
    const warm = { queries: 0 };
    const res = await checkIn(0, warm);
    expect(res.status).toBe(200);
    expect(counts.queries).toBeLessThanOrEqual(IDLE_CHECKIN_COLD_QUERY_BUDGET);
    expect(warm.queries).toBeLessThanOrEqual(IDLE_CHECKIN_WARM_QUERY_BUDGET);
  });

  it('a check-in costs the same on a 1-device fleet and a 150-device fleet', async () => {
    await seedFleet(1);
    const small = { queries: 0 };
    await checkIn(0, { queries: 0 });
    await checkIn(0, small);

    await seedFleet(150);
    const big = { queries: 0 };
    await checkIn(75, { queries: 0 });
    const res = await checkIn(75, big);
    expect(res.status).toBe(200);
    // A query that scales with fleet size (the original CPU regression's shape)
    // would show up as a difference here long before it shows up in production.
    expect(big.queries).toBe(small.queries);
  });
});

describe('scheduled maintenance at fleet scale', () => {
  it('completes on a fleet past D1\'s 100-bound-parameter limit and stays bounded', async () => {
    await seedFleet(250, { lowDisk: true });
    const counts = { queries: 0 };
    const e = { ...env, DB: countingDb(env.DB, counts) } as typeof env;
    // Throws (D1 "too many SQL variables") if any list query binds one id per device.
    await runScheduledMaintenance(e);
    // Per-run work is capped (alert writes, first-time dispatches) so it stays far
    // below Cloudflare's per-invocation query limit however large the fleet is.
    expect(counts.queries).toBeLessThanOrEqual(SCHEDULED_RUN_QUERY_BUDGET);
  });
});
