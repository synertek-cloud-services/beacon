<template>
  <div class="al-page">

    <!-- Search bar -->
    <div class="al-search-wrap">
      <span class="al-search-label">Search Alerts</span>
      <div class="al-search-field">
        <svg class="al-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          v-model="searchQuery"
          class="al-search-input"
          type="search"
          placeholder="Search…"
          @input="onSearch"
        />
      </div>
    </div>

    <!-- Table card -->
    <div class="al-card">

      <!-- Card header -->
      <div class="al-card-header">
        <div class="al-card-title">
          Alerts
          <span v-if="total > 0" class="al-count-badge">{{ total }}</span>
        </div>
        <div class="al-card-actions">
          <button
            class="btn-action"
            :disabled="!selected.size || acknowledging"
            @click="acknowledgeSelected"
          >{{ acknowledging ? 'Acknowledging…' : 'Acknowledge' }}</button>
          <button
            class="btn-action btn-action-resolve"
            :disabled="!selected.size || resolving"
            @click="resolveSelected"
          >{{ resolving ? 'Resolving…' : 'Resolve' }}</button>
        </div>
      </div>

      <!-- Filter pills -->
      <div class="al-filters">
        <span class="al-filters-label">Filtered by:</span>
        <div class="al-pill-group">
          <span class="al-filter-tag">Status</span>
          <button
            class="al-pill"
            :class="{ 'al-pill-active': statusFilter === 'active' }"
            @click="setStatus('active')"
          >Open <span class="al-pill-x" @click.stop="setStatus('active')">×</span></button>
          <button
            class="al-pill"
            :class="{ 'al-pill-active': statusFilter === 'all' }"
            @click="setStatus('all')"
          >All <span class="al-pill-x" @click.stop="setStatus('all')">×</span></button>
        </div>
        <div class="al-pill-group">
          <span class="al-filter-tag">Created</span>
          <span class="al-pill al-pill-static">Last 30 Days <span class="al-pill-x">×</span></span>
        </div>
        <div class="al-pill-group" v-if="companyId">
          <span class="al-filter-tag">Company</span>
          <span class="al-pill al-pill-static">{{ companyName }} <span class="al-pill-x" @click="clearCompany">×</span></span>
        </div>
        <button v-if="statusFilter !== 'active' || searchQuery || companyId" class="al-reset" @click="reset">Reset Filters</button>
      </div>

      <!-- Table -->
      <div class="al-table-wrap">
        <div v-if="loading" class="al-state-msg text-muted">Loading…</div>

        <div v-else-if="!pageRows.length" class="al-state-msg">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted)">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <div style="margin-top:8px;font-weight:500">{{ statusFilter === 'active' ? 'No active alerts' : 'No alerts in the last 30 days' }}</div>
        </div>

        <table v-else class="al-table">
          <thead>
            <tr>
              <th class="th-check">
                <input type="checkbox" :checked="allSelected" @change="toggleAll" />
              </th>
              <th class="th-created" @click="toggleSort('alerted_at')">
                Created
                <span class="sort-arrow">{{ sortCol === 'alerted_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
              </th>
              <th class="th-priority" @click="toggleSort('priority')">
                Priority
                <span class="sort-arrow">{{ sortCol === 'priority' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
              </th>
              <th>Category</th>
              <th class="th-message">Message</th>
              <th>Company</th>
              <th>Hostname</th>
              <th>Monitor Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in pageRows"
              :key="a.id"
              :class="{ 'tr-selected': selected.has(a.id) }"
              @click="router.push('/global/alerts/' + a.id)"
            >
              <td class="td-check" @click.stop>
                <input type="checkbox" :checked="selected.has(a.id)" @change="toggleSelect(a.id)" />
              </td>
              <td class="td-created mono">{{ formatDate(a.alerted_at) }}</td>
              <td>
                <span
                  class="pri-badge"
                  :class="`pri-${effectivePriority(a)}`"
                  :title="effectivePriority(a) !== a.priority ? `Escalated from ${capitalize(a.priority)} — unacknowledged for ${Math.floor((Date.now()/1000 - (a.alerted_at ?? 0)) / 3600)}h` : undefined"
                >
                  {{ capitalize(effectivePriority(a)) }}
                  <span v-if="effectivePriority(a) !== a.priority" class="pri-escalated">↑</span>
                </span>
              </td>
              <td class="td-category">{{ categoryLabel(a.check_type) }}</td>
              <td class="td-message">
                <span class="msg-link">{{ alertMessage(a) }}</span>
              </td>
              <td class="td-company">{{ a.tenant_name }}</td>
              <td class="td-hostname">
                <router-link v-if="a.device_id" :to="'/devices/' + a.device_id" @click.stop>{{ a.hostname ?? '—' }}</router-link>
                <template v-else>{{ a.hostname ?? '—' }}</template>
              </td>
              <td class="td-montype">{{ categoryLabel(a.check_type) }}</td>
              <td>
                <span class="status-pill" :class="alertStatusClass(a)">{{ alertStatusLabel(a) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="al-pagination">
        <button class="pg-btn" :disabled="page === 1" @click="page--">‹</button>
        <span class="pg-info">{{ page }}</span>
        <button class="pg-btn" :disabled="page >= totalPages" @click="page++">›</button>
        <span class="pg-sep"></span>
        <span class="pg-count">{{ perPage }} / page</span>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AlertState, type Tenant } from '../api';

const route  = useRoute();
const router = useRouter();

const allAlerts    = ref<AlertState[]>([]);
const tenants      = ref<Tenant[]>([]);
const loading      = ref(true);
const resolving    = ref(false);
const acknowledging = ref(false);
const statusFilter = ref<'active' | 'all'>('active');
const searchQuery  = ref('');
const selected     = ref(new Set<string>());
const page         = ref(1);
const perPage      = 20;
const sortCol      = ref<'alerted_at' | 'priority'>('alerted_at');
const sortDir      = ref<'asc' | 'desc'>('desc');

let searchTimer: ReturnType<typeof setTimeout> | null = null;

const companyId   = computed(() => route.query.company as string | undefined);
const companyName = computed(() =>
  tenants.value.find(t => t.id === companyId.value)?.name ?? companyId.value ?? ''
);

async function load() {
  loading.value = true;
  selected.value.clear();
  try {
    const [alerts, tenantList] = await Promise.all([
      api.alerts.list(statusFilter.value, searchQuery.value, companyId.value ?? ''),
      tenants.value.length ? Promise.resolve(tenants.value) : api.tenants.list(),
    ]);
    allAlerts.value = alerts;
    tenants.value   = tenantList;
  } catch {
    allAlerts.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(statusFilter, () => { page.value = 1; load(); });
watch(companyId, () => { page.value = 1; load(); });

function clearCompany() {
  router.push({ path: '/global/alerts' });
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page.value = 1; load(); }, 350);
}

// ── Priority escalation ────────────────────────────────────────
type AlertPriority = 'low' | 'moderate' | 'high' | 'critical';
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

function alertStatusClass(a: AlertState): string {
  if (!a.is_alerting) return 'status-resolved';
  if (a.acknowledged_at) return 'status-acked';
  return 'status-open';
}

function alertStatusLabel(a: AlertState): string {
  if (!a.is_alerting) return 'Resolved';
  if (a.acknowledged_at) return 'Acknowledged';
  return 'Open';
}

// ── Priority sort order ────────────────────────────────────────
const priorityOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

const sorted = computed(() => {
  const rows = [...allAlerts.value];
  rows.sort((a, b) => {
    let diff = 0;
    if (sortCol.value === 'priority') {
      diff = (priorityOrder[effectivePriority(a)] ?? 9) - (priorityOrder[effectivePriority(b)] ?? 9);
    } else {
      diff = (a.alerted_at ?? 0) - (b.alerted_at ?? 0);
    }
    return sortDir.value === 'asc' ? diff : -diff;
  });
  return rows;
});

const total      = computed(() => allAlerts.value.length);
const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / perPage)));
const pageRows   = computed(() => sorted.value.slice((page.value - 1) * perPage, page.value * perPage));

const allSelected = computed(() =>
  pageRows.value.length > 0 && pageRows.value.every(r => selected.value.has(r.id)),
);

function toggleAll() {
  if (allSelected.value) {
    pageRows.value.forEach(r => selected.value.delete(r.id));
  } else {
    pageRows.value.forEach(r => selected.value.add(r.id));
  }
  selected.value = new Set(selected.value);
}

function toggleSelect(id: string) {
  const s = new Set(selected.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selected.value = s;
}

function toggleSort(col: typeof sortCol.value) {
  if (sortCol.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortCol.value = col;
    sortDir.value = 'desc';
  }
}

function setStatus(v: 'active' | 'all') { statusFilter.value = v; }

function reset() {
  statusFilter.value = 'active';
  searchQuery.value  = '';
  page.value         = 1;
  if (companyId.value) router.push({ path: '/global/alerts' });
  else load();
}

async function resolveSelected() {
  if (!selected.value.size) return;
  resolving.value = true;
  try {
    await Promise.all([...selected.value].map(id => api.alerts.resolve(id)));
    await load();
  } catch {
    // individual errors are silent; reload will show current state
  } finally {
    resolving.value = false;
  }
}

async function acknowledgeSelected() {
  if (!selected.value.size) return;
  acknowledging.value = true;
  try {
    await Promise.all([...selected.value].map(id => api.alerts.acknowledge(id)));
    // Update local state immediately so the status pills flip without a reload
    const ids = new Set(selected.value);
    const now = Math.floor(Date.now() / 1000);
    allAlerts.value = allAlerts.value.map(a =>
      ids.has(a.id) ? { ...a, acknowledged_at: now } : a
    );
    selected.value.clear();
    selected.value = new Set();
  } catch {
    await load();
  } finally {
    acknowledging.value = false;
  }
}

// ── Formatters ─────────────────────────────────────────────────
function formatDate(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
        return direction === 'online'
          ? 'Device came online'
          : 'Device went offline';
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
</script>

<style scoped>
.al-page { display: flex; flex-direction: column; gap: 16px; height: 100%; }

/* ── Search bar ─────────────────────────────────────────────── */
.al-search-wrap {
  display: flex; align-items: center; gap: 16px;
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--r-card);
  padding: 12px 16px;
  flex-shrink: 0;
}
.al-search-label { font-size: 12px; font-weight: 600; color: var(--color-text-muted); white-space: nowrap; }
.al-search-field { flex: 1; max-width: 480px; position: relative; display: flex; align-items: center; }
.al-search-icon  { position: absolute; left: 10px; color: var(--color-text-muted); pointer-events: none; }
.al-search-input {
  width: 100%; padding: 6px 10px 6px 32px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: 5px;
  color: var(--color-text-primary); font-size: 12px; font-family: var(--font); outline: none;
  transition: border-color .12s;
}
.al-search-input:focus { border-color: var(--color-primary); }
.al-search-input::placeholder { color: var(--color-text-muted); }
.al-search-input::-webkit-search-cancel-button { cursor: pointer; }

/* ── Table card ─────────────────────────────────────────────── */
.al-card {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--r-card);
}

.al-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 0;
  flex-shrink: 0;
}
.al-card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: var(--color-text-primary);
}
.al-count-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  background: var(--color-danger); color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 10px;
}
.al-card-actions { display: flex; gap: 8px; }
.btn-action {
  padding: 5px 12px; font-size: 12px; font-weight: 500; border-radius: var(--r-btn);
  border: 1px solid var(--color-border); background: var(--color-surface-raised); color: var(--color-text-primary);
  cursor: pointer; transition: background .1s, border-color .1s;
}
.btn-action:hover:not(:disabled) { background: var(--color-border); border-color: var(--color-border-strong); }
.btn-action:disabled { opacity: .4; cursor: default; }

/* ── Filter pills ───────────────────────────────────────────── */
.al-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.al-filters-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); }
.al-pill-group { display: flex; align-items: center; gap: 5px; }
.al-filter-tag { font-size: 11px; color: var(--color-text-subtle); }
.al-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;
  border: 1px solid var(--color-border); background: var(--color-surface-raised); color: var(--color-text-subtle);
  cursor: pointer; transition: background .1s, border-color .1s, color .1s;
}
.al-pill:hover { background: var(--color-border); color: var(--color-text-primary); }
.al-pill-active { background: rgba(78,126,247,.16); border-color: rgba(78,126,247,.4); color: var(--color-primary); }
.al-pill-static { cursor: default; }
.al-pill-x { opacity: .6; font-size: 13px; line-height: 1; }
.al-reset { font-size: 11px; color: var(--color-primary); background: none; border: none; cursor: pointer; padding: 0; }
.al-reset:hover { text-decoration: underline; }

/* ── Table ──────────────────────────────────────────────────── */
.al-table-wrap { flex: 1; overflow: auto; }
.al-state-msg {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 200px; gap: 4px; color: var(--color-text-primary);
}

.al-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.al-table thead { position: sticky; top: 0; z-index: 1; }
.al-table th {
  background: var(--color-surface-raised); padding: 7px 12px;
  text-align: left; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border); white-space: nowrap;
  cursor: pointer; user-select: none;
}
.al-table th:not(.th-check):hover { color: var(--color-text-primary); }
.sort-arrow { font-size: 11px; margin-left: 4px; opacity: .5; }
.th-check  { width: 36px; cursor: default; }
.th-created { width: 155px; }
.th-priority { width: 100px; }
.th-message  { min-width: 200px; }

.al-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--color-border);
  vertical-align: middle; color: var(--color-text-primary);
}
.al-table tr:last-child td { border-bottom: none; }
.al-table tr { cursor: pointer; transition: background .08s; }
.al-table tr:hover td { background: var(--color-surface-raised); }
.al-table tr.tr-selected td { background: rgba(78,126,247,.07); }
.al-table tr.tr-selected:hover td { background: rgba(78,126,247,.12); }

.td-check    { width: 36px; }
.td-created  { white-space: nowrap; color: var(--color-text-subtle); font-size: 11px; }
.td-category { white-space: nowrap; color: var(--color-text-subtle); }
.td-message  .msg-link { color: var(--color-primary); }
.td-company  { font-weight: 500; white-space: nowrap; color: var(--color-primary); }
.td-hostname { white-space: nowrap; color: var(--color-primary); }
.td-montype  { white-space: nowrap; color: var(--color-primary); }
.mono { font-family: var(--mono); }

/* Priority badges — filled pill */
.pri-badge {
  display: inline-block; padding: 3px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.pri-critical { background: var(--color-danger);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--color-warning); color: #1a1200; }
.pri-low      { background: var(--color-text-muted); color: var(--color-surface); }

/* Status pill */
.status-pill {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.status-open     { background: rgba(232,86,106,.12); color: var(--color-danger); }
.status-acked    { background: rgba(240,180,40,.12);  color: var(--color-warning); }
.status-resolved { color: var(--color-text-subtle); }

/* Escalation marker on priority badge */
.pri-escalated { font-size: 10px; margin-left: 3px; opacity: .85; }

/* Resolve button gets a mild red tint to differentiate from Acknowledge */
.btn-action-resolve:not(:disabled) { color: var(--color-danger); border-color: rgba(232,86,106,.3); }
.btn-action-resolve:hover:not(:disabled) { background: rgba(232,86,106,.08); }

/* ── Pagination ─────────────────────────────────────────────── */
.al-pagination {
  display: flex; align-items: center; justify-content: flex-end; gap: 4px;
  padding: 10px 16px; border-top: 1px solid var(--color-border); flex-shrink: 0;
}
.pg-btn {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface-raised);
  color: var(--color-text-primary); font-size: 14px; cursor: pointer; transition: background .1s;
}
.pg-btn:hover:not(:disabled) { background: var(--color-border); }
.pg-btn:disabled { opacity: .35; cursor: default; }
.pg-info { font-size: 12px; font-weight: 600; color: var(--color-text-primary); padding: 0 4px; }
.pg-sep  { flex: 1; }
.pg-count { font-size: 11px; color: var(--color-text-muted); }
</style>
