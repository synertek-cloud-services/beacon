<template>
  <div v-if="loading" class="ad-loading">Loading…</div>
  <div v-else-if="!alert" class="ad-loading">Alert not found.</div>
  <div v-else class="ad-page">

    <nav class="pf-crumb">
      <RouterLink to="/global/alerts" class="pf-crumb-link">Alerts</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ truncate(alertMessage(alert), 60) }}</span>
    </nav>

    <div class="ad-topbar">
      <div class="ad-title-row">
        <span class="pri-badge" :class="`pri-${effectivePriority(alert)}`"
          :title="effectivePriority(alert) !== alert.priority ? `Escalated from ${capitalize(alert.priority)}` : undefined">
          {{ capitalize(effectivePriority(alert)) }}
          <span v-if="effectivePriority(alert) !== alert.priority" class="pri-escalated">↑</span>
        </span>
        <h1 class="ad-title">Alert on {{ alert.hostname ?? alert.device_id.slice(0, 8) }}</h1>
      </div>
      <div class="ad-topbar-actions">
        <button
          v-if="alert.is_alerting && !alert.acknowledged_at"
          class="btn btn-ghost btn-sm"
          :disabled="actionBusy"
          @click="acknowledge"
        >Acknowledge</button>
        <button
          v-if="alert.is_alerting"
          class="btn btn-ghost btn-sm btn-danger-ghost"
          :disabled="actionBusy"
          @click="resolve"
        >Resolve</button>
      </div>
    </div>

    <div v-if="actionError" class="error-banner" style="margin-bottom:12px">{{ actionError }}</div>

    <!-- Overview card -->
    <div class="ad-card">
      <div class="ad-card-title">Overview</div>
      <div class="ad-grid">
        <div class="ad-col">
          <div class="ad-row">
            <span class="ad-label">Message</span>
            <span class="ad-val">{{ alertMessage(alert) }}</span>
          </div>
          <div class="ad-row">
            <span class="ad-label">Created</span>
            <span class="ad-val mono">{{ fmtTs(alert.alerted_at) }}</span>
          </div>
          <div class="ad-row">
            <span class="ad-label">Status</span>
            <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
          </div>
          <div class="ad-row">
            <span class="ad-label">Alert ID</span>
            <span class="ad-val mono text-muted-2" style="font-size:11px">{{ alert.id }}</span>
          </div>
          <div v-if="alert.acknowledged_at" class="ad-row">
            <span class="ad-label">Acknowledged by</span>
            <span class="ad-val">{{ alert.acknowledged_by ?? '—' }}</span>
          </div>
        </div>
        <div class="ad-col">
          <div class="ad-row">
            <span class="ad-label">Device</span>
            <RouterLink :to="'/devices/' + alert.device_id" class="ad-link">{{ alert.hostname ?? alert.device_id.slice(0, 8) }}</RouterLink>
          </div>
          <div class="ad-row">
            <span class="ad-label">Company</span>
            <span class="ad-val">{{ alert.tenant_name }}</span>
          </div>
          <div class="ad-row">
            <span class="ad-label">Policy</span>
            <RouterLink :to="'/global/policies/' + alert.policy_id" class="ad-link">{{ alert.policy_name }}</RouterLink>
          </div>
          <div class="ad-row">
            <span class="ad-label">Monitor Type</span>
            <span class="ad-val">{{ categoryLabel(alert.check_type) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline card -->
    <div class="ad-card">
      <div class="ad-card-title">Timeline</div>
      <div class="ad-timeline">
        <div v-for="evt in timeline" :key="evt.key" class="ad-tl-item">
          <div class="ad-tl-left">
            <span class="ad-tl-icon" :class="'tl-' + evt.kind">
              <svg v-if="evt.kind === 'created'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <svg v-else-if="evt.kind === 'acknowledged'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </span>
            <div class="ad-tl-connector" v-if="!evt.last"></div>
          </div>
          <div class="ad-tl-body">
            <div class="ad-tl-title">{{ evt.title }}</div>
            <div v-if="evt.detail" class="ad-tl-detail">{{ evt.detail }}</div>
            <div class="ad-tl-time">
              <span class="ad-tl-abs mono">{{ fmtTs(evt.ts) }}</span>
              <span class="ad-tl-rel text-muted-2">{{ relTime(evt.ts) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Device Alerts card -->
    <div class="ad-card">
      <div class="ad-card-title">
        Other Alerts on this Device
        <span v-if="deviceAlerts.length" class="ad-badge">{{ deviceAlerts.length }}</span>
      </div>
      <div v-if="deviceAlertsLoading" class="ad-empty">Loading…</div>
      <div v-else-if="!deviceAlerts.length" class="ad-empty">No other alerts for this device in the last 30 days.</div>
      <table v-else class="ad-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Priority</th>
            <th>Category</th>
            <th>Message</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in deviceAlerts"
            :key="a.id"
            :class="{ 'ad-row-current': a.id === alert.id }"
            @click="router.push('/global/alerts/' + a.id)"
          >
            <td class="mono text-muted-2" style="white-space:nowrap;font-size:11px">{{ fmtTs(a.alerted_at) }}</td>
            <td>
              <span class="pri-badge" :class="`pri-${effectivePriority(a)}`">{{ capitalize(effectivePriority(a)) }}</span>
            </td>
            <td class="text-muted-2" style="white-space:nowrap">{{ categoryLabel(a.check_type) }}</td>
            <td class="ad-msg-link">{{ alertMessage(a) }}</td>
            <td>
              <span class="status-pill" :class="!a.is_alerting ? 'status-resolved' : a.acknowledged_at ? 'status-acked' : 'status-open'">
                {{ !a.is_alerting ? 'Resolved' : a.acknowledged_at ? 'Acknowledged' : 'Open' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AlertState, type CheckType, type AlertPriority } from '../api';

const route  = useRoute();
const router = useRouter();

const alert           = ref<AlertState | null>(null);
const loading         = ref(true);
const actionBusy      = ref(false);
const actionError     = ref('');
const deviceAlerts    = ref<AlertState[]>([]);
const deviceAlertsLoading = ref(true);

// ── Priority escalation ────────────────────────────────────────
const ESCALATION_LADDER: AlertPriority[] = ['low', 'moderate', 'high', 'critical'];
const ESCALATION_HOURS: Record<AlertPriority, number> = { low: 4, moderate: 4, high: 2, critical: Infinity };

function effectivePriority(a: AlertState): AlertPriority {
  if (!a.is_alerting || a.acknowledged_at) return a.priority as AlertPriority;
  const hoursOpen = (Date.now() / 1000 - (a.alerted_at ?? 0)) / 3600;
  const idx = ESCALATION_LADDER.indexOf(a.priority as AlertPriority);
  return hoursOpen >= ESCALATION_HOURS[a.priority as AlertPriority] && idx < 3
    ? ESCALATION_LADDER[idx + 1]
    : a.priority as AlertPriority;
}

const statusClass = computed(() => {
  if (!alert.value) return '';
  if (!alert.value.is_alerting) return 'status-resolved';
  if (alert.value.acknowledged_at) return 'status-acked';
  return 'status-open';
});

const statusLabel = computed(() => {
  if (!alert.value) return '';
  if (!alert.value.is_alerting) return 'Resolved';
  if (alert.value.acknowledged_at) return 'Acknowledged';
  return 'Open';
});

// ── Timeline ───────────────────────────────────────────────────
interface TimelineEvent {
  key: string;
  kind: 'created' | 'acknowledged' | 'resolved';
  title: string;
  detail?: string;
  ts: number;
  last: boolean;
}

const timeline = computed((): TimelineEvent[] => {
  if (!alert.value) return [];
  const a = alert.value;
  const evts: TimelineEvent[] = [];

  if (a.alerted_at) {
    evts.push({ key: 'created', kind: 'created', title: 'Alert Created', ts: a.alerted_at, last: false });
  }
  if (a.acknowledged_at) {
    evts.push({ key: 'acked', kind: 'acknowledged', title: 'Acknowledged', detail: a.acknowledged_by ? `by ${a.acknowledged_by}` : undefined, ts: a.acknowledged_at, last: false });
  }
  if (a.resolved_at) {
    evts.push({ key: 'resolved', kind: 'resolved', title: 'Resolved', ts: a.resolved_at, last: false });
  }

  evts.sort((a, b) => a.ts - b.ts);
  if (evts.length) evts[evts.length - 1].last = true;
  return evts;
});

// ── Load ────────────────────────────────────────────────────────
onMounted(async () => {
  const id = route.params.id as string;
  try {
    alert.value = await api.alerts.get(id);
  } catch {
    alert.value = null;
  } finally {
    loading.value = false;
  }

  if (alert.value) {
    try {
      const all = await api.alerts.list('all', '', '', alert.value.device_id);
      deviceAlerts.value = all;
    } catch {
      deviceAlerts.value = [];
    } finally {
      deviceAlertsLoading.value = false;
    }
  } else {
    deviceAlertsLoading.value = false;
  }
});

// ── Actions ────────────────────────────────────────────────────
async function acknowledge() {
  if (!alert.value) return;
  actionBusy.value = true;
  actionError.value = '';
  try {
    await api.alerts.acknowledge(alert.value.id);
    alert.value = { ...alert.value, acknowledged_at: Math.floor(Date.now() / 1000) };
  } catch (e: any) {
    actionError.value = e.message;
  } finally {
    actionBusy.value = false;
  }
}

async function resolve() {
  if (!alert.value) return;
  actionBusy.value = true;
  actionError.value = '';
  try {
    await api.alerts.resolve(alert.value.id);
    router.push('/global/alerts');
  } catch (e: any) {
    actionError.value = e.message;
  } finally {
    actionBusy.value = false;
  }
}

// ── Formatters ─────────────────────────────────────────────────
function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const d = Math.floor(diff / 86400);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function categoryLabel(ct: CheckType | string): string {
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
        if (state === 'not_running')           return 'AV not running';
        if (state === 'running_not_up_to_date') return 'AV out of date';
        return 'Antivirus issue';
      }
      case 'file_size': {
        const cmp = (cfg.mode as string) === 'over' ? 'above' : 'below';
        return `${cfg.path} ${cmp} ${cfg.threshold_mb} MB`;
      }
      case 'ping':    return `${cfg.target} failing ping conditions`;
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
</script>

<style scoped>
.ad-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px; }
.ad-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--color-text-muted); font-size: 14px; }

/* Topbar */
.ad-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.ad-title-row { display: flex; align-items: center; gap: 10px; }
.ad-title { font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin: 0; }
.ad-topbar-actions { display: flex; gap: 8px; }

/* Cards */
.ad-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
.ad-card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--color-text-primary);
  padding: 14px 18px 12px; border-bottom: 1px solid var(--color-border);
}
.ad-badge { font-size: 11px; font-weight: 700; background: var(--color-border-strong); color: var(--color-text-muted); padding: 1px 7px; border-radius: 10px; }
.ad-empty { padding: 32px 18px; text-align: center; font-size: 13px; color: var(--color-text-muted); }

/* Overview grid */
.ad-grid { display: grid; grid-template-columns: 1fr 1fr; padding: 6px 0 10px; }
.ad-col { padding: 0 18px; }
.ad-col:first-child { border-right: 1px solid var(--color-border); }
.ad-row { display: flex; align-items: baseline; gap: 12px; padding: 7px 0; font-size: 13px; }
.ad-label { font-weight: 600; color: var(--color-text-muted); min-width: 120px; flex-shrink: 0; }
.ad-val { color: var(--color-text-primary); }
.ad-link { color: var(--color-primary); text-decoration: none; font-weight: 500; }
.ad-link:hover { text-decoration: underline; }

/* Status pills */
.status-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.status-open     { background: rgba(232,86,106,.12); color: var(--color-danger); }
.status-acked    { background: rgba(240,180,40,.12);  color: var(--color-warning); }
.status-resolved { color: var(--color-text-subtle); }

/* Priority badges */
.pri-badge {
  display: inline-block; padding: 3px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.pri-critical { background: var(--color-danger);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--color-warning); color: #1a1200; }
.pri-low      { background: var(--color-text-muted); color: var(--color-surface); }
.pri-escalated { font-size: 10px; margin-left: 3px; opacity: .85; }

/* Timeline */
.ad-timeline { padding: 20px 18px; display: flex; flex-direction: column; gap: 0; }
.ad-tl-item { display: flex; gap: 16px; }
.ad-tl-left { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.ad-tl-icon {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 2px solid var(--color-border);
  background: var(--color-surface-raised); color: var(--color-text-muted);
}
.tl-created      { border-color: rgba(232,86,106,.5); background: rgba(232,86,106,.1); color: var(--color-danger); }
.tl-acknowledged { border-color: rgba(240,180,40,.5);  background: rgba(240,180,40,.1);  color: var(--color-warning); }
.tl-resolved     { border-color: rgba(45,207,160,.5);  background: rgba(45,207,160,.1);  color: var(--color-success); }
.ad-tl-connector { flex: 1; width: 2px; background: var(--color-border); margin: 4px 0; min-height: 24px; }
.ad-tl-body { padding-bottom: 24px; flex: 1; }
.ad-tl-title { font-size: 13px; font-weight: 600; color: var(--color-text-primary); line-height: 30px; }
.ad-tl-detail { font-size: 12px; color: var(--color-text-muted); margin-top: 2px; }
.ad-tl-time { display: flex; gap: 12px; align-items: baseline; margin-top: 4px; }
.ad-tl-abs { font-size: 12px; color: var(--color-text-primary); font-family: var(--mono); }
.ad-tl-rel { font-size: 11px; }

/* Device Alerts table */
.ad-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ad-table th {
  background: var(--color-surface-raised); padding: 7px 14px;
  text-align: left; font-size: 10px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}
.ad-table td { padding: 9px 14px; border-bottom: 1px solid var(--color-border); color: var(--color-text-primary); vertical-align: middle; }
.ad-table tr:last-child td { border-bottom: none; }
.ad-table tr { cursor: pointer; transition: background .08s; }
.ad-table tr:hover td { background: var(--color-surface-raised); }
.ad-row-current td { background: rgba(78,126,247,.07); }
.ad-row-current:hover td { background: rgba(78,126,247,.12); }
.ad-msg-link { color: var(--color-primary); }

.mono { font-family: var(--mono); }
.text-muted-2 { color: var(--color-text-subtle); }
</style>
