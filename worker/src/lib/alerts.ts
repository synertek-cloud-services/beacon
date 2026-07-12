import { and, eq, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Metrics } from './types';

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Device = typeof schema.devices.$inferSelect;
type AlertDef = typeof schema.alertDefinitions.$inferSelect;

// ── In-band: called from check-in after inventory is updated ─────────────────

export async function evaluateCheckinAlerts(
  DB: D1Database,
  device: Device,
  metrics: Metrics,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  const defs = await db.select()
    .from(schema.alertDefinitions)
    .where(and(
      eq(schema.alertDefinitions.tenantId, device.tenantId),
      eq(schema.alertDefinitions.enabled, true),
    ));

  for (const def of defs) {
    if (def.checkType === 'offline') continue; // handled by cron
    if (def.deviceId !== null && def.deviceId !== device.id) continue;

    const failed = evaluateCheck(def, metrics);
    await processAlertState(db, device, def, failed, now);
  }
}

// ── Out-of-band: called from the cron scheduled handler ──────────────────────

export async function evaluateOfflineAlerts(
  DB: D1Database,
  now: number,
): Promise<void> {
  const db = drizzle(DB, { schema });

  const defs = await db.select()
    .from(schema.alertDefinitions)
    .where(and(
      eq(schema.alertDefinitions.checkType, 'offline'),
      eq(schema.alertDefinitions.enabled, true),
    ));

  for (const def of defs) {
    const threshold = JSON.parse(def.threshold) as { offline_after_seconds: number };

    const effectiveClass = def.deviceClass
      ? or(
          and(isNull(schema.devices.overrideClass), eq(schema.devices.detectedClass, def.deviceClass)),
          eq(schema.devices.overrideClass, def.deviceClass),
        )
      : undefined;

    const devices = await db.select()
      .from(schema.devices)
      .where(and(
        eq(schema.devices.tenantId, def.tenantId),
        eq(schema.devices.status, 'approved'),
        def.deviceId ? eq(schema.devices.id, def.deviceId) : undefined,
        effectiveClass,
      ));

    for (const device of devices) {
      const isOffline =
        device.lastSeen === null ||
        device.lastSeen < now - threshold.offline_after_seconds;

      await processAlertState(db, device, def, isOffline, now);
    }
  }
}

// ── Shared logic ─────────────────────────────────────────────────────────────

function evaluateCheck(def: AlertDef, metrics: Metrics): boolean {
  const t = JSON.parse(def.threshold) as Record<string, number>;
  switch (def.checkType) {
    case 'disk_space':
      return metrics.disk_free_bytes < t.bytes_free_min;
    case 'cpu_usage':
      return metrics.cpu_percent !== undefined && metrics.cpu_percent > t.percent_max;
    case 'memory_usage':
      return metrics.memory_percent !== undefined && metrics.memory_percent > t.percent_max;
    default:
      return false;
  }
}

async function processAlertState(
  db: Db,
  device: Device,
  def: AlertDef,
  failed: boolean,
  now: number,
): Promise<void> {
  const existing = await db.select()
    .from(schema.alertState)
    .where(and(
      eq(schema.alertState.deviceId, device.id),
      eq(schema.alertState.alertDefinitionId, def.id),
    ))
    .get();

  if (!existing) {
    await db.insert(schema.alertState).values({
      id: crypto.randomUUID(),
      deviceId: device.id,
      alertDefinitionId: def.id,
      consecutiveFailures: failed ? 1 : 0,
      isAlerting: false,
      updatedAt: now,
    });
    return;
  }

  if (failed) {
    const newCount = existing.consecutiveFailures + 1;
    const shouldFire = newCount >= def.consecutiveFailuresRequired && !existing.isAlerting;

    await db.update(schema.alertState)
      .set({
        consecutiveFailures: newCount,
        isAlerting: shouldFire || existing.isAlerting,
        alertedAt: shouldFire ? now : existing.alertedAt,
        updatedAt: now,
      })
      .where(eq(schema.alertState.id, existing.id));

    if (shouldFire) {
      await fireWebhooks(db, device, def, 'alert.triggered', now);
    }
  } else {
    const wasAlerting = existing.isAlerting;

    await db.update(schema.alertState)
      .set({
        consecutiveFailures: 0,
        isAlerting: false,
        resolvedAt: wasAlerting ? now : existing.resolvedAt,
        updatedAt: now,
      })
      .where(eq(schema.alertState.id, existing.id));

    if (wasAlerting) {
      await fireWebhooks(db, device, def, 'alert.resolved', now);
    }
  }
}

async function fireWebhooks(
  db: Db,
  device: Device,
  def: AlertDef,
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
    timestamp: now,
    device_id: device.id,
    tenant_id: device.tenantId,
    hostname: device.hostname,
    check_type: def.checkType,
    definition_id: def.id,
    threshold: JSON.parse(def.threshold),
  });

  // Fire all webhooks concurrently; errors are swallowed so a bad webhook
  // never blocks a check-in or crashes the cron run.
  await Promise.allSettled(
    webhooks.map(wh =>
      fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    )
  );
}
