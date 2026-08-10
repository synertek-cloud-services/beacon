import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser } from '../../lib/auth';
import { toCsv } from '../../lib/csv';

// On-demand CSV exports only, v1 -- confirmed via AskUserQuestion: no PDF
// (Workers has no filesystem/Node APIs a PDF library could lean on, and CSV
// alone already covers "get fleet data into a spreadsheet," the highest-
// value half of Datto RMM's own reports-vs-exports split) and no
// scheduling/email delivery (would need new cron dispatch infra plus
// attachment support on top of the existing alert-email provider
// architecture, which today only ever sends plain HTML/text). Both are
// natural fast-follows once this plumbing proves out, mirroring how Patch
// Policy came after plain patch approval.
const adminReports = new Hono<{ Bindings: Bindings }>();

function auth(c: any) {
  return requireUser(c.req.header('Authorization'), c.env, 'readonly');
}

function csvResponse(c: any, filename: string, csv: string) {
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}

function isoDate(ts: number | null): string {
  return ts ? new Date(ts * 1000).toISOString() : '';
}

// GET /v1/admin/reports/device-inventory?company_id=
adminReports.get('/device-inventory', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const companyId = c.req.query('company_id');

  const where = companyId
    ? and(eq(schema.devices.status, 'approved'), eq(schema.devices.companyId, companyId))
    : eq(schema.devices.status, 'approved');

  const rows = await db.select({
    hostname: schema.devices.hostname,
    companyName: schema.companies.name,
    osType: schema.devices.osType,
    osVersion: schema.devices.osVersion,
    detectedClass: schema.devices.detectedClass,
    overrideClass: schema.devices.overrideClass,
    agentVersion: schema.devices.agentVersion,
    lastSeen: schema.devices.lastSeen,
    externalIp: schema.devices.externalIp,
    inventory: schema.devices.inventory,
    createdAt: schema.devices.createdAt,
    approvedAt: schema.devices.approvedAt,
  })
    .from(schema.devices)
    .innerJoin(schema.companies, eq(schema.devices.companyId, schema.companies.id))
    .where(where)
    .orderBy(schema.companies.name, schema.devices.hostname)
    .all();

  const body = rows.map(r => {
    let uptimeSeconds: number | null = null;
    try {
      const parsed = r.inventory ? JSON.parse(r.inventory) : null;
      uptimeSeconds = typeof parsed?.uptime_seconds === 'number' ? parsed.uptime_seconds : null;
    } catch { /* malformed inventory blob -- leave uptime blank, not fatal to the report */ }

    return [
      r.hostname ?? '',
      r.companyName,
      r.osType ?? '',
      r.osVersion ?? '',
      r.overrideClass ?? r.detectedClass ?? '',
      r.agentVersion ?? '',
      isoDate(r.lastSeen),
      uptimeSeconds ?? '',
      r.externalIp ?? '',
      isoDate(r.approvedAt ?? r.createdAt),
    ];
  });

  const csv = toCsv(
    ['Hostname', 'Company', 'OS', 'OS Version', 'Class', 'Agent Version', 'Last Seen', 'Uptime (seconds)', 'External IP', 'Enrolled'],
    body,
  );
  return csvResponse(c, `device-inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

interface PatchItem {
  update_id?: string;
  type?: string; // 'software'|'driver'
}

// GET /v1/admin/reports/patch-compliance?company_id=
// Per-device pending-patch counts, cross-referenced against fleet-wide
// patch_approvals -- same per-approved-device latest-audit fetch loop
// admin/patches.ts's GET / already uses (one query per device, fine at
// self-hosted scale), just aggregated per device here instead of per
// update_id, since a compliance report answers "which devices need
// attention," not "which patches are outstanding."
adminReports.get('/patch-compliance', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const companyId = c.req.query('company_id');

  const where = companyId
    ? and(eq(schema.devices.status, 'approved'), eq(schema.devices.companyId, companyId))
    : eq(schema.devices.status, 'approved');

  const devices = await db.select({
    id: schema.devices.id,
    hostname: schema.devices.hostname,
    companyName: schema.companies.name,
    windowsUpdateManaged: schema.devices.windowsUpdateManaged,
    pendingRebootRequired: schema.devices.pendingRebootRequired,
  })
    .from(schema.devices)
    .innerJoin(schema.companies, eq(schema.devices.companyId, schema.companies.id))
    .where(where)
    .orderBy(schema.companies.name, schema.devices.hostname)
    .all();

  const approvedUpdateIds = new Set(
    (await db.select({ updateId: schema.patchApprovals.updateId })
      .from(schema.patchApprovals)
      .where(eq(schema.patchApprovals.status, 'approved'))
      .all()).map(r => r.updateId),
  );

  const body: (string | number)[][] = [];
  for (const device of devices) {
    const audit = await db.select({ patches: schema.deviceAudits.patches })
      .from(schema.deviceAudits)
      .where(and(eq(schema.deviceAudits.deviceId, device.id), isNotNull(schema.deviceAudits.patches)))
      .orderBy(desc(schema.deviceAudits.createdAt))
      .limit(1)
      .get();

    let items: PatchItem[] = [];
    if (audit?.patches) {
      try { items = JSON.parse(audit.patches); } catch { /* leave counts at zero rather than fail the whole report */ }
    }

    let pending = 0, approvedPending = 0, drivers = 0;
    for (const item of items) {
      pending++;
      if (item.type === 'driver') drivers++;
      if (item.update_id && approvedUpdateIds.has(item.update_id)) approvedPending++;
    }

    body.push([
      device.hostname ?? '',
      device.companyName,
      pending,
      approvedPending,
      pending - approvedPending,
      drivers,
      device.pendingRebootRequired ? 'Yes' : 'No',
      device.windowsUpdateManaged === true ? 'Yes' : device.windowsUpdateManaged === false ? 'No' : '',
    ]);
  }

  const csv = toCsv(
    ['Hostname', 'Company', 'Pending Patches', 'Approved (Pending Install)', 'Unapproved', 'Drivers', 'Reboot Required', 'Managed by Beacon'],
    body,
  );
  return csvResponse(c, `patch-compliance-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

// GET /v1/admin/reports/alert-history?company_id=&from=&to=
// Raw SQL join, same shape admin/alerts.ts's own GET / already uses --
// reused rather than re-derived via drizzle, since that file already proved
// out the exact device/company/monitor/policy join this report needs.
// Defaults to the last 30 days when no range is given, matching that same
// file's own since30d precedent for "all" alerts.
adminReports.get('/alert-history', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const companyId = c.req.query('company_id');
  const now = Math.floor(Date.now() / 1000);
  const from = c.req.query('from') ? Number(c.req.query('from')) : now - 30 * 86400;
  const to = c.req.query('to') ? Number(c.req.query('to')) : now;

  const params: (string | number)[] = [from, to];
  let where = 'WHERE s.alerted_at IS NOT NULL AND s.alerted_at BETWEEN ? AND ?';
  if (companyId) {
    where += ' AND t.id = ?';
    params.push(companyId);
  }

  const sql = `
    SELECT
      d.hostname, t.name AS company_name, pm.check_type,
      COALESCE(s.alert_priority, pm.alert_priority) AS priority,
      s.alerted_at, s.resolved_at, s.is_alerting, p.name AS policy_name
    FROM alert_state s
    JOIN devices d          ON s.device_id        = d.id
    JOIN companies t        ON d.company_id       = t.id
    JOIN policy_monitors pm ON s.policy_monitor_id = pm.id
    JOIN policies p         ON pm.policy_id       = p.id
    ${where}
    ORDER BY s.alerted_at DESC
    LIMIT 5000
  `;

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = result.results as Record<string, unknown>[];

  const body = rows.map(r => [
    r.hostname as string ?? '',
    r.company_name as string,
    r.check_type as string,
    r.priority as string ?? '',
    isoDate(r.alerted_at as number | null),
    isoDate(r.resolved_at as number | null),
    r.is_alerting ? 'Active' : 'Resolved',
    r.policy_name as string,
  ]);

  const csv = toCsv(
    ['Hostname', 'Company', 'Check Type', 'Priority', 'Alerted At', 'Resolved At', 'Status', 'Policy'],
    body,
  );
  return csvResponse(c, `alert-history-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

export default adminReports;
