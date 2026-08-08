<template>
  <div class="dwig-content" :class="{ 'widget-chart': !['device_summary', 'recent_alerts', 'reboot_required', 'long_uptime'].includes(type) }">
    <button v-if="editing" class="dwig-remove" title="Remove widget" @click="onRemove">×</button>

    <div v-if="type === 'device_summary'" class="stat-grid dash-stats">
      <div class="stat-card c-blue"><div class="stat-label">Total Devices</div><div class="stat-value">{{ data?.summary.total ?? '—' }}</div><div class="stat-sub">{{ data?.summary.approved ?? 0 }} approved</div></div>
      <div class="stat-card c-teal"><div class="stat-label">Online Now</div><div class="stat-value">{{ data?.summary.online ?? '—' }}</div><div class="stat-sub">checked in &lt; 5 min ago</div></div>
      <div class="stat-card c-amber"><div class="stat-label">Pending Approval</div><div class="stat-value">{{ data?.summary.pending ?? '—' }}</div><RouterLink class="stat-sub" to="/devices">Review →</RouterLink></div>
      <div class="stat-card c-red"><div class="stat-label">Active Alerts</div><div class="stat-value">{{ activeAlerts.length }}</div><div class="stat-sub">{{ alertBreakdown }}</div></div>
    </div>
    <template v-else-if="type === 'recent_alerts'">
      <div class="widget-title">{{ title || 'Recent Alerts' }} <RouterLink v-if="!editing" to="/global/alerts">View all →</RouterLink></div>
      <div class="widget-table-wrap"><table class="widget-table"><thead><tr><th>Created</th><th>Priority</th><th>Category</th><th>Message</th><th>Company</th><th>Hostname</th></tr></thead>
        <tbody><tr v-for="alert in recentAlerts" :key="alert.id" @click="router.push('/global/alerts/' + alert.id)"><td class="mono">{{ formatDate(alert.alerted_at) }}</td><td><span class="pri-badge" :class="`pri-${alert.priority}`">{{ alert.priority }}</span></td><td>{{ categoryLabel(alert.check_type) }}</td><td>{{ alertMessage(alert) }}</td><td>{{ alert.company_name }}</td><td><RouterLink :to="'/devices/' + alert.device_id" @click.stop>{{ alert.hostname ?? '—' }}</RouterLink></td></tr>
          <tr v-if="!recentAlerts.length"><td colspan="6" class="empty-cell">No recent alerts</td></tr></tbody></table></div>
    </template>
    <div v-else-if="type === 'reboot_required' || type === 'long_uptime'" class="stat-grid dash-stats">
      <div class="stat-card" :class="type === 'reboot_required' ? 'c-red' : 'c-amber'">
        <div class="stat-label">{{ title || widgetLabels[type] }}</div>
        <div class="stat-value">{{ (type === 'reboot_required' ? rebootRequiredDevices : longUptimeDevices).length }}</div>
        <RouterLink class="stat-sub" :to="idsLink(type === 'reboot_required' ? rebootRequiredDevices : longUptimeDevices)">Review →</RouterLink>
        <button v-if="editing && type === 'long_uptime'" class="dwig-gear" title="Widget settings" @click.stop="openSettings()">⚙</button>
      </div>
    </div>
    <template v-else>
      <div class="widget-title">{{ title || widgetLabels[type] }}</div>
      <DonutChart v-if="chartData(type).length" :data="chartData(type)" :center-label="chartCenter(type)" />
      <div v-else class="widget-empty">No data available</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGridStack, useGridStackItem } from 'gridstack/dist/vue';
import { api, type AlertState, type DashboardData, type DashboardWidgetType, type DashboardDeviceRow } from '../api';
import DonutChart from './DonutChart.vue';

const props = defineProps<{ type: DashboardWidgetType; title: string | null; config: string }>();

const router = useRouter();

// Shared, independently-refreshing state (polled every 30s / toggled by the
// Edit layout button) -- provided by DashboardPage.vue above the <GridStack>
// tree, not passed as gridstack node props. Node props only flow through
// gridstack's own add/update lifecycle, which isn't a fit for something that
// changes on a timer completely independently of any widget layout change.
const data    = inject<Ref<DashboardData | null>>('dashboardData')!;
const editing = inject<Ref<boolean>>('dashboardEditing')!;
const dashboardId = inject<Ref<string | undefined>>('dashboardId')!;
const removeLocalWidget = inject<(id: string) => void>('dashboardRemoveLocalWidget')!;
const openWidgetSettings = inject<(w: { id: string; type: DashboardWidgetType; config: string }) => void>('dashboardOpenWidgetSettings')!;

const { removeWidget } = useGridStack();
const item = useGridStackItem();

const widgetLabels: Record<DashboardWidgetType, string> = { device_summary: 'Device summary', online_offline: 'Online / Offline', os_distribution: 'Operating systems', class_distribution: 'Device classes', antivirus_status: 'Antivirus status', offline_by_type: 'Offline devices by type', alerts_by_priority: 'Alerts by priority', recent_alerts: 'Recent alerts', patches_by_severity: 'Pending patches', reboot_required: 'Reboot required', long_uptime: 'Long uptime' };

// Client-side filtered from the shared raw devices list -- Long Uptime's
// threshold/servers-only is a per-widget-instance config value, which is
// exactly why buildDashboardData ships a raw list here instead of a
// pre-aggregated count (see dashboardData.ts's DashboardDeviceRow doc).
const rebootRequiredDevices = computed(() => (data.value?.devices ?? []).filter(d => d.pending_reboot_required));
function parseWidgetConfig(): { threshold_days?: number; servers_only?: boolean } {
  try { return JSON.parse(props.config || '{}'); } catch { return {}; }
}
const longUptimeDevices = computed(() => {
  const cfg = parseWidgetConfig();
  const thresholdSeconds = (cfg.threshold_days ?? 30) * 86400;
  return (data.value?.devices ?? []).filter(d => (d.uptime_seconds ?? 0) >= thresholdSeconds && (!cfg.servers_only || d.class === 'server'));
});
function idsLink(devices: DashboardDeviceRow[]) { return devices.length ? `/devices?ids=${devices.map(d => d.id).join(',')}` : '/devices'; }
function openSettings() { openWidgetSettings({ id: item.id, type: props.type, config: props.config }); }

const activeAlerts = computed(() => (data.value?.alerts ?? []).filter(alert => alert.is_alerting === 1));
const recentAlerts = computed(() => [...(data.value?.alerts ?? [])].slice(0, 12));
const priorityOrder = ['critical', 'high', 'moderate', 'low'];
const severityOrder = ['Critical', 'Important', 'Moderate', 'Low', 'Unspecified'];
const alertBreakdown = computed(() => { const counts: Record<string, number> = {}; for (const alert of activeAlerts.value) counts[alert.priority] = (counts[alert.priority] ?? 0) + 1; return priorityOrder.filter(key => counts[key]).map(key => `${counts[key]} ${key}`).join(', ') || 'no issues detected'; });
const colors = { primary: 'var(--color-primary)', success: 'var(--color-success)', warning: 'var(--color-warning)', danger: 'var(--color-danger)', info: 'var(--color-info)', muted: 'var(--color-text-muted)', border: 'var(--color-border-strong)' };

function chartData(type: DashboardWidgetType) {
  const summary = data.value?.summary; if (!summary) return [];
  if (type === 'online_offline') return [{ label: 'Online', value: summary.online, color: colors.success }, { label: 'Offline', value: summary.offline, color: colors.border }];
  const map = type === 'os_distribution' ? summary.by_os : type === 'class_distribution' ? summary.by_class : type === 'antivirus_status' ? summary.by_av_status : type === 'offline_by_type' ? summary.offline_by_class : null;
  if (type === 'alerts_by_priority') { const count: Record<string, number> = {}; for (const alert of activeAlerts.value) count[alert.priority] = (count[alert.priority] ?? 0) + 1; return priorityOrder.filter(key => count[key]).map(key => ({ label: key, value: count[key], color: key === 'critical' ? colors.danger : key === 'high' ? '#e07830' : key === 'moderate' ? colors.warning : colors.muted })); }
  if (type === 'patches_by_severity') { const count = summary.by_patch_severity; return severityOrder.filter(key => count[key]).map(key => ({ label: key, value: count[key], color: key === 'Critical' ? colors.danger : key === 'Important' ? '#e07830' : key === 'Moderate' ? colors.warning : colors.muted })); }
  // warning excluded here -- confirmed it renders identical to primary in
  // the currently active theme (#fabf46 == #fabf46, not just visually
  // similar), which silently duplicated colors in any 3+ category chart.
  // info swapped in instead since it's confirmed genuinely distinct from
  // every other token in this cycle.
  return Object.entries(map ?? {}).map(([label, value], index) => ({ label, value, color: [colors.primary, colors.success, colors.danger, colors.info, colors.muted][index % 5] }));
}
function chartCenter(type: DashboardWidgetType) { return type === 'online_offline' ? 'approved' : type === 'alerts_by_priority' ? 'alerts' : type === 'offline_by_type' ? 'offline' : type === 'patches_by_severity' ? 'pending' : 'devices'; }
function formatDate(ts: number | null) { return ts ? new Date(ts * 1000).toLocaleString() : '—'; }
function categoryLabel(type: string) { return ({ disk_space: 'Disk Space', offline: 'Online Status', cpu_usage: 'CPU', memory_usage: 'Memory', av_status: 'Antivirus', file_size: 'File/Folder Size', ping: 'Ping', process: 'Process', service: 'Service', software: 'Software', windows_update_drift: 'Windows Update Drift' } as Record<string, string>)[type] ?? type; }
function alertMessage(alert: AlertState) { try { const config = JSON.parse(alert.config) as Record<string, unknown>; if (alert.check_type === 'offline') return (config.direction ?? 'offline') === 'online' ? 'Device came online' : 'Device went offline'; if (alert.check_type === 'cpu_usage') return `CPU usage above ${config.percent_max}%`; if (alert.check_type === 'memory_usage') return `Memory usage above ${config.percent_max}%`; if (alert.check_type === 'ping') return `${config.target} failing ping conditions`; return alert.policy_name; } catch { return alert.check_type; } }

async function onRemove() {
  if (!dashboardId.value || !confirm('Remove this widget?')) return;
  await api.dashboards.widgets.delete(dashboardId.value, item.id);
  removeLocalWidget(item.id);
  const el = item.node?.el;
  if (el) removeWidget(el, true, true);
}
</script>

<style scoped>
.dwig-content { position:relative; height:100%; box-sizing:border-box; overflow:hidden; display:flex; flex-direction:column; background:var(--color-surface); border:1px solid var(--color-border); border-radius:8px; padding:14px; }
.dwig-remove { position:absolute; top:8px; right:8px; z-index:2; background:color-mix(in srgb, var(--color-surface) 85%, transparent); border:1px solid var(--color-border); color:var(--color-text-muted); border-radius:5px; width:22px; height:22px; cursor:pointer; }
.dwig-gear { position:absolute; top:8px; right:34px; z-index:2; background:color-mix(in srgb, var(--color-surface) 85%, transparent); border:1px solid var(--color-border); color:var(--color-text-muted); border-radius:5px; width:22px; height:22px; cursor:pointer; font-size:12px; }
/* Overrides the global .stat-grid's display:grid, whose single implicit row
   sizes to its content rather than stretching -- a taller widget just grew
   dead space below the row, not the row itself. Neither justify-content:center
   on the .dwig-content parent nor flex-grow:1 on .dash-stats itself actually
   moved the rendered box in testing (computed styles showed both applied
   correctly; the box didn't respond either way -- not fully explained, but
   margin:auto is the one centering technique that measurably worked, so
   that's what's here, verified against real pixel measurements before and
   after, not assumed from the CSS alone). */
.dash-stats { display:flex; gap:10px; flex-shrink:0; margin:auto 0; }
.dash-stats .stat-card { flex:1; min-width:0; padding:12px; display:flex; flex-direction:column; justify-content:center; gap:4px; }
.widget-title { display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:700; margin-bottom:12px; flex-shrink:0; }
.widget-title a { font-size:11px; font-weight:400; }
.widget-chart :deep(.donut-wrap) { flex:1; min-height:0; align-items:center; }
.widget-chart :deep(.donut-legend) { gap:6px; }
.widget-empty { color:var(--color-text-muted); font-size:13px; padding:32px; text-align:center; }
.widget-table-wrap { min-height:0; flex:1; overflow:auto; }
.widget-table { width:100%; border-collapse:collapse; font-size:12px; }
.widget-table th { text-align:left; color:var(--color-text-muted); font-size:10px; text-transform:uppercase; padding:7px 9px; border-bottom:1px solid var(--color-border); }
.widget-table td { padding:8px 9px; border-bottom:1px solid var(--color-border); white-space:nowrap; }
.widget-table tr { cursor:pointer; }
.widget-table tr:hover td { background:var(--color-surface-raised); }
.empty-cell { color:var(--color-text-muted); text-align:center; }
.pri-badge { display:inline-block; padding:2px 7px; border-radius:10px; font-size:10px; font-weight:700; text-transform:capitalize; }
.pri-critical { background:var(--color-danger); color:#fff; }
.pri-high { background:#e07830; color:#fff; }
.pri-moderate { background:var(--color-warning); color:#1a1200; }
.pri-low { background:var(--color-text-muted); color:var(--color-surface); }
</style>
