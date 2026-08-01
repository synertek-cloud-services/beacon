import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { logActivity } from './activityLog';

type Db = ReturnType<typeof drizzle<typeof schema>>;

// ── Scheduled dispatch ──────────────────────────────────────────────────────
// Scans dispatch through the existing commands table -- same one-shot
// mechanism as install_patches/run_audit -- not the check-in wire protocol,
// deliberately avoiding the exact surface (CheckInRequest/CheckInResponse)
// that caused a real production incident when it was last extended. Closer
// to dispatchDuePatchPolicies' shape than to any per-monitor check pattern:
// a config is either due or not, dispatching directly to its one designated
// probe device, not resolved against a device set.
export async function dispatchDueDiscoveryScans(DB: D1Database, now: number): Promise<void> {
  const db = drizzle(DB, { schema });

  const configs = await db.select().from(schema.networkDiscoveryConfigs)
    .where(eq(schema.networkDiscoveryConfigs.enabled, true)).all();
  const due = configs.filter(c =>
    c.lastScannedAt == null || now - c.lastScannedAt >= c.scanIntervalMinutes * 60
  );
  if (due.length === 0) return;

  for (const config of due) {
    // Re-verify the probe device still exists, is approved, and still
    // belongs to this company -- skip silently and retry next tick if not,
    // same defensive shape dispatchDuePatchPolicies uses for its own
    // targeted devices (the device may have been reassigned/deleted/revoked
    // since the config was saved).
    const probe = await db.select({ id: schema.devices.id, status: schema.devices.status, companyId: schema.devices.companyId })
      .from(schema.devices).where(eq(schema.devices.id, config.probeDeviceId)).get();
    if (!probe || probe.status !== 'approved' || probe.companyId !== config.companyId) continue;

    await db.insert(schema.commands).values({
      id: crypto.randomUUID(),
      deviceId: config.probeDeviceId,
      companyId: config.companyId,
      type: 'network_scan',
      payload: JSON.stringify({ cidr_ranges: JSON.parse(config.cidrRanges) }),
      status: 'queued',
      createdAt: now,
    });
    await db.update(schema.networkDiscoveryConfigs).set({ lastScannedAt: now }).where(eq(schema.networkDiscoveryConfigs.id, config.id));

    // Layer-2 call -- runs from the scheduled() cron, never a
    // user-authenticated HTTP route.
    await logActivity(db, {
      actorType: 'system', category: 'Network Discovery', action: 'Dispatched scan',
      entityType: 'networkDiscoveryConfig', entityId: config.id, companyId: config.companyId, method: 'CRON',
    });
  }
}

// ── Upsert a scan result's hosts ─────────────────────────────────────────────
// Called from checkin.ts when a network_scan command completes. Check-then-
// insert-or-update, not an ON CONFLICT upsert -- matches the established
// convention elsewhere (device custom-field values, patch approvals).
export interface DiscoveredHost {
  ip: string;
  mac?: string;
  hostname?: string;
}

export async function recordDiscoveredHosts(db: Db, companyId: string, hosts: DiscoveredHost[], now: number): Promise<void> {
  for (const host of hosts) {
    const existing = await db.select({
      id: schema.discoveredDevices.id, timesSeen: schema.discoveredDevices.timesSeen,
      macAddress: schema.discoveredDevices.macAddress, hostname: schema.discoveredDevices.hostname,
    })
      .from(schema.discoveredDevices)
      .where(and(eq(schema.discoveredDevices.companyId, companyId), eq(schema.discoveredDevices.ipAddress, host.ip)))
      .get();

    if (existing) {
      // A scan that doesn't resolve MAC/hostname this time (e.g. an ARP
      // cache miss) shouldn't blank out a value a previous scan already
      // found -- only overwrite when this scan actually found something.
      await db.update(schema.discoveredDevices).set({
        macAddress: host.mac ?? existing.macAddress,
        hostname: host.hostname ?? existing.hostname,
        lastSeenAt: now,
        timesSeen: existing.timesSeen + 1,
      }).where(eq(schema.discoveredDevices.id, existing.id));
    } else {
      await db.insert(schema.discoveredDevices).values({
        id: crypto.randomUUID(),
        companyId,
        ipAddress: host.ip,
        macAddress: host.mac ?? null,
        hostname: host.hostname ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        timesSeen: 1,
      });
    }
  }
}
