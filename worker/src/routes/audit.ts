import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, ne, desc } from 'drizzle-orm';
import type { Bindings } from '../index';
import * as schema from '../db/schema';
import { sha256hex } from '../lib/crypto';

const audit = new Hono<{ Bindings: Bindings }>();

// ── Types mirroring agent protocol ───────────────────────────────────────────

interface CPUInfo    { model: string; cores: number; speed_mhz: number }
interface RAMInfo    { total_bytes: number }
interface DiskInfo   { device: string; label: string; fs_type: string; total_bytes: number; free_bytes: number }
interface NetworkInfo { name: string; hardware_addr: string; addrs: string[] }
interface BIOSInfo   { vendor: string; version: string; release_date: string }
interface HardwareInfo {
  cpu: CPUInfo[]; ram: RAMInfo; disks: DiskInfo[];
  network: NetworkInfo[]; bios?: BIOSInfo
}
interface SoftwareItem { name: string; version: string; publisher: string; installed_at: string }
interface ServiceItem  { name: string; display_name: string; status: string; start_type: string }
interface AVEntry      { name: string; enabled: boolean; up_to_date: boolean }
interface SecurityInfo { antivirus: AVEntry[]; firewall_enabled: boolean }
interface AuditPayload {
  hardware?: HardwareInfo
  software?: SoftwareItem[]
  services?: ServiceItem[]
  security?: SecurityInfo
}
interface AuditRequest {
  device_id: string; tenant_id: string; timestamp: number
  agent_version: string; payload: AuditPayload
}

// ── Change record builders ────────────────────────────────────────────────────

interface ChangeRecord {
  id: string; deviceId: string; tenantId: string; auditId: string
  category: string; changeType: string; itemName: string
  field: string | null; oldValue: string | null; newValue: string | null
  detectedAt: number
}

function mkChange(
  deviceId: string, tenantId: string, auditId: string, now: number,
  category: string, changeType: string, itemName: string,
  field?: string, oldValue?: string, newValue?: string,
): ChangeRecord {
  return {
    id: crypto.randomUUID(), deviceId, tenantId, auditId, detectedAt: now,
    category, changeType, itemName,
    field: field ?? null, oldValue: oldValue ?? null, newValue: newValue ?? null,
  };
}

function diffSoftware(
  prev: SoftwareItem[], curr: SoftwareItem[],
  deviceId: string, tenantId: string, auditId: string, now: number,
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const prevMap = new Map(prev.map(s => [s.name.toLowerCase(), s]));
  const currMap = new Map(curr.map(s => [s.name.toLowerCase(), s]));

  for (const [key, cs] of currMap) {
    const ps = prevMap.get(key);
    if (!ps) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'software', 'added', cs.name));
    } else if (ps.version !== cs.version) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'software', 'changed', cs.name, 'version', ps.version, cs.version));
    }
  }
  for (const [key, ps] of prevMap) {
    if (!currMap.has(key)) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'software', 'removed', ps.name));
    }
  }
  return changes;
}

function diffServices(
  prev: ServiceItem[], curr: ServiceItem[],
  deviceId: string, tenantId: string, auditId: string, now: number,
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const prevMap = new Map(prev.map(s => [s.name, s]));
  const currMap = new Map(curr.map(s => [s.name, s]));

  for (const [name, cs] of currMap) {
    const ps = prevMap.get(name);
    if (!ps) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'services', 'added', name, 'status', undefined, cs.status));
    } else if (ps.status !== cs.status) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'services', 'changed', name, 'status', ps.status, cs.status));
    }
  }
  for (const [name] of prevMap) {
    if (!currMap.has(name)) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'services', 'removed', name));
    }
  }
  return changes;
}

function diffHardware(
  prev: HardwareInfo, curr: HardwareInfo,
  deviceId: string, tenantId: string, auditId: string, now: number,
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];

  // RAM
  if (prev.ram && curr.ram && prev.ram.total_bytes !== curr.ram.total_bytes) {
    changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'changed', 'RAM', 'total_bytes',
      String(prev.ram.total_bytes), String(curr.ram.total_bytes)));
  }

  // Disks
  const prevDisks = new Map((prev.disks ?? []).map(d => [d.device, d]));
  const currDisks = new Map((curr.disks ?? []).map(d => [d.device, d]));
  for (const [dev, cd] of currDisks) {
    if (!prevDisks.has(dev)) changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'added', `Disk ${cd.label}`));
  }
  for (const [dev, pd] of prevDisks) {
    if (!currDisks.has(dev)) changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'removed', `Disk ${pd.label}`));
  }

  // Network adapters
  const prevNics = new Map((prev.network ?? []).map(n => [n.hardware_addr, n]));
  const currNics = new Map((curr.network ?? []).map(n => [n.hardware_addr, n]));
  for (const [mac, cn] of currNics) {
    if (!prevNics.has(mac)) changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'added', `NIC ${cn.name}`));
  }
  for (const [mac, pn] of prevNics) {
    if (!currNics.has(mac)) changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'removed', `NIC ${pn.name}`));
  }

  // BIOS version
  if (prev.bios && curr.bios && prev.bios.version !== curr.bios.version) {
    changes.push(mkChange(deviceId, tenantId, auditId, now, 'hardware', 'changed', 'BIOS', 'version', prev.bios.version, curr.bios.version));
  }

  return changes;
}

function diffSecurity(
  prev: SecurityInfo, curr: SecurityInfo,
  deviceId: string, tenantId: string, auditId: string, now: number,
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];

  if (prev.firewall_enabled !== curr.firewall_enabled) {
    changes.push(mkChange(deviceId, tenantId, auditId, now, 'security', 'changed', 'Firewall',
      'enabled', String(prev.firewall_enabled), String(curr.firewall_enabled)));
  }

  const prevAV = new Map((prev.antivirus ?? []).map(a => [a.name, a]));
  const currAV = new Map((curr.antivirus ?? []).map(a => [a.name, a]));

  for (const [name, ca] of currAV) {
    const pa = prevAV.get(name);
    if (!pa) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'security', 'added', name));
    } else {
      if (pa.enabled !== ca.enabled) {
        changes.push(mkChange(deviceId, tenantId, auditId, now, 'security', 'changed', name, 'enabled', String(pa.enabled), String(ca.enabled)));
      }
      if (pa.up_to_date !== ca.up_to_date) {
        changes.push(mkChange(deviceId, tenantId, auditId, now, 'security', 'changed', name, 'up_to_date', String(pa.up_to_date), String(ca.up_to_date)));
      }
    }
  }
  for (const [name] of prevAV) {
    if (!currAV.has(name)) {
      changes.push(mkChange(deviceId, tenantId, auditId, now, 'security', 'removed', name));
    }
  }

  return changes;
}

// ── POST /v1/audit ────────────────────────────────────────────────────────────

audit.post('/', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'missing authorization' }, 401);
  const credentialHash = await sha256hex(auth.slice(7));

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const device = await db.select()
    .from(schema.devices)
    .where(eq(schema.devices.deviceCredentialHash, credentialHash))
    .get();

  if (!device) return c.json({ error: 'unknown device' }, 401);
  if (device.status === 'revoked') return c.json({ error: 'device revoked' }, 403);

  let body: AuditRequest;
  try {
    body = await c.req.json<AuditRequest>();
  } catch {
    return c.json({ error: 'invalid request body' }, 400);
  }

  if (body.device_id !== device.id || body.tenant_id !== device.tenantId) {
    return c.json({ error: 'device_id or tenant_id mismatch' }, 403);
  }

  const tenant = await db.select({ privacyModeDefault: schema.tenants.privacyModeDefault })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, device.tenantId))
    .get();

  const privacyMode = device.privacyModeOverride ?? tenant?.privacyModeDefault ?? false;

  const payload = body.payload;
  if (privacyMode) {
    payload.software = undefined;
    payload.services = undefined;
  }

  const auditId = crypto.randomUUID();

  await db.insert(schema.deviceAudits).values({
    id:           auditId,
    deviceId:     device.id,
    tenantId:     device.tenantId,
    auditType:    'full',
    hardware:     payload.hardware   ? JSON.stringify(payload.hardware)  : null,
    software:     payload.software   ? JSON.stringify(payload.software)  : null,
    services:     payload.services   ? JSON.stringify(payload.services)  : null,
    security:     payload.security   ? JSON.stringify(payload.security)  : null,
    agentVersion: body.agent_version,
    createdAt:    now,
  });

  // Load previous audit for delta computation
  const prevAudit = await db.select()
    .from(schema.deviceAudits)
    .where(and(
      eq(schema.deviceAudits.deviceId, device.id),
      ne(schema.deviceAudits.id, auditId),
    ))
    .orderBy(desc(schema.deviceAudits.createdAt))
    .get();

  if (prevAudit) {
    const changes: ChangeRecord[] = [];

    const prevHW: HardwareInfo | null  = prevAudit.hardware  ? JSON.parse(prevAudit.hardware)  : null;
    const currHW: HardwareInfo | null  = payload.hardware ?? null;
    const prevSW: SoftwareItem[] | null = prevAudit.software ? JSON.parse(prevAudit.software) : null;
    const currSW: SoftwareItem[] | null = payload.software ?? null;
    const prevSVC: ServiceItem[] | null = prevAudit.services ? JSON.parse(prevAudit.services) : null;
    const currSVC: ServiceItem[] | null = payload.services ?? null;
    const prevSEC: SecurityInfo | null  = prevAudit.security  ? JSON.parse(prevAudit.security)  : null;
    const currSEC: SecurityInfo | null  = payload.security ?? null;

    if (prevHW && currHW)   changes.push(...diffHardware(prevHW, currHW, device.id, device.tenantId, auditId, now));
    if (prevSW && currSW)   changes.push(...diffSoftware(prevSW, currSW, device.id, device.tenantId, auditId, now));
    if (prevSVC && currSVC) changes.push(...diffServices(prevSVC, currSVC, device.id, device.tenantId, auditId, now));
    if (prevSEC && currSEC) changes.push(...diffSecurity(prevSEC, currSEC, device.id, device.tenantId, auditId, now));

    for (const ch of changes) {
      await db.insert(schema.deviceAuditChanges).values(ch);
    }
  }

  return c.json({ ok: true, audit_id: auditId });
});

export default audit;
