import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and, inArray, isNull, isNotNull } from 'drizzle-orm';
import type { Bindings } from '../../index';
import * as schema from '../../db/schema';
import { requireUser, type Role } from '../../lib/auth';
import { resolveEffectiveMonitors } from '../../lib/alerts';

const adminDevices = new Hono<{ Bindings: Bindings }>();

function auth(c: any, minRole: Role = 'readonly') {
  return requireUser(c.req.header('Authorization'), c.env, minRole);
}

// Device credentials and their enrollment-token provenance are internal
// authentication material, not part of the dashboard's device contract.
function shapeDevice(row: typeof schema.devices.$inferSelect) {
  const { deviceCredentialHash: _, enrollmentTokenId: __, ...device } = row;
  return device;
}

// GET /v1/admin/devices?status=pending|approved|revoked
adminDevices.get('/', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const statusFilter = c.req.query('status') as typeof schema.devices.$inferSelect['status'] | undefined;

  const devices = statusFilter
    ? await db.select().from(schema.devices).where(eq(schema.devices.status, statusFilter)).all()
    : await db.select().from(schema.devices).all();

  const companyIds = [...new Set(devices.map(d => d.companyId))];
  const companies = companyIds.length
    ? await db.select({ id: schema.companies.id, name: schema.companies.name })
        .from(schema.companies)
        .all()
    : [];
  const companyMap = new Map(companies.map(t => [t.id, t.name]));

  const rows = devices.map(d => ({ ...shapeDevice(d), companyName: companyMap.get(d.companyId) ?? null }));

  return c.json(rows);
});

// GET /v1/admin/devices/:id
adminDevices.get('/:id', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const device = await db.select().from(schema.devices).where(eq(schema.devices.id, c.req.param('id'))).get();
  if (!device) return c.json({ error: 'not found' }, 404);

  const company = await db.select({ name: schema.companies.name })
    .from(schema.companies).where(eq(schema.companies.id, device.companyId)).get();

  return c.json({ ...shapeDevice(device), companyName: company?.name ?? null });
});

// GET /v1/admin/devices/:id/effective-monitors — which policies/monitors
// currently apply to this device (same resolution used for real alerting).
adminDevices.get('/:id/effective-monitors', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  // Needs the full row — deviceMatchesPolicy reads overrideClass/detectedClass/companyId/osType.
  const device = await db.select().from(schema.devices).where(eq(schema.devices.id, c.req.param('id'))).get();
  if (!device) return c.json({ error: 'not found' }, 404);

  const monitors = await resolveEffectiveMonitors(db, device);
  return c.json(monitors);
});

// POST /v1/admin/devices/:id/approve
adminDevices.post('/:id/approve', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .update(schema.devices)
    .set({ status: 'approved', approvedAt: now })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// POST /v1/admin/devices/:id/revoke
adminDevices.post('/:id/revoke', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });

  await db
    .update(schema.devices)
    .set({ status: 'revoked' })
    .where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// PATCH /v1/admin/devices/:id — edit manually-entered device metadata.
// Currently just warranty_expires_at; there's no agent collector for this
// the way there is for the rest of System — see migrations/0019.
adminDevices.patch('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  const deviceId = c.req.param('id');

  const device = await db.select({ id: schema.devices.id }).from(schema.devices).where(eq(schema.devices.id, deviceId)).get();
  if (!device) return c.json({ error: 'device not found' }, 404);

  const body = await c.req.json<{ warranty_expires_at?: number | null }>();
  if (!('warranty_expires_at' in body)) return c.json({ error: 'no recognized fields to update' }, 400);

  await db.update(schema.devices)
    .set({ warrantyExpiresAt: body.warranty_expires_at ?? null })
    .where(eq(schema.devices.id, deviceId));

  return c.json({ ok: true });
});

// DELETE /v1/admin/devices/:id
adminDevices.delete('/:id', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);

  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.devices).where(eq(schema.devices.id, c.req.param('id')));

  return c.json({ ok: true });
});

// POST /v1/admin/devices/:id/maintenance — set a maintenance window
adminDevices.post('/:id/maintenance', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ ends_at: number; reason?: string }>();
  if (!body.ends_at || body.ends_at <= Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'ends_at must be a future unix timestamp' }, 400);
  }
  await db.update(schema.devices)
    .set({ maintenanceEndsAt: body.ends_at, maintenanceReason: body.reason ?? null })
    .where(eq(schema.devices.id, c.req.param('id')));
  return c.json({ ok: true });
});

// DELETE /v1/admin/devices/:id/maintenance — end a maintenance window immediately
adminDevices.delete('/:id/maintenance', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  await db.update(schema.devices)
    .set({ maintenanceEndsAt: null, maintenanceReason: null })
    .where(eq(schema.devices.id, c.req.param('id')));
  return c.json({ ok: true });
});

// GET /v1/admin/devices/:id/commands — list recent direct commands (newest
// first). Job-dispatched commands (jobId set) are excluded — those already
// have full visibility via JobDetailPage's per-device breakdown, and
// including them here would make this list grow unbounded on a device with
// many recurring jobs. This covers the previously-invisible gap: kebab-menu
// actions (reboot, restart_agent, force_update, install_patches,
// uninstall_agent) and single-device Quick Job runs had no UI surface at
// all before this, even though they were always being recorded.
adminDevices.get('/:id/commands', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const cmds = await db
    .select()
    .from(schema.commands)
    .where(and(eq(schema.commands.deviceId, c.req.param('id')), isNull(schema.commands.jobId)))
    .orderBy(desc(schema.commands.createdAt))
    .limit(50)
    .all();

  return c.json(cmds);
});

// POST /v1/admin/devices/:id/commands — queue a command for the device
adminDevices.post('/:id/commands', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const now = Math.floor(Date.now() / 1000);
  const deviceId = c.req.param('id');

  const device = await db
    .select({ id: schema.devices.id, companyId: schema.devices.companyId, status: schema.devices.status, osType: schema.devices.osType })
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get();

  if (!device)                   return c.json({ error: 'device not found' }, 404);
  if (device.status !== 'approved') return c.json({ error: 'device must be approved to receive commands' }, 400);

  const body = await c.req.json<{
    type: 'run_script' | 'reboot' | 'run_audit' | 'restart_agent' | 'force_update' | 'install_patches' | 'uninstall_agent' | 'manage_software' | 'uninstall_software';
    shell?: string;
    script?: string;
    timeout_seconds?: number;
    update_ids?: string[];
    package_ids?: string[];
    software_name?: string;
  }>();

  let cmdType = 'run_script';
  let payload: Record<string, unknown>;

  if (body.type === 'reboot') {
    // Resolve OS-appropriate reboot command
    const rebootScript =
      device.osType === 'windows' ? 'shutdown /r /t 0' :
      device.osType === 'darwin'  ? 'shutdown -r now'  : 'reboot';
    const shell = device.osType === 'windows' ? 'powershell' : 'bash';
    payload = { shell, script: rebootScript, timeout_seconds: 30 };
  } else if (body.type === 'run_script') {
    if (!body.script?.trim()) return c.json({ error: 'script is required' }, 400);
    // Resolve 'auto' shell
    const shell = body.shell === 'auto' || !body.shell
      ? (device.osType === 'windows' ? 'powershell' : 'bash')
      : body.shell;
    payload = { shell, script: body.script.trim(), timeout_seconds: body.timeout_seconds ?? 300 };
  } else if (body.type === 'run_audit') {
    // Agent dispatches on this literal command type (agent/cmd/agent/main.go)
    // instead of running it through the generic script executor — no payload needed.
    cmdType = 'run_audit';
    payload = {};
  } else if (body.type === 'restart_agent') {
    cmdType = 'restart_agent';
    payload = {};
  } else if (body.type === 'force_update') {
    // Agent dispatches on this literal command type (agent/cmd/agent/main.go)
    // to wake its own self-update check early -- no payload needed.
    cmdType = 'force_update';
    payload = {};
  } else if (body.type === 'install_patches') {
    if (!body.update_ids?.length) return c.json({ error: 'update_ids is required' }, 400);
    // Server-side re-validation, not just trusting the caller: only
    // update_ids with a real 'approved' row in patch_approvals are allowed
    // through, even though the dashboard only ever offers approved ones --
    // this is a real, consequential action on a live machine, worth
    // defense in depth beyond the UI alone.
    const approved = await db.select({ updateId: schema.patchApprovals.updateId })
      .from(schema.patchApprovals)
      .where(and(inArray(schema.patchApprovals.updateId, body.update_ids), eq(schema.patchApprovals.status, 'approved')))
      .all();
    if (!approved.length) return c.json({ error: 'none of the given update_ids are approved' }, 400);
    cmdType = 'install_patches';
    payload = { update_ids: approved.map(a => a.updateId) };
  } else if (body.type === 'manage_software') {
    // No worker-side package-ID catalog/validation -- there's no catalog at
    // all (see wingetupdate's own doc comment for why: winget's own package
    // database does that job, Beacon doesn't maintain one). A bad ID just
    // fails that one winget invocation with real winget error output the
    // technician reads back in Command History, same as a bad run_script
    // command would. The only real guard here is a sanity cap against a
    // mistakenly huge paste, not injection prevention -- args reach the
    // agent's exec.CommandContext as a slice, never a shell, so there's no
    // shell-interpolation risk to defend against in the first place.
    const packageIds = (body.package_ids ?? []).map(id => id.trim()).filter(Boolean);
    if (packageIds.length > 50) return c.json({ error: 'too many package_ids (max 50)' }, 400);
    cmdType = 'manage_software';
    payload = { package_ids: packageIds };
  } else if (body.type === 'uninstall_software') {
    // Re-fetches the device's own latest audit server-side rather than
    // trusting a raw uninstall command from the dashboard -- same "the
    // dashboard only ever offers eligible ones, but this is a real,
    // consequential action on a live machine, worth defense in depth"
    // reasoning install_patches already established. software_name is the
    // only thing the caller supplies; the actual command is looked up here.
    if (!body.software_name) return c.json({ error: 'software_name is required' }, 400);
    const audit = await db.select({ software: schema.deviceAudits.software })
      .from(schema.deviceAudits)
      .where(and(eq(schema.deviceAudits.deviceId, deviceId), isNotNull(schema.deviceAudits.software)))
      .orderBy(desc(schema.deviceAudits.createdAt))
      .limit(1)
      .get();
    let items: { name: string; uninstall_string?: string; quiet_uninstall_string?: string }[] = [];
    try { items = audit?.software ? JSON.parse(audit.software) : []; } catch { /* fall through to not-found below */ }
    const item = items.find(i => i.name === body.software_name);
    if (!item) return c.json({ error: 'software entry not found in the latest audit' }, 404);
    const uninstallCommand = resolveUninstallCommand(item);
    if (!uninstallCommand) {
      return c.json({ error: 'no silent/quiet uninstall command is available for this software -- Beacon only offers unattended uninstall for MSI-based installs or ones exposing a QuietUninstallString' }, 400);
    }
    cmdType = 'run_script';
    payload = { shell: 'powershell', script: buildUninstallScript(uninstallCommand), timeout_seconds: 600 };
  } else if (body.type === 'uninstall_agent') {
    // Agent dispatches on this literal command type (agent/cmd/agent/main.go)
    // -- service.SelfUninstall() removes the service registration and the
    // install directory entirely. No result is ever reported back (the
    // agent exits right after spawning its detached cleanup helper, same
    // as restart_agent) -- the device going quiet in check-ins is the only
    // confirmation this ever produces.
    cmdType = 'uninstall_agent';
    payload = {};
  } else {
    return c.json({ error: 'unknown command type' }, 400);
  }

  const id = crypto.randomUUID();
  await db.insert(schema.commands).values({
    id,
    deviceId,
    companyId: device.companyId,
    type: cmdType,
    payload: JSON.stringify(payload),
    status: 'queued',
    createdAt: now,
  });

  return c.json({ id }, 201);
});

// GET /v1/admin/devices/:id/audit/latest
adminDevices.get('/:id/audit/latest', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });

  const row = await db.select()
    .from(schema.deviceAudits)
    .where(eq(schema.deviceAudits.deviceId, c.req.param('id')))
    .orderBy(desc(schema.deviceAudits.createdAt))
    .limit(1)
    .get();

  if (!row) return c.json(null);

  return c.json({
    id:           row.id,
    deviceId:     row.deviceId,
    companyId:     row.companyId,
    auditType:    row.auditType,
    agentVersion: row.agentVersion,
    createdAt:    row.createdAt,
    hardware:     row.hardware  ? JSON.parse(row.hardware)  : null,
    software:     row.software  ? JSON.parse(row.software)  : null,
    services:     row.services  ? JSON.parse(row.services)  : null,
    security:     row.security  ? JSON.parse(row.security)  : null,
    patches:      row.patches   ? JSON.parse(row.patches)   : null,
  });
});

// GET /v1/admin/devices/:id/custom-fields — every field definition, joined
// with this device's stored value (null when never set).
adminDevices.get('/:id/custom-fields', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const deviceId = c.req.param('id');

  const fields = await db.select().from(schema.customFields).orderBy(schema.customFields.sortOrder).all();
  const values = await db.select().from(schema.deviceCustomFieldValues).where(eq(schema.deviceCustomFieldValues.deviceId, deviceId)).all();
  const valueMap = new Map(values.map(v => [v.fieldId, v.value]));

  return c.json(fields.map(f => ({ id: f.id, name: f.name, sortOrder: f.sortOrder, value: valueMap.get(f.id) ?? null })));
});

// PATCH /v1/admin/devices/:id/custom-fields/:fieldId — set (upsert) a value
adminDevices.patch('/:id/custom-fields/:fieldId', async (c) => {
  if (!(await auth(c, 'technician'))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const deviceId = c.req.param('id');
  const fieldId = c.req.param('fieldId');
  const now = Math.floor(Date.now() / 1000);

  const field = await db.select({ id: schema.customFields.id }).from(schema.customFields).where(eq(schema.customFields.id, fieldId)).get();
  if (!field) return c.json({ error: 'field not found' }, 404);

  const body = await c.req.json<{ value?: string | null }>();
  const value = body.value?.trim() || null;

  const existing = await db.select().from(schema.deviceCustomFieldValues)
    .where(and(eq(schema.deviceCustomFieldValues.deviceId, deviceId), eq(schema.deviceCustomFieldValues.fieldId, fieldId)))
    .get();

  if (existing) {
    await db.update(schema.deviceCustomFieldValues)
      .set({ value, updatedAt: now })
      .where(and(eq(schema.deviceCustomFieldValues.deviceId, deviceId), eq(schema.deviceCustomFieldValues.fieldId, fieldId)));
  } else {
    await db.insert(schema.deviceCustomFieldValues).values({ deviceId, fieldId, value, updatedAt: now });
  }

  return c.json({ ok: true });
});

// GET /v1/admin/devices/:id/audit/changes?limit=100
adminDevices.get('/:id/audit/changes', async (c) => {
  if (!(await auth(c))) return c.json({ error: 'unauthorized' }, 401);
  const db = drizzle(c.env.DB, { schema });
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

  const rows = await db.select()
    .from(schema.deviceAuditChanges)
    .where(eq(schema.deviceAuditChanges.deviceId, c.req.param('id')))
    .orderBy(desc(schema.deviceAuditChanges.detectedAt))
    .limit(limit)
    .all();

  return c.json(rows);
});

// resolveUninstallCommand decides whether an unattended, silent uninstall is
// actually possible for a given software entry -- matches Datto RMM's own
// documented real limitation ("the option to uninstall will not be
// available for certain applications if Datto RMM was unable to resolve
// the uninstall command"), not a lesser feature. Anything without a
// QuietUninstallString and not msiexec-based is refused outright, since the
// agent dispatches this as a SYSTEM-context/Session-0 command with no
// visible desktop -- a non-silent installer's UI would render nowhere
// anyone could ever answer it, potentially hanging indefinitely.
function resolveUninstallCommand(item: { uninstall_string?: string; quiet_uninstall_string?: string }): string | null {
  if (item.quiet_uninstall_string) return item.quiet_uninstall_string;
  if (item.uninstall_string && /msiexec/i.test(item.uninstall_string)) {
    const alreadyQuiet = /\/qn\b|\/quiet\b/i.test(item.uninstall_string);
    return alreadyQuiet ? item.uninstall_string : `${item.uninstall_string} /qn /norestart`;
  }
  return null;
}

// buildUninstallScript wraps the resolved command in a small PowerShell
// script (dispatched as a normal run_script, reusing the agent's existing
// executor rather than a new command type) -- cmd.exe /c is what actually
// runs it, since a registry UninstallString's own syntax already assumes
// cmd-style invocation (the same mechanism Windows' own Programs and
// Features uses). The command reaches cmd.exe via a single PowerShell
// string variable, not string-concatenated into the script text directly,
// so only PowerShell's own single-quote escaping (doubling '') is needed --
// no outer shell-argument quoting to worry about, since writeTempScript
// (agent-side) writes this as real file content, never a command-line arg.
function buildUninstallScript(command: string): string {
  const escaped = command.replace(/'/g, "''");
  return [
    `$cmd = '${escaped}'`,
    `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmd -Wait -PassThru -WindowStyle Hidden`,
    `exit $p.ExitCode`,
  ].join('\n');
}

export default adminDevices;
