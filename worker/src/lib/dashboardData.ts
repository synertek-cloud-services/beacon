import type { D1Database } from '@cloudflare/workers-types';

export interface DashboardSummary {
  total: number; approved: number; pending: number; revoked: number; online: number; offline: number;
  by_os: Record<string, number>; by_class: Record<string, number>;
  offline_by_class: Record<string, number>; by_av_status: Record<string, number>;
}

function placeholders(values: string[]) { return values.map(() => '?').join(', '); }

/** Builds the single data snapshot used by both the legacy summary and widgets. */
export async function buildDashboardData(db: D1Database, tenantIds?: string[]) {
  const scope = tenantIds?.length ? ` WHERE tenant_id IN (${placeholders(tenantIds)})` : '';
  const devicesResult = await db.prepare(`
    SELECT id, tenant_id, status, last_seen, os_type, detected_class, override_class, inventory
    FROM devices${scope}
  `).bind(...(tenantIds?.length ? tenantIds : [])).all<Record<string, unknown>>();
  const devices = devicesResult.results;
  const now = Math.floor(Date.now() / 1000);
  const approved = devices.filter(d => d.status === 'approved');
  const byOs: Record<string, number> = {}, byClass: Record<string, number> = {}, byAvStatus: Record<string, number> = {};
  let online = 0;
  for (const d of approved) {
    if (typeof d.last_seen === 'number' && d.last_seen > now - 300) online++;
    const os = typeof d.os_type === 'string' ? d.os_type : 'unknown'; byOs[os] = (byOs[os] ?? 0) + 1;
    const cls = (typeof d.override_class === 'string' ? d.override_class : (typeof d.detected_class === 'string' ? d.detected_class : 'unknown'));
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    let av = 'unknown';
    if (typeof d.inventory === 'string') try { av = (JSON.parse(d.inventory) as { av_status?: string }).av_status ?? av; } catch { /* unknown */ }
    byAvStatus[av] = (byAvStatus[av] ?? 0) + 1;
  }

  const offlineScope = tenantIds?.length ? ` AND d.tenant_id IN (${placeholders(tenantIds)})` : '';
  const offlineRows = await db.prepare(`
    SELECT d.detected_class, d.override_class, pm.config
    FROM alert_state s JOIN policy_monitors pm ON pm.id = s.policy_monitor_id
    JOIN devices d ON d.id = s.device_id
    WHERE pm.check_type = 'offline' AND s.is_alerting = 1${offlineScope}
  `).bind(...(tenantIds?.length ? tenantIds : [])).all<Record<string, unknown>>();
  const offlineByClass: Record<string, number> = {};
  for (const row of offlineRows.results) {
    let direction = 'offline'; try { direction = (JSON.parse(String(row.config)) as { direction?: string }).direction ?? direction; } catch { /* default */ }
    if (direction !== 'offline') continue;
    const cls = typeof row.override_class === 'string' ? row.override_class : (typeof row.detected_class === 'string' ? row.detected_class : 'unknown');
    offlineByClass[cls] = (offlineByClass[cls] ?? 0) + 1;
  }

  const alertScope = tenantIds?.length ? ` AND t.id IN (${placeholders(tenantIds)})` : '';
  const alerts = await db.prepare(`
    SELECT s.id, s.is_alerting, s.condition_first_seen, s.alerted_at, s.resolved_at, s.acknowledged_at, s.acknowledged_by, s.updated_at,
      d.id AS device_id, d.hostname, d.os_type, d.detected_class, d.override_class, t.id AS tenant_id, t.name AS tenant_name,
      pm.id AS monitor_id, pm.check_type, pm.config, pm.alert_priority AS priority, p.id AS policy_id, p.name AS policy_name, p.scope AS policy_scope
    FROM alert_state s JOIN devices d ON d.id = s.device_id JOIN tenants t ON t.id = d.tenant_id
    JOIN policy_monitors pm ON pm.id = s.policy_monitor_id JOIN policies p ON p.id = pm.policy_id
    WHERE s.alerted_at IS NOT NULL${alertScope} ORDER BY s.alerted_at DESC LIMIT 100
  `).bind(...(tenantIds?.length ? tenantIds : [])).all();
  return {
    summary: { total: devices.length, approved: approved.length, pending: devices.filter(d => d.status === 'pending').length,
      revoked: devices.filter(d => d.status === 'revoked').length, online, offline: approved.length - online,
      by_os: byOs, by_class: byClass, offline_by_class: offlineByClass, by_av_status: byAvStatus } satisfies DashboardSummary,
    alerts: alerts.results,
  };
}
