<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="section-card">
      <!-- Class filter bar -->
      <div class="class-bar">
        <button
          v-for="ct in classTabs"
          :key="ct.value"
          class="class-tab"
          :class="{ active: classTab === ct.value }"
          @click="classTab = ct.value"
        >
          <span class="class-tab-label">{{ ct.label }}</span>
          <span class="class-tab-count">{{ classCountFor(ct.value) }}</span>
        </button>
        <div class="class-bar-actions">
          <div class="tabs" style="border:none;margin:0;gap:4px">
            <button
              v-for="tab in statusTabs"
              :key="tab.value"
              class="tab tab-sm"
              :class="{ active: activeTab === tab.value }"
              @click="setStatusTab(tab.value)"
            >{{ tab.label }}<span class="tab-count">{{ countFor(tab.value) }}</span></button>
          </div>
          <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
        </div>
      </div>
      <div class="section-card-head" style="padding:8px 16px;border-top:1px solid var(--border);border-bottom:none" v-if="activeCompany">
        <span class="text-xs text-muted-2">Filtered by company: <strong>{{ tenants.find(t => t.id === activeCompany)?.name ?? activeCompany }}</strong></span>
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
            <th>Company</th>
            <th>OS</th>
            <th>Class</th>
            <th>Agent</th>
            <th>Last Seen</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in visibleDevices" :key="d.id"
            class="device-row"
            style="cursor:pointer"
            @click="router.push('/devices/' + d.id)"
          >
            <td>
              <span :class="['status-dot', isOnline(d) ? 'dot-online' : d.status === 'pending' ? 'dot-pending' : 'dot-offline']"></span>
              <span class="mono text-sm">{{ d.hostname ?? '—' }}</span>
            </td>
            <td class="text-muted-2 text-sm">{{ d.tenantName ?? '—' }}</td>
            <td class="text-muted-2 text-sm">{{ osShortLabel(d) }}</td>
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
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Device, type Tenant } from '../api';

const route      = useRoute();
const router     = useRouter();
const devices    = ref<Device[]>([]);
const tenants    = ref<Tenant[]>([]);
const loading    = ref(true);
const error      = ref('');
const busy       = ref<string | null>(null);
const activeTab  = computed(() => (route.query.status as string | undefined) ?? 'all');
const classTab   = ref<'all' | 'server' | 'workstation' | 'network'>('all');

const activeCompany = computed(() => route.query.company as string | undefined);
const searchQuery   = computed(() => ((route.query.search as string) ?? '').toLowerCase().trim());

const statusTabs = [
  { label: 'All',      value: 'all'      as const },
  { label: 'Pending',  value: 'pending'  as const },
  { label: 'Approved', value: 'approved' as const },
  { label: 'Revoked',  value: 'revoked'  as const },
];

const classTabs = [
  { label: 'All',          value: 'all'         as const },
  { label: 'Servers',      value: 'server'       as const },
  { label: 'Workstations', value: 'workstation'  as const },
  { label: 'Network',      value: 'network'      as const },
];

const now = ref(Math.floor(Date.now() / 1000));

const companyDevices = computed(() =>
  activeCompany.value ? devices.value.filter(d => d.tenantId === activeCompany.value) : devices.value
);

const visibleDevices = computed(() => {
  let list = companyDevices.value;
  if (activeTab.value !== 'all')  list = list.filter(d => d.status === activeTab.value);
  if (classTab.value !== 'all')   list = list.filter(d => (d.detectedClass ?? d.overrideClass) === classTab.value);
  if (searchQuery.value) {
    const q = searchQuery.value;
    list = list.filter(d =>
      (d.hostname ?? '').toLowerCase().includes(q) ||
      (d.tenantName ?? '').toLowerCase().includes(q)
    );
  }
  return list;
});

function setStatusTab(val: string) {
  const q: Record<string, string> = {};
  if (activeCompany.value) q.company = activeCompany.value;
  if (searchQuery.value)   q.search  = searchQuery.value;
  if (val !== 'all')       q.status  = val;
  router.push({ path: '/devices', query: q });
}

function countFor(tab: typeof activeTab.value) {
  const base = companyDevices.value;
  return tab === 'all' ? base.length : base.filter(d => d.status === tab).length;
}

function classCountFor(cls: typeof classTab.value) {
  const base = activeTab.value === 'all' ? companyDevices.value : companyDevices.value.filter(d => d.status === activeTab.value);
  return cls === 'all' ? base.length : base.filter(d => (d.detectedClass ?? d.overrideClass) === cls).length;
}

watch(activeCompany, () => { classTab.value = 'all'; });

function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}

async function load() {
  now.value = Math.floor(Date.now() / 1000);
  loading.value = devices.value.length === 0;
  error.value = '';
  try {
    const [devList, tenantList] = await Promise.all([
      api.devices.list(),
      tenants.value.length ? Promise.resolve(tenants.value) : api.tenants.list(),
    ]);
    devices.value = devList;
    tenants.value = tenantList;
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
    notifyPendingChanged();
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

async function revoke(id: string) {
  busy.value = id;
  try {
    await api.devices.revoke(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'revoked';
    notifyPendingChanged();
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

// Sidebar's pendingCount badge lives in App.vue (mounted once per page load,
// polled every 30s) — dispatch this so it refreshes immediately after an
// action taken here, instead of waiting for the next poll tick.
function notifyPendingChanged() {
  window.dispatchEvent(new Event('beacon:pending-changed'));
}

// ── Helpers ───────────────────────────────────────────────────
function effectiveClass(d: Device) { return d.overrideClass ?? d.detectedClass; }

function osShortLabel(d: Device) {
  if (!d.osType) return '—';
  const raw = d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
  // "windows Microsoft Windows 11 Home 10.0.26200.8655 Build 26200.8655"
  // → "Windows 11 Home"
  const m = raw.match(/Windows\s+\d+\s+\w+/i);
  if (m) return m[0];
  // Linux: "linux Ubuntu 22.04.3 LTS" → "Ubuntu 22.04.3 LTS"
  const linuxM = raw.match(/^linux\s+(.+?)(?:\s+\d+\.\d+\.\d+-.*)?$/i);
  if (linuxM) return linuxM[1];
  return raw;
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
onUnmounted(() => { clearInterval(timer); });
</script>

<style scoped>
/* ── Tabs ── */
.tabs { display: flex; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text-muted-2); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab.tab-sm { height: 32px; padding: 0 10px; font-size: 11px; }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }

/* ── Class filter bar ── */
.class-bar { display: flex; align-items: stretch; border-bottom: 1px solid var(--border); }
.class-tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 12px 24px; border: none; border-right: 1px solid var(--border); border-bottom: 3px solid transparent; background: none; cursor: pointer; transition: background .12s, border-color .12s; min-width: 100px; }
.class-tab:hover { background: var(--surface-2); }
.class-tab.active { border-bottom-color: var(--accent); background: var(--surface-2); }
.class-tab-label { font-size: 11px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.class-tab.active .class-tab-label { color: var(--accent); }
.class-tab-count { font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1; }
.class-bar-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
</style>
