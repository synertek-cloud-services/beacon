import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Metrics } from './types';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Device = typeof schema.devices.$inferSelect;
type PolicyMonitor = typeof schema.policyMonitors.$inferSelect;
type Policy = typeof schema.policies.$inferSelect;
type EffectiveMonitor = PolicyMonitor & { policy: Policy };

// ── Resolve which monitors apply to a device (company wins over global) ───────

async function resolveEffectiveMonitors(db: Db, device: Device): Promise<EffectiveMonitor[]> {
  const rows = await db.select()
    .from(schema.policies)
    .innerJoin(schema.policyMonitors, eq(schema.policyMonitors.policyId, schema.policies.id))
    .where(and(
      eq(schema.policies.enabled, true),
      eq(schema.policyMonitors.enabled, true),
    ));

  const devClass = device.overrideClass ?? device.detectedClass;

  const matched = rows.filter(row => {
    const p = row.policies;
    // Company-scoped policies only apply to their own company
    if (p.scope === 'company' && p.companyId !== device.tenantId) return false;
    const targetOs    = JSON.parse(p.targetOs)    as string[];
    const targetClass = JSON.parse(p.targetClass) as string[];
    const osOk    = targetOs.length    === 0 || (device.osType ? targetOs.includes(device.osType)       : false);
    const classOk = targetClass.length === 0 || (devClass      ? targetClass.includes(devClass)         : false);
    return osOk && classOk;
  });

  // Deduplicate: company-scoped wins over global per (check_type[, av_state])
  const byKey = new Map<string, EffectiveMonitor>();
  for (const row of matched) {
    const pm     = row.policy_monitors;
    const policy = row.policies;
    const cfg    = JSON.parse(pm.config) as Record<string, unknown>;
    const key    = pm.checkType === 'av_status' && cfg.av_state
      ? `av_status:${cfg.av_state}`
      : pm.checkType;

    const existing = byKey.get(key);
    if (!existing || policy.scope === 'company') {
      byKey.set(key, { ...pm, policy });
    }
  }

  return [...byKey.values()];
}

// ── In-band: called from check-in after inventory is updated ─────────────────

export async function evaluateCheckinAlerts(
  DB: D1Database,
  device: Device,
  metrics: Metrics,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });
  const monitors = await resolveEffectiveMonitors(db, device);

  for (const monitor of monitors) {
    if (monitor.checkType === 'offline') continue; // handled by cron
    const failed = evaluateCheck(monitor, metrics);
    await processAlertState(db, device, monitor, failed, now);
  }
}

// ── Out-of-band: called from the cron scheduled handler ──────────────────────

export async function evaluateOfflineAlerts(
  DB: D1Database,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  const allDevices = await db.select()
    .from(schema.devices)
    .where(eq(schema.devices.status, 'approved'));

  for (const device of allDevices) {
    const monitors = await resolveEffectiveMonitors(db, device);
    const offlineMonitors = monitors.filter(m => m.checkType === 'offline');

    for (const monitor of offlineMonitors) {
      const cfg = JSON.parse(monitor.config) as { offline_after_seconds: number };
      const isOffline =
        device.lastSeen === null ||
        device.lastSeen < now - cfg.offline_after_seconds;
      await processAlertState(db, device, monitor, isOffline, now);
    }
  }
}

// ── Shared logic ─────────────────────────────────────────────────────────────

function evaluateCheck(monitor: PolicyMonitor, metrics: Metrics): boolean {
  const cfg = JSON.parse(monitor.config) as Record<string, unknown>;
  switch (monitor.checkType) {
    case 'disk_space':
      return metrics.disk_free_bytes < (cfg.bytes_free_min as number);
    case 'cpu_usage':
      return metrics.cpu_percent !== undefined && metrics.cpu_percent > (cfg.percent_max as number);
    case 'memory_usage':
      return metrics.memory_percent !== undefined && metrics.memory_percent > (cfg.percent_max as number);
    case 'av_status': {
      const status = metrics.av_status;
      if (!status) return false;
      return status === (cfg.av_state as string);
    }
    default:
      return false;
  }
}

async function processAlertState(
  db: Db,
  device: Device,
  monitor: EffectiveMonitor,
  failed: boolean,
  now: number,
): Promise<void> {
  const existing = await db.select()
    .from(schema.alertState)
    .where(and(
      eq(schema.alertState.deviceId, device.id),
      eq(schema.alertState.policyMonitorId, monitor.id),
    ))
    .get();

  if (!existing) {
    await db.insert(schema.alertState).values({
      id:                 crypto.randomUUID(),
      deviceId:           device.id,
      policyMonitorId:    monitor.id,
      conditionFirstSeen: failed ? now : null,
      isAlerting:         false,
      updatedAt:          now,
    });
    return;
  }

  if (failed) {
    const firstSeen      = existing.conditionFirstSeen ?? now;
    const sustainedSecs  = monitor.sustainedMinutes * 60;
    const sustained      = (now - firstSeen) >= sustainedSecs;
    const shouldFire     = sustained && !existing.isAlerting;

    await db.update(schema.alertState)
      .set({
        conditionFirstSeen: existing.conditionFirstSeen ?? now,
        isAlerting:         shouldFire || existing.isAlerting,
        alertedAt:          shouldFire ? now : existing.alertedAt,
        updatedAt:          now,
      })
      .where(eq(schema.alertState.id, existing.id));

    if (shouldFire) {
      await fireWebhooks(db, device, monitor, 'alert.triggered', now);
    }
  } else {
    const wasAlerting     = existing.isAlerting;
    const shouldAutoResolve =
      wasAlerting &&
      monitor.autoResolve &&
      existing.alertedAt !== null &&
      (now - existing.alertedAt) >= monitor.autoResolveAfterMinutes * 60;

    await db.update(schema.alertState)
      .set({
        conditionFirstSeen: null,
        isAlerting:         shouldAutoResolve ? false : existing.isAlerting,
        resolvedAt:         shouldAutoResolve ? now   : existing.resolvedAt,
        updatedAt:          now,
      })
      .where(eq(schema.alertState.id, existing.id));

    if (wasAlerting && shouldAutoResolve) {
      await fireWebhooks(db, device, monitor, 'alert.resolved', now);
    }
  }
}

async function fireWebhooks(
  db: Db,
  device: Device,
  monitor: EffectiveMonitor,
  event: 'alert.triggered' | 'alert.resolved',
  now: number,
): Promise<void> {
  const webhooks = await db.select()
    .from(schema.webhookEndpoints)
    .where(and(
      eq(schema.webhookEndpoints.tenantId, device.tenantId),
      eq(schema.webhookEndpoints.enabled, true),
    ));

  if (!webhooks.length) return;

  const body = JSON.stringify({
    event,
    timestamp:  now,
    device_id:  device.id,
    tenant_id:  device.tenantId,
    hostname:   device.hostname,
    check_type: monitor.checkType,
    monitor_id: monitor.id,
    policy_id:  monitor.policyId,
    config:     JSON.parse(monitor.config),
  });

  await Promise.allSettled(
    webhooks.map(wh =>
      fetch(wh.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    )
  );
}
