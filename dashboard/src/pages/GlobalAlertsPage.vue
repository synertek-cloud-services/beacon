<template>
  <div class="ga-page">
    <div class="ga-toolbar">
      <div class="ga-filters">
        <button
          class="filter-btn"
          :class="{ active: showAll === false }"
          @click="showAll = false"
        >Active</button>
        <button
          class="filter-btn"
          :class="{ active: showAll === true }"
          @click="showAll = true"
        >All</button>
      </div>
      <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
    </div>

    <div v-if="loading" class="ga-empty text-muted">Loading…</div>

    <div v-else-if="!alerts.length" class="ga-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);margin-bottom:8px">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <div style="font-weight:500">{{ showAll ? 'No alerts found' : 'No active alerts' }}</div>
      <div class="text-muted text-xs" style="margin-top:4px">{{ showAll ? 'Monitor rules have not fired yet.' : 'All monitored devices are within thresholds.' }}</div>
    </div>

    <div v-else class="ga-table-wrap">
      <table class="ga-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Company</th>
            <th>Device</th>
            <th>Monitor</th>
            <th>Threshold</th>
            <th>Since</th>
            <th>Last Check</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in alerts" :key="a.id" :class="{ 'row-active': a.is_alerting === 1, 'row-resolved': a.is_alerting !== 1 }">
            <td>
              <span class="status-pill" :class="a.is_alerting === 1 ? 'pill-alert' : 'pill-ok'">
                {{ a.is_alerting === 1 ? 'Alerting' : 'Resolved' }}
              </span>
            </td>
            <td class="cell-company">{{ a.tenant_name }}</td>
            <td class="cell-device">
              <span class="hostname">{{ a.hostname ?? a.device_id }}</span>
              <span class="text-xs text-muted">{{ a.os_type }}</span>
            </td>
            <td>
              <span class="check-chip" :class="`chip-${a.check_type}`">{{ checkLabel(a.check_type) }}</span>
              <span v-if="a.definition_device_class" class="text-xs text-muted"> · {{ a.definition_device_class }}</span>
            </td>
            <td class="mono text-xs">{{ formatThreshold(a.check_type, a.threshold) }}</td>
            <td class="text-xs text-muted">{{ a.alerted_at ? formatAge(a.alerted_at) : '—' }}</td>
            <td class="text-xs text-muted">{{ formatAge(a.updated_at) }}</td>

          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { api, type AlertState, type CheckType } from '../api';

const alerts  = ref<AlertState[]>([]);
const loading = ref(true);
const showAll = ref(false);

async function load() {
  loading.value = true;
  try {
    alerts.value = await api.alerts.list(showAll.value ? 'all' : 'active');
  } catch {
    alerts.value = [];
  } finally {
    loading.value = false;
  }
}

watch(showAll, load);
onMounted(load);

function checkLabel(ct: CheckType): string {
  switch (ct) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Offline';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    default:             return ct;
  }
}

function formatThreshold(ct: CheckType, raw: string): string {
  try {
    const t = JSON.parse(raw) as Record<string, number>;
    switch (ct) {
      case 'disk_space':
        return `< ${(t.bytes_free_min / 1073741824).toFixed(0)} GB free`;
      case 'offline':
        return `> ${Math.round(t.offline_after_seconds / 60)} min offline`;
      case 'cpu_usage':
        return `> ${t.percent_max}% CPU`;
      case 'memory_usage':
        return `> ${t.percent_max}% memory`;
      default:
        return raw;
    }
  } catch {
    return raw;
  }
}

function formatAge(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
</script>

<style scoped>
.ga-page { display: flex; flex-direction: column; height: 100%; }

.ga-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
  flex-shrink: 0;
}
.ga-filters { display: flex; gap: 4px; }
.filter-btn {
  padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 5px;
  border: 1px solid var(--border); background: transparent; color: var(--muted);
  cursor: pointer; transition: background .1s, color .1s, border-color .1s;
}
.filter-btn:hover { background: var(--surface-2); color: var(--text); }
.filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.ga-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; color: var(--text);
}

.ga-table-wrap { flex: 1; overflow: auto; }
.ga-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ga-table th {
  text-align: left; padding: 6px 12px; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--muted);
  border-bottom: 1px solid var(--border); position: sticky; top: 0;
  background: var(--surface);
}
.ga-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.ga-table tr:last-child td { border-bottom: none; }
.ga-table tr.row-active:hover td { background: rgba(240,80,60,.04); }
.ga-table tr.row-resolved:hover td { background: var(--surface-2); }

.status-pill {
  display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
}
.pill-alert { background: rgba(240,80,60,.14); color: #e04040; }
.pill-ok    { background: rgba(50,200,100,.14); color: #28a864; }

.cell-company { font-weight: 500; }
.cell-device { display: flex; flex-direction: column; gap: 1px; }
.hostname { font-weight: 500; }

.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 600;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16); color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12); color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14); color: var(--accent); }

.mono { font-family: var(--font-mono, monospace); }
</style>
