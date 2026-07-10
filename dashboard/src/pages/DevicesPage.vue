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
                </div>
              </td>
            </tr>

            <!-- Inline detail expansion -->
            <tr v-if="expandedId === d.id" class="expand-row">
              <td colspan="7" :class="['expand-cell', isOnline(d) ? 'border-online' : d.status === 'pending' ? 'border-pending' : 'border-offline']">

                <!-- Identity header -->
                <div class="ddev-header">
                  <div>
                    <div class="ddev-hostname mono">{{ d.hostname ?? 'Unknown device' }}</div>
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
                </div>

                <!-- Management toolbar -->
                <div class="ddev-toolbar" @click.stop>
                  <!-- Left: management actions -->
                  <button class="toolbar-btn toolbar-btn-dim" title="Requires RustDesk integration — not yet configured" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
                    </svg>
                    Remote Session
                  </button>
                  <div class="toolbar-sep"></div>
                  <button class="toolbar-btn" :disabled="d.status !== 'approved'" @click="openQuickJob(d)"
                    :title="d.status !== 'approved' ? 'Device must be approved to receive commands' : ''">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    Quick Job
                  </button>

                  <!-- Right: status actions + kebab -->
                  <div style="flex:1"></div>

                  <div v-if="jobQueued === d.id" class="toolbar-success">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Queued — runs on next check-in
                  </div>

                  <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                  <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                  <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>

                  <!-- Kebab menu -->
                  <div class="kebab-wrap">
                    <button class="toolbar-btn toolbar-btn-icon" @click="toggleMenu(d.id)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>
                    <div v-if="menuDeviceId === d.id" class="kebab-dropdown">
                      <button class="kebab-item" :disabled="d.status !== 'approved'" @click="scheduleReboot(d)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
                        </svg>
                        Schedule Reboot
                      </button>
                      <button class="kebab-item kebab-item-dim" disabled>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        Maintenance Window
                        <span class="soon-tag">Soon</span>
                      </button>
                      <div class="kebab-sep"></div>
                      <button class="kebab-item kebab-item-danger" @click="remove(d.id)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                        Delete Device
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Detail grid -->
                <div class="ddev-grid">
                  <div class="ddev-section">
                    <div class="ddev-section-title">System</div>
                    <div class="ddev-row"><span class="ddev-label">Hostname</span><span class="mono text-sm">{{ d.hostname ?? '—' }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">OS</span><span class="text-sm">{{ osLabel(d) || '—' }}</span></div>
                    <div class="ddev-row">
                      <span class="ddev-label">Class</span>
                      <span class="text-sm">
                        {{ effectiveClass(d) ?? '—' }}
                        <span v-if="effectiveClass(d)" class="text-xs text-muted-2">({{ d.overrideClass ? 'manual' : 'auto' }})</span>
                      </span>
                    </div>
                    <div class="ddev-row"><span class="ddev-label">Agent</span><span class="mono text-sm">{{ d.agentVersion ?? '—' }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Device ID</span><span class="mono text-xs text-muted-2" style="user-select:all">{{ d.id }}</span></div>
                  </div>

                  <div class="ddev-section">
                    <div class="ddev-section-title">Activity</div>
                    <div class="ddev-row">
                      <span class="ddev-label">Last seen</span>
                      <span class="text-sm">{{ lastSeenLabel(d.lastSeen) }}<span v-if="d.lastSeen" class="text-xs text-muted-2"> · {{ absDate(d.lastSeen) }}</span></span>
                    </div>
                    <div class="ddev-row"><span class="ddev-label">Enrolled</span><span class="text-sm">{{ absDate(d.createdAt) }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Approved</span><span class="text-sm">{{ d.approvedAt ? absDate(d.approvedAt) : '—' }}</span></div>
                  </div>

                  <div v-if="inventoryOf(d)" class="ddev-section">
                    <div class="ddev-section-title">Hardware</div>
                    <div class="ddev-row"><span class="ddev-label">Uptime</span><span class="text-sm">{{ formatUptime(inventoryOf(d)!.uptime_seconds) }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Disk free</span><span class="text-sm">{{ formatBytes(inventoryOf(d)!.disk_free_bytes) }}</span></div>
                  </div>
                </div>

              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Quick Job modal -->
    <div v-if="quickJobDevice" class="modal-backdrop" @click.self="quickJobDevice = null">
      <div class="modal modal-lg">
        <div class="modal-head">
          <div>
            <div class="modal-title">Quick Job</div>
            <div class="text-xs text-muted-2" style="margin-top:2px">{{ quickJobDevice.hostname }} · runs on next check-in</div>
          </div>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Shell</label>
            <select v-model="quickJobForm.shell" class="qj-select">
              <option value="auto">Auto — detect from OS ({{ quickJobDevice.osType === 'windows' ? 'PowerShell' : 'Bash' }})</option>
              <option value="powershell">PowerShell (Windows)</option>
              <option value="bash">Bash (Linux / macOS)</option>
              <option value="sh">sh (POSIX)</option>
            </select>
          </div>
          <div class="field" style="margin-top:12px">
            <label>Script <span class="required">*</span></label>
            <textarea
              v-model="quickJobForm.script"
              placeholder="# Your script here…"
              rows="9"
              class="code-area"
              autofocus
            ></textarea>
          </div>
          <div class="field" style="margin-top:12px">
            <label>Timeout (seconds)</label>
            <input v-model="quickJobForm.timeout" type="number" min="1" placeholder="300 (5 min default)" style="max-width:200px" />
          </div>
          <div v-if="quickJobError" class="error-banner" style="margin-top:12px">{{ quickJobError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="quickJobDevice = null">Cancel</button>
          <button class="btn btn-primary" :disabled="quickJobBusy" @click="submitQuickJob">
            {{ quickJobBusy ? 'Queuing…' : 'Queue Job' }}
          </button>
        </div>
      </div>
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

// Toolbar state
const menuDeviceId  = ref<string | null>(null);
const jobQueued     = ref<string | null>(null);

// Quick Job modal
const quickJobDevice  = ref<Device | null>(null);
const quickJobForm    = ref({ shell: 'auto', script: '', timeout: '' });
const quickJobError   = ref('');
const quickJobBusy    = ref(false);

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
  menuDeviceId.value = null;
  expandedId.value = expandedId.value === id ? null : id;
}

function toggleMenu(id: string) {
  if (menuDeviceId.value === id) {
    menuDeviceId.value = null;
  } else {
    menuDeviceId.value = id;
    setTimeout(() => document.addEventListener('click', closeMenuOnce, { once: true }), 0);
  }
}

function closeMenuOnce() { menuDeviceId.value = null; }

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
  menuDeviceId.value = null;
  busy.value = id;
  try {
    await api.devices.delete(id);
    devices.value = devices.value.filter(x => x.id !== id);
    if (expandedId.value === id) expandedId.value = null;
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

function openQuickJob(d: Device) {
  quickJobDevice.value = d;
  quickJobForm.value = { shell: 'auto', script: '', timeout: '' };
  quickJobError.value = '';
}

async function submitQuickJob() {
  if (!quickJobDevice.value) return;
  if (!quickJobForm.value.script.trim()) { quickJobError.value = 'Script is required'; return; }
  quickJobBusy.value = true;
  quickJobError.value = '';
  const deviceId = quickJobDevice.value.id;
  try {
    await api.devices.commands.create(deviceId, {
      type: 'run_script',
      shell: quickJobForm.value.shell,
      script: quickJobForm.value.script.trim(),
      timeout_seconds: parseInt(quickJobForm.value.timeout) || undefined,
    });
    quickJobDevice.value = null;
    showJobQueued(deviceId);
  } catch (e: any) {
    quickJobError.value = e.message;
  } finally {
    quickJobBusy.value = false;
  }
}

async function scheduleReboot(d: Device) {
  menuDeviceId.value = null;
  try {
    await api.devices.commands.create(d.id, { type: 'reboot' });
    showJobQueued(d.id);
  } catch (e: any) {
    error.value = e.message;
  }
}

function showJobQueued(deviceId: string) {
  jobQueued.value = deviceId;
  setTimeout(() => { if (jobQueued.value === deviceId) jobQueued.value = null; }, 4000);
}

// ── Helpers ───────────────────────────────────────────────────
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
onUnmounted(() => { clearInterval(timer); document.removeEventListener('click', closeMenuOnce); });
</script>

<style scoped>
/* ── Tabs ── */
.tabs { display: flex; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text-muted-2); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }

/* ── Inline expansion ── */
.device-row-active td { background: rgba(78,126,247,.04); border-bottom: none; }
.expand-row td { padding: 0; }
.expand-cell { border-bottom: 1px solid var(--border); background: var(--bg); }
.border-online  { border-left: 3px solid var(--teal); }
.border-pending { border-left: 3px solid var(--amber); }
.border-offline { border-left: 3px solid var(--border-2); }

/* ── Identity header ── */
.ddev-header {
  padding: 12px 20px 10px;
  border-bottom: 1px solid var(--border);
}
.ddev-hostname { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.ddev-sub { display: flex; align-items: center; gap: 6px; }
.ddev-sep { color: var(--border-2); font-size: 12px; }
.pill-online  { font-size: 11px; font-weight: 600; color: var(--teal); }
.pill-offline { font-size: 11px; font-weight: 600; color: var(--muted); }

/* ── Management toolbar ── */
.ddev-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--r-btn);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font);
  cursor: pointer;
  transition: background .1s, border-color .1s, color .1s;
  white-space: nowrap;
}
.toolbar-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border-2); }
.toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.toolbar-btn-dim { opacity: .45; }
.toolbar-btn-dim:hover { opacity: .45; background: none; border-color: transparent; }
.toolbar-btn-icon { padding: 5px 8px; }
.toolbar-sep {
  width: 1px; height: 20px; background: var(--border-2);
  margin: 0 4px; flex-shrink: 0;
}
.toolbar-success {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--teal);
  font-weight: 500;
  padding: 0 8px;
}

/* ── Kebab menu ── */
.kebab-wrap { position: relative; }
.kebab-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
  min-width: 200px;
  z-index: 50;
  overflow: hidden;
  padding: 4px 0;
}
.kebab-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 14px;
  background: none;
  border: none;
  color: var(--text);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
  transition: background .1s;
}
.kebab-item:hover:not(:disabled) { background: var(--surface-2); }
.kebab-item:disabled { cursor: default; }
.kebab-item-dim { opacity: .45; }
.kebab-item-danger { color: var(--red); }
.kebab-item-danger:hover:not(:disabled) { background: rgba(232,86,106,.08); }
.kebab-sep { height: 1px; background: var(--border); margin: 4px 0; }
.soon-tag {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  background: var(--surface-2);
  color: var(--muted);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Detail grid ── */
.ddev-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.ddev-section { padding: 14px 20px; border-right: 1px solid var(--border); }
.ddev-section:last-child { border-right: none; }
.ddev-section-title {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 10px;
}
.ddev-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.ddev-label { font-size: 11px; color: var(--muted); min-width: 72px; flex-shrink: 0; }

/* ── Quick Job modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border-2); border-radius: 10px;
  width: 440px; box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden;
  max-height: 90vh; display: flex; flex-direction: column;
}
.modal-lg { width: 620px; }
.modal-head { padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.required { color: var(--red); }

.qj-select {
  width: 100%;
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 8px 11px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7094' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; padding-right: 30px;
  cursor: pointer; transition: border-color .12s;
}
.qj-select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); outline: none; }
.qj-select option { background: #1c1f2e; color: var(--text); }

.code-area {
  width: 100%;
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 10px 12px; color: var(--text); font-size: 12px; font-family: var(--mono);
  resize: vertical; outline: none; transition: border-color .12s; line-height: 1.6;
}
.code-area:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }
</style>
