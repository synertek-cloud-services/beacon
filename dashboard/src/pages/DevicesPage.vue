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
            @click="activeTab = tab.value; expandedId = null"
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
          <template v-for="d in visibleDevices" :key="d.id">
            <tr
              :class="['device-row', expandedId === d.id ? 'device-row-active' : '']"
              style="cursor:pointer"
              @click="toggleExpanded(d.id)"
            >
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
                <div class="actions" @click.stop>
                  <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                  <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                  <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>
                  <button v-if="d.status === 'revoked'"  class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="remove(d.id)">Delete</button>
                </div>
              </td>
            </tr>

            <!-- Inline detail expansion -->
            <tr v-if="expandedId === d.id" class="expand-row">
              <td colspan="7" :class="['expand-cell', isOnline(d) ? 'border-online' : d.status === 'pending' ? 'border-pending' : 'border-offline']">

                <!-- Header -->
                <div class="ddev-header">
                  <div>
                    <div class="ddev-hostname">{{ d.hostname ?? 'Unknown device' }}</div>
                    <div class="ddev-sub">
                      <span :class="isOnline(d) ? 'pill-online' : 'pill-offline'">
                        {{ isOnline(d) ? '● Online' : '● Offline' }}
                      </span>
                      <span class="ddev-sep">·</span>
                      <span class="text-xs text-muted-2">{{ d.status }}</span>
                      <template v-if="d.osType">
                        <span class="ddev-sep">·</span>
                        <span class="text-xs text-muted-2">{{ osLabel(d) }}</span>
                      </template>
                    </div>
                  </div>
                  <div class="ddev-actions" @click.stop>
                    <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                    <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                    <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>
                    <button v-if="d.status === 'revoked'"  class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="remove(d.id)">Delete</button>
                  </div>
                </div>

                <!-- Detail grid -->
                <div class="ddev-grid">
                  <!-- System -->
                  <div class="ddev-section">
                    <div class="ddev-section-title">System</div>
                    <div class="ddev-row">
                      <span class="ddev-label">Hostname</span>
                      <span class="mono text-sm">{{ d.hostname ?? '—' }}</span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">OS</span>
                      <span class="text-sm">{{ osLabel(d) || '—' }}</span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Class</span>
                      <span class="text-sm">
                        {{ effectiveClass(d) ?? '—' }}
                        <span v-if="effectiveClass(d)" class="text-xs text-muted-2">
                          ({{ d.overrideClass ? 'manual' : 'auto' }})
                        </span>
                      </span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Agent</span>
                      <span class="mono text-sm">{{ d.agentVersion ?? '—' }}</span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Device ID</span>
                      <span class="mono text-xs text-muted-2" style="user-select:all">{{ d.id }}</span>
                    </div>
                  </div>

                  <!-- Activity -->
                  <div class="ddev-section">
                    <div class="ddev-section-title">Activity</div>
                    <div class="ddev-row">
                      <span class="ddev-label">Last seen</span>
                      <span class="text-sm">
                        {{ lastSeenLabel(d.lastSeen) }}
                        <span v-if="d.lastSeen" class="text-xs text-muted-2"> · {{ absDate(d.lastSeen) }}</span>
                      </span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Enrolled</span>
                      <span class="text-sm">{{ absDate(d.createdAt) }}</span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Approved</span>
                      <span class="text-sm">{{ d.approvedAt ? absDate(d.approvedAt) : '—' }}</span>
                    </div>
                  </div>

                  <!-- Hardware (from inventory) -->
                  <div v-if="inventoryOf(d)" class="ddev-section">
                    <div class="ddev-section-title">Hardware</div>
                    <div class="ddev-row">
                      <span class="ddev-label">Uptime</span>
                      <span class="text-sm">{{ formatUptime(inventoryOf(d)!.uptime_seconds) }}</span>
                    </div>
                    <div class="ddev-row">
                      <span class="ddev-label">Disk free</span>
                      <span class="text-sm">{{ formatBytes(inventoryOf(d)!.disk_free_bytes) }}</span>
                    </div>
                  </div>
                </div>

              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type Device } from '../api';

interface Inventory {
  hostname: string;
  os_type: string;
  os_version: string;
  uptime_seconds: number;
  disk_free_bytes: number;
  detected_class: string;
}

const devices    = ref<Device[]>([]);
const loading    = ref(true);
const error      = ref('');
const busy       = ref<string | null>(null);
const activeTab  = ref<'all' | 'pending' | 'approved' | 'revoked'>('all');
const expandedId = ref<string | null>(null);

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

function toggleExpanded(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}

function inventoryOf(d: Device): Inventory | null {
  if (!d.inventory) return null;
  try { return JSON.parse(d.inventory) as Inventory; }
  catch { return null; }
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
    if (d) { d.status = 'approved'; d.approvedAt = now.value; }
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
    if (expandedId.value === id) expandedId.value = null;
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

function absDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
/* ── Tabs ── */
.tabs { display: flex; gap: 0; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; letter-spacing: .01em; }
.tab:hover { color: var(--text-muted-2); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }

/* ── Inline expansion ── */
.device-row-active td { background: rgba(78,126,247,.04); border-bottom: none; }
.expand-row td { padding: 0; }
.expand-cell {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.border-online  { border-left: 3px solid var(--teal); }
.border-pending { border-left: 3px solid var(--amber); }
.border-offline { border-left: 3px solid var(--border-2); }

/* ── Device detail ── */
.ddev-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.ddev-hostname {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--mono);
  color: var(--text);
  margin-bottom: 4px;
}
.ddev-sub {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ddev-sep { color: var(--border-2); font-size: 12px; }
.ddev-actions { display: flex; gap: 6px; flex-shrink: 0; }

.pill-online  { font-size: 11px; font-weight: 600; color: var(--teal); }
.pill-offline { font-size: 11px; font-weight: 600; color: var(--muted); }

.ddev-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0;
  padding: 0;
}
.ddev-section {
  padding: 14px 20px;
  border-right: 1px solid var(--border);
}
.ddev-section:last-child { border-right: none; }
.ddev-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
.ddev-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ddev-label {
  font-size: 11px;
  color: var(--muted);
  min-width: 72px;
  flex-shrink: 0;
}
</style>
