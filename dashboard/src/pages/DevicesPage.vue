<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="section-card">
      <div class="section-card-head">
        <div class="tabs" style="border:none;margin:0">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="tab"
            :class="{ active: activeTab === tab.value }"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
            <span class="tab-count">{{ countFor(tab.value) }}</span>
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visibleDevices.length === 0" class="empty">
        <div class="empty-title">No {{ activeTab === 'all' ? '' : activeTab }} devices</div>
        <p class="empty-sub" v-if="activeTab === 'pending'">Devices appear here after enrolling with a token.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>OS</th>
            <th>Class</th>
            <th>Agent</th>
            <th>Last Seen</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in visibleDevices" :key="d.id">
            <td>
              <span :class="['status-dot', isOnline(d) ? 'dot-online' : d.status === 'pending' ? 'dot-pending' : 'dot-offline']"></span>
              <span class="mono text-sm">{{ d.hostname ?? '—' }}</span>
            </td>
            <td class="text-muted-2 text-sm">{{ osLabel(d) }}</td>
            <td class="text-muted-2 text-sm">{{ effectiveClass(d) ?? '—' }}</td>
            <td class="mono text-xs text-muted-2">{{ d.agentVersion ?? '—' }}</td>
            <td class="text-muted-2 text-sm">{{ lastSeenLabel(d.lastSeen) }}</td>
            <td><span :class="`badge badge-${d.status}`">{{ d.status }}</span></td>
            <td>
              <div class="actions">
                <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>
                <button v-if="d.status === 'revoked'"  class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="remove(d.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type Device } from '../api';

const devices = ref<Device[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref<string | null>(null);
const activeTab = ref<'all' | 'pending' | 'approved' | 'revoked'>('all');

const tabs = [
  { label: 'All',      value: 'all'      as const },
  { label: 'Pending',  value: 'pending'  as const },
  { label: 'Approved', value: 'approved' as const },
  { label: 'Revoked',  value: 'revoked'  as const },
];

const now = ref(Math.floor(Date.now() / 1000));

const visibleDevices = computed(() =>
  activeTab.value === 'all' ? devices.value : devices.value.filter(d => d.status === activeTab.value)
);

function countFor(tab: typeof activeTab.value) {
  return tab === 'all' ? devices.value.length : devices.value.filter(d => d.status === tab).length;
}

function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}

async function load() {
  now.value = Math.floor(Date.now() / 1000);
  loading.value = devices.value.length === 0;
  error.value = '';
  try {
    devices.value = await api.devices.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function approve(id: string) {
  busy.value = id;
  try {
    await api.devices.approve(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'approved';
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

async function revoke(id: string) {
  busy.value = id;
  try {
    await api.devices.revoke(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'revoked';
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

async function remove(id: string) {
  busy.value = id;
  try {
    await api.devices.delete(id);
    devices.value = devices.value.filter(x => x.id !== id);
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

function effectiveClass(d: Device) { return d.overrideClass ?? d.detectedClass; }
function osLabel(d: Device) {
  if (!d.osType) return '—';
  return d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
}
function lastSeenLabel(ts: number | null) {
  if (!ts) return 'Never';
  const diff = now.value - ts;
  if (diff < 90)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.tabs { display: flex; gap: 0; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; letter-spacing: .01em; }
.tab:hover { color: var(--text-muted-2); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }
</style>
