<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Stat cards -->
    <div class="stat-grid">
      <div class="stat-card c-blue">
        <div class="stat-label">Total Devices</div>
        <div class="stat-value">{{ summary?.total ?? '—' }}</div>
        <div class="stat-sub">{{ summary?.approved ?? 0 }} approved</div>
      </div>
      <div class="stat-card c-teal">
        <div class="stat-label">Online Now</div>
        <div class="stat-value">{{ summary?.online ?? '—' }}</div>
        <div class="stat-sub">checked in &lt; 5 min ago</div>
      </div>
      <div class="stat-card c-amber">
        <div class="stat-label">Pending Approval</div>
        <div class="stat-value">{{ summary?.pending ?? '—' }}</div>
        <div class="stat-sub">
          <RouterLink to="/devices" style="color:inherit">Review →</RouterLink>
        </div>
      </div>
      <div class="stat-card c-red">
        <div class="stat-label">Active Alerts</div>
        <div class="stat-value">{{ activeAlerts.length }}</div>
        <div class="stat-sub">{{ alertBreakdown }}</div>
      </div>
    </div>

    <!-- Recent alerts -->
    <div class="section-card" v-if="recentAlerts.length">
      <div class="section-card-head">
        <span class="section-card-title">Recent Alerts <span v-if="recentAlerts.length" class="ov-count-badge">{{ recentAlerts.length }}</span></span>
        <div style="display:flex;align-items:center;gap:14px">
          <button
            class="btn btn-ghost btn-sm"
            :disabled="!selected.size || resolving"
            @click="resolveSelected"
          >{{ resolving ? 'Resolving…' : 'Resolve' }}</button>
          <RouterLink to="/global/alerts" style="font-size:11px">View all →</RouterLink>
        </div>
      </div>
      <div class="ov-table-wrap">
        <table class="ov-alert-table">
          <thead>
            <tr>
              <th class="th-check"><input type="checkbox" :checked="allSelected" @change="toggleAll" /></th>
              <th>Created</th>
              <th>Priority</th>
              <th>Category</th>
              <th>Message</th>
              <th>Company</th>
              <th>Hostname</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in topAlerts" :key="a.id" :class="{ 'tr-selected': selected.has(a.id) }" @click="router.push('/global/alerts/' + a.id)">
              <td class="td-check" @click.stop><input type="checkbox" :checked="selected.has(a.id)" @change="toggleSelect(a.id)" /></td>
              <td class="mono ov-alert-created">{{ formatDate(a.alerted_at) }}</td>
              <td><span class="pri-badge" :class="`pri-${a.priority}`">{{ a.priority }}</span></td>
              <td class="ov-alert-cat">{{ categoryLabel(a.check_type) }}</td>
              <td class="ov-alert-msg">{{ alertMessage(a) }}</td>
              <td class="ov-alert-company">{{ a.tenant_name }}</td>
              <td class="ov-alert-host">
                <router-link v-if="a.device_id" :to="'/devices/' + a.device_id" @click.stop>{{ a.hostname ?? '—' }}</router-link>
                <template v-else>{{ a.hostname ?? '—' }}</template>
              </td>
              <td>
                <span class="status-pill" :class="a.is_alerting === 1 ? 'status-open' : 'status-resolved'">
                  {{ a.is_alerting === 1 ? 'Open' : 'Resolved' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Charts -->
    <div class="chart-grid" v-if="summary">
      <div class="chart-card">
        <div class="chart-card-title">Online / Offline</div>
        <DonutChart
          :data="onlineData"
          center-label="approved"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">By Operating System</div>
        <DonutChart
          :data="osData"
          center-label="devices"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">By Device Class</div>
        <DonutChart
          :data="classData"
          center-label="devices"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Offline Devices by Type</div>
        <DonutChart
          v-if="summary.offline > 0"
          :data="offlineClassData"
          center-label="offline"
        />
        <div v-else class="ov-chart-empty">All devices online</div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Antivirus Status</div>
        <DonutChart
          :data="avStatusData"
          center-label="devices"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Alerts by Priority (Open)</div>
        <DonutChart
          v-if="activeAlerts.length > 0"
          :data="priorityData"
          center-label="alerts"
        />
        <div v-else class="ov-chart-empty">No open alerts</div>
      </div>
    </div>
    <div class="chart-grid" v-else-if="!error">
      <div class="chart-card" v-for="i in 3" :key="i" style="min-height:140px">
        <div class="chart-card-title">Loading…</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Summary, type AlertState } from '../api';
import DonutChart from '../components/DonutChart.vue';

const router = useRouter();

const summary   = ref<Summary | null>(null);
const allAlerts = ref<AlertState[]>([]); // last 30 days, open + resolved — server-scoped by status=all
const error     = ref('');
const selected  = ref(new Set<string>());
const resolving = ref(false);

const activeAlerts = computed(() => allAlerts.value.filter(a => a.is_alerting === 1));

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#e8566a',
  high:     '#e07830',
  moderate: '#f0a840',
  low:      '#616480',
};

const AV_COLORS: Record<string, string> = {
  running_up_to_date:     '#2dcfa0',
  running_not_up_to_date: '#f0a840',
  not_running:            '#e8566a',
  not_detected:           '#e8566a',
  unknown:                '#616480',
};

const AV_LABELS: Record<string, string> = {
  running_up_to_date:     'Up to date',
  running_not_up_to_date: 'Out of date',
  not_running:            'Not running',
  not_detected:           'Not detected',
  unknown:                'Unknown',
};

const OS_COLORS: Record<string, string> = {
  linux:   '#4e7ef7',
  windows: '#2dcfa0',
  darwin:  '#f0a840',
  unknown: '#616480',
};

const CLASS_COLORS: Record<string, string> = {
  server:      '#4e7ef7',
  workstation: '#2dcfa0',
  laptop:      '#f0a840',
  unknown:     '#616480',
};

// Offline severity isn't uniform across classes — it mirrors the same
// judgment call the Device Offline policy itself makes (server-only
// alerting, since workstations/laptops going offline is normal/expected,
// not a problem). Red here would misrepresent a closed laptop as being
// exactly as urgent as a downed server, so only "server" gets a warning
// color; workstation/laptop stay muted/neutral.
const OFFLINE_CLASS_COLORS: Record<string, string> = {
  server:      '#e8566a',
  workstation: '#616480',
  laptop:      '#616480',
  unknown:     '#616480',
};

const onlineData = computed(() => [
  { label: 'Online',  value: summary.value?.online  ?? 0, color: '#2dcfa0' },
  { label: 'Offline', value: summary.value?.offline ?? 0, color: '#2d3148' },
]);

const osData = computed(() =>
  Object.entries(summary.value?.by_os ?? {}).map(([os, count]) => ({
    label: os,
    value: count,
    color: OS_COLORS[os] ?? '#616480',
  }))
);

const classData = computed(() =>
  Object.entries(summary.value?.by_class ?? {}).map(([cls, count]) => ({
    label: cls,
    value: count,
    color: CLASS_COLORS[cls] ?? '#616480',
  }))
);

const offlineClassData = computed(() =>
  Object.entries(summary.value?.offline_by_class ?? {}).map(([cls, count]) => ({
    label: cls,
    value: count,
    color: OFFLINE_CLASS_COLORS[cls] ?? '#616480',
  }))
);

const avStatusData = computed(() =>
  Object.entries(summary.value?.by_av_status ?? {}).map(([status, count]) => ({
    label: AV_LABELS[status] ?? status,
    value: count,
    color: AV_COLORS[status] ?? '#616480',
  }))
);

const PRIORITY_ORDER = ['critical', 'high', 'moderate', 'low'];

const priorityData = computed(() => {
  const counts: Record<string, number> = {};
  for (const a of activeAlerts.value) counts[a.priority] = (counts[a.priority] ?? 0) + 1;
  return PRIORITY_ORDER.filter(p => counts[p]).map(p => ({
    label: p,
    value: counts[p],
    color: PRIORITY_COLORS[p] ?? '#616480',
  }));
});

const alertBreakdown = computed(() => {
  if (!activeAlerts.value.length) return 'no issues detected';
  return priorityData.value.map(p => `${p.value} ${p.label}`).join(', ');
});

const recentAlerts = computed(() =>
  [...allAlerts.value].sort((a, b) => (b.alerted_at ?? 0) - (a.alerted_at ?? 0))
);

const topAlerts = computed(() => recentAlerts.value.slice(0, 12));

const allSelected = computed(() =>
  topAlerts.value.length > 0 && topAlerts.value.every(a => selected.value.has(a.id)),
);

function toggleAll() {
  const s = new Set(selected.value);
  if (allSelected.value) topAlerts.value.forEach(a => s.delete(a.id));
  else                   topAlerts.value.forEach(a => s.add(a.id));
  selected.value = s;
}

function toggleSelect(id: string) {
  const s = new Set(selected.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selected.value = s;
}

async function resolveSelected() {
  if (!selected.value.size) return;
  resolving.value = true;
  try {
    await Promise.all([...selected.value].map(id => api.alerts.resolve(id)));
    selected.value = new Set();
    await load();
  } catch {
    // individual errors are silent; reload will show current state
  } finally {
    resolving.value = false;
  }
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function categoryLabel(ct: string): string {
  switch (ct) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Online Status';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    case 'av_status':    return 'Antivirus';
    case 'file_size':    return 'File/Folder Size';
    case 'ping':         return 'Ping';
    case 'process':      return 'Process';
    case 'service':      return 'Service';
    case 'software':     return 'Software';
    default:             return ct;
  }
}

function alertMessage(a: AlertState): string {
  try {
    const cfg = JSON.parse(a.config) as Record<string, unknown>;
    switch (a.check_type) {
      case 'offline': {
        const direction = (cfg.direction as string) ?? 'offline';
        return direction === 'online' ? 'Device came online' : 'Device went offline';
      }
      case 'disk_space': {
        const drive = (cfg.drive as string) === 'any' ? 'A drive' : (cfg.drive as string);
        const type  = (cfg.threshold_type as string) ?? 'gb_free';
        const value = cfg.threshold_value as number;
        const unit  = type === 'percent_used' ? '%' : ' GB';
        const label = type === 'gb_free' ? 'free space' : type === 'percent_used' ? 'used' : 'used space';
        const cmp   = type === 'gb_free' ? 'below' : 'above';
        return `${drive} ${label} ${cmp} ${value}${unit}`;
      }
      case 'cpu_usage':    return `CPU usage above ${cfg.percent_max}%`;
      case 'memory_usage': return `Memory usage above ${cfg.percent_max}%`;
      case 'av_status': {
        const state = cfg.av_state as string;
        if (state === 'not_detected')          return 'AV not detected';
        if (state === 'not_running')            return 'AV not running';
        if (state === 'running_not_up_to_date') return 'AV out of date';
        return 'Antivirus issue';
      }
      case 'file_size': {
        const cmp = (cfg.mode as string) === 'over' ? 'above' : 'below';
        return `${cfg.path} ${cmp} ${cfg.threshold_mb} MB`;
      }
      case 'ping': return `${cfg.target} failing ping conditions`;
      case 'process': {
        const mode = cfg.mode as string;
        if (mode === 'running' || mode === 'stopped') return `${cfg.process_name} is ${mode}`;
        return `${cfg.process_name} ${mode} above ${cfg.threshold_pct}%`;
      }
      case 'service': {
        const mode = cfg.mode as string;
        if (mode === 'running' || mode === 'stopped') return `${cfg.service_name} is ${mode}`;
        return `${cfg.service_name} ${mode} above ${cfg.threshold_pct}%`;
      }
      case 'software': {
        const mode = cfg.mode as string;
        const verb = mode === 'installed' ? 'was installed' : mode === 'uninstalled' ? 'was uninstalled' : 'changed version';
        return `${cfg.name_pattern} ${verb}`;
      }
      default: return a.check_type;
    }
  } catch {
    return a.check_type;
  }
}

async function load() {
  try {
    const [s, alerts] = await Promise.all([api.summary.get(), api.alerts.list('all')]);
    summary.value = s;
    allAlerts.value = alerts;
  } catch (e: any) {
    error.value = e.message;
  }
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.ov-chart-empty {
  display: flex; align-items: center; justify-content: center;
  height: 110px; font-size: 12px; color: var(--muted);
}

.ov-count-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; margin-left: 6px;
  background: var(--red); color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 10px;
}

.ov-table-wrap { overflow-x: auto; }
.ov-alert-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ov-alert-table th {
  padding: 9px 16px; text-align: left; font-size: 10px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase; color: var(--muted);
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.ov-alert-table td { padding: 9px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; color: var(--text); }
.ov-alert-table tr:last-child td { border-bottom: none; }
.ov-alert-table tr { cursor: pointer; transition: background .08s; }
.ov-alert-table tr:hover td { background: var(--surface-2); }
.ov-alert-table tr.tr-selected td { background: rgba(78,126,247,.07); }
.th-check, .td-check { width: 36px; }
.ov-alert-created { white-space: nowrap; color: var(--muted-2); font-size: 11px; }
.ov-alert-cat  { color: var(--muted-2); font-size: 11px; white-space: nowrap; }
.ov-alert-msg  { color: var(--text); }
.ov-alert-host { color: var(--accent); white-space: nowrap; }
.ov-alert-company { color: var(--muted); white-space: nowrap; }

.status-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.status-open     { color: var(--text); }
.status-resolved { color: var(--muted-2); }

/* Duplicated from GlobalAlertsPage.vue per this codebase's established
   duplication-over-sharing convention for small per-page presentational CSS. */
.pri-badge {
  display: inline-block; padding: 3px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 700; white-space: nowrap; text-transform: capitalize;
}
.pri-critical { background: var(--red);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--amber); color: #1a1200; }
.pri-low      { background: var(--muted); color: var(--surface); }
</style>
