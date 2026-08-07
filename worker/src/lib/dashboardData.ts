import type { D1Database } from '@cloudflare/workers-types';

export interface DashboardSummary {
  total: number; approved: number; pending: number; revoked: number; online: number; offline: number;
  by_os: Record<string, number>; by_class: Record<string, number>;
  offline_by_class: Record<string, number>; by_av_status: Record<string, number>;
  by_patch_severity: Record<string, number>;
}

// A raw per-device list, not a pre-aggregated count -- unlike everything
// else in DashboardSummary, Long Uptime's threshold/servers-only filter is a
// per-widget-instance config value (dashboard_widgets.config), so it can't
// be pre-aggregated into one shared snapshot the way by_patch_severity is.
// Mirrors the existing `alerts` raw-list precedent below: the widget
// component does its own client-side filtering from this.
export interface DashboardDeviceRow {
  id: string; hostname: string | null; company_id: string;
  class: string; uptime_seconds: number | null; pending_reboot_required: boolean;
}

function placeholders(values: string[]) { return values.map(() => '?').join(', '); }

/** Builds the single data snapshot used by both the legacy summary and widgets. */
export async function buildDashboardData(db: D1Database, companyIds?: string[]) {
  const scope = companyIds?.length ? ` WHERE company_id IN (${placeholders(companyIds)})` : '';
  const devicesResult = await db.prepare(`
    SELECT id, hostname, company_id, status, last_seen, os_type, detected_class, override_class, inventory, pending_reboot_required
    FROM devices${scope}
  `).bind(...(companyIds?.length ? companyIds : [])).all<Record<string, unknown>>();
  const devices = devicesResult.results;
  const now = Math.floor(Date.now() / 1000);
  const approved = devices.filter(d => d.status === 'approved');
  const byOs: Record<string, number> = {}, byClass: Record<string, number> = {}, byAvStatus: Record<string, number> = {};
  let online = 0;
  const deviceRows: DashboardDeviceRow[] = [];
  for (const d of approved) {
    if (typeof d.last_seen === 'number' && d.last_seen > now - 300) online++;
    const os = typeof d.os_type === 'string' ? d.os_type : 'unknown'; byOs[os] = (byOs[os] ?? 0) + 1;
    const cls = (typeof d.override_class === 'string' ? d.override_class : (typeof d.detected_class === 'string' ? d.detected_class : 'unknown'));
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    let av = 'unknown';
    let uptimeSeconds: number | null = null;
    if (typeof d.inventory === 'string') {
      try {
        const parsed = JSON.parse(d.inventory) as { av_status?: string; uptime_seconds?: number };
        av = parsed.av_status ?? av;
        uptimeSeconds = typeof parsed.uptime_seconds === 'number' ? parsed.uptime_seconds : null;
      } catch { /* unknown */ }
    }
    byAvStatus[av] = (byAvStatus[av] ?? 0) + 1;
    deviceRows.push({
      id: d.id as string,
      hostname: typeof d.hostname === 'string' ? d.hostname : null,
      company_id: d.company_id as string,
      class: cls,
      uptime_seconds: uptimeSeconds,
      pending_reboot_required: d.pending_reboot_required === 1,
    });
  }

  const offlineScope = companyIds?.length ? ` AND d.company_id IN (${placeholders(companyIds)})` : '';
  const offlineRows = await db.prepare(`
    SELECT d.detected_class, d.override_class, pm.config
    FROM alert_state s JOIN policy_monitors pm ON pm.id = s.policy_monitor_id
    JOIN devices d ON d.id = s.device_id
    WHERE pm.check_type = 'offline' AND s.is_alerting = 1${offlineScope}
  `).bind(...(companyIds?.length ? companyIds : [])).all<Record<string, unknown>>();
  const offlineByClass: Record<string, number> = {};
  for (const row of offlineRows.results) {
    let direction = 'offline'; try { direction = (JSON.parse(String(row.config)) as { direction?: string }).direction ?? direction; } catch { /* default */ }
    if (direction !== 'offline') continue;
    const cls = typeof row.override_class === 'string' ? row.override_class : (typeof row.detected_class === 'string' ? row.detected_class : 'unknown');
    offlineByClass[cls] = (offlineByClass[cls] ?? 0) + 1;
  }

  // Distinct pending patches by severity across this scope's approved devices
  // -- a lighter-weight version of GET /v1/admin/patches' own scan (which
  // additionally merges fleet-wide approval status, not needed here): a
  // widget glance is "how much needs attention," not the full decision
  // workflow, which stays the dedicated Patches page's job. One batched
  // query for each approved device's latest non-null-patches audit, rather
  // than patches.ts's one-query-per-device loop -- both are fine at this
  // scale, this just avoids N round-trips since the device ID set is
  // already in hand here.
  const byPatchSeverity: Record<string, number> = {};
  const approvedIds = approved.map(d => d.id as string);
  if (approvedIds.length > 0) {
    const patchAudits = await db.prepare(`
      SELECT da.patches FROM device_audits da
      WHERE da.patches IS NOT NULL AND da.device_id IN (${placeholders(approvedIds)})
        AND da.created_at = (
          SELECT MAX(created_at) FROM device_audits da2
          WHERE da2.device_id = da.device_id AND da2.patches IS NOT NULL
        )
    `).bind(...approvedIds).all<{ patches: string }>();
    const seenUpdateIds = new Set<string>();
    for (const row of patchAudits.results) {
      let items: Array<{ update_id?: string; severity?: string }>;
      try { items = JSON.parse(row.patches); } catch { continue; }
      for (const item of items) {
        // Dedup fleet-wide by update_id where present (same patch pending on
        // multiple devices shouldn't multiply the count); items with no
        // update_id yet (pre-upgrade agents) still count individually, same
        // "needs a rescan" gap GET /v1/admin/patches already documents.
        if (item.update_id) {
          if (seenUpdateIds.has(item.update_id)) continue;
          seenUpdateIds.add(item.update_id);
        }
        const severity = item.severity || 'Unspecified';
        byPatchSeverity[severity] = (byPatchSeverity[severity] ?? 0) + 1;
      }
    }
  }

  const alertScope = companyIds?.length ? ` AND t.id IN (${placeholders(companyIds)})` : '';
  const alerts = await db.prepare(`
    SELECT s.id, s.is_alerting, s.condition_first_seen, s.alerted_at, s.resolved_at, s.updated_at,
      d.id AS device_id, d.hostname, d.os_type, d.detected_class, d.override_class, t.id AS company_id, t.name AS company_name,
      pm.id AS monitor_id, pm.check_type, pm.config, COALESCE(s.alert_priority, pm.alert_priority) AS priority, p.id AS policy_id, p.name AS policy_name, p.scope AS policy_scope
    FROM alert_state s JOIN devices d ON d.id = s.device_id JOIN companies t ON t.id = d.company_id
    JOIN policy_monitors pm ON pm.id = s.policy_monitor_id JOIN policies p ON p.id = pm.policy_id
    WHERE s.alerted_at IS NOT NULL${alertScope} ORDER BY s.alerted_at DESC LIMIT 100
  `).bind(...(companyIds?.length ? companyIds : [])).all();
  return {
    summary: { total: devices.length, approved: approved.length, pending: devices.filter(d => d.status === 'pending').length,
      revoked: devices.filter(d => d.status === 'revoked').length, online, offline: approved.length - online,
      by_os: byOs, by_class: byClass, offline_by_class: offlineByClass, by_av_status: byAvStatus,
      by_patch_severity: byPatchSeverity } satisfies DashboardSummary,
    alerts: alerts.results,
    devices: deviceRows,
  };
}
