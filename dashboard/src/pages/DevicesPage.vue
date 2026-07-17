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

      <!-- Bulk action bar -->
      <div v-if="selectedCount > 0" class="bulk-bar">
        <span class="bulk-count">{{ selectedCount }} device{{ selectedCount === 1 ? '' : 's' }} selected</span>
        <div class="bulk-actions">
          <button class="btn btn-ghost btn-sm" @click="openRebootModal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
            Schedule Reboot
          </button>
          <button class="btn btn-ghost btn-sm" @click="bulkAudit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            Request Audit
          </button>
          <button class="btn btn-ghost btn-sm" @click="openMaintenanceModal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Set Maintenance
          </button>
          <button class="btn btn-ghost btn-sm" @click="bulkEndMaintenance">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="9"/>
            </svg>
            End Maintenance
          </button>
          <button class="btn btn-ghost btn-sm" @click="clearSelection">Uncheck All</button>
        </div>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visibleDevices.length === 0" class="empty">
        <div class="empty-title">No {{ activeTab === 'all' ? '' : activeTab }} devices</div>
        <p class="empty-sub" v-if="activeTab === 'pending'">Devices appear here after enrolling with a token.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th class="col-check">
              <input type="checkbox" :checked="allVisibleSelected" :indeterminate="someSelected" @change="toggleSelectAll" />
            </th>
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
            :class="{ 'row-selected': selected[d.id], 'row-maintenance': isInMaintenance(d) }"
            style="cursor:pointer"
            @click="router.push('/devices/' + d.id)"
          >
            <td class="col-check" @click.stop>
              <input type="checkbox" :checked="!!selected[d.id]" @change="toggleSelect(d.id)" />
            </td>
            <td>
              <span :class="['status-dot', isOnline(d) ? 'dot-online' : d.status === 'pending' ? 'dot-pending' : 'dot-offline']"></span>
              <span class="mono text-sm">{{ d.hostname ?? '—' }}</span>
              <span v-if="isInMaintenance(d)" class="maint-badge" :title="`Maintenance until ${maintenanceLabel(d)}`">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </span>
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

    <!-- Maintenance mode modal -->
    <div v-if="maintModal" class="modal-backdrop" @click.self="maintModal = false">
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <span class="modal-title">Create a maintenance mode window</span>
          <button class="btn-icon" @click="maintModal = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="maint-device-list text-sm text-muted-2">
            Schedule a maintenance mode window on the following {{ selectedCount }} device{{ selectedCount === 1 ? '' : 's' }}:
            <span v-for="(id, i) in selectedIds" :key="id">
              <RouterLink :to="'/devices/' + id" class="maint-device-link">{{ deviceName(id) }}</RouterLink>{{ i < selectedIds.length - 1 ? ', ' : '' }}
            </span>
          </p>

          <label class="field-label" style="margin-top:16px">Enter a reason</label>
          <textarea v-model="maintReason" class="field-input maint-reason" rows="3" placeholder="Optional reason..."></textarea>

          <label class="field-label" style="margin-top:16px">Choose a duration</label>
          <div class="maint-duration-opts">
            <label class="maint-radio">
              <input type="radio" v-model="maintDurationType" value="hours" />
              <span>For the next</span>
              <input type="number" v-model.number="maintHours" min="1" max="168" class="maint-hours-input" :disabled="maintDurationType !== 'hours'" />
              <span>hours</span>
            </label>
            <label class="maint-radio">
              <input type="radio" v-model="maintDurationType" value="until" />
              <span>Until selected date and time</span>
            </label>
            <input v-if="maintDurationType === 'until'" type="datetime-local" v-model="maintUntil" class="field-input" style="margin-top:6px;margin-left:20px;width:220px" />
          </div>

          <p class="maint-hint">This prevents alerts being created for the device(s) for the duration that maintenance mode is active.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="maintModal = false">Cancel</button>
          <button class="btn btn-primary" :disabled="maintBusy" @click="submitMaintenance">
            {{ maintBusy ? 'Setting…' : 'OK' }}
          </button>
        </div>
      </div>
    </div>
    <!-- Reboot devices modal -->
    <div v-if="rebootModal" class="modal-backdrop" @click.self="rebootModal = false">
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <span class="modal-title">Reboot Devices</span>
          <button class="btn-icon" @click="rebootModal = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <select v-model="rebootTiming" class="field-input">
            <option value="immediate">Immediately</option>
            <option value="scheduled">At selected date and time</option>
          </select>

          <template v-if="rebootTiming === 'scheduled'">
            <p class="reboot-hint">This reboot will run once at the date/time indicated.</p>
            <label class="field-label" style="margin-top:14px">Start date and execution time</label>
            <input type="datetime-local" v-model="rebootScheduledAt" class="field-input" style="margin-top:6px;width:auto" />
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="rebootModal = false">Cancel</button>
          <button class="btn btn-primary" :disabled="rebootBusy || (rebootTiming === 'scheduled' && !rebootScheduledAt)" @click="submitReboot">
            {{ rebootBusy ? 'Sending…' : 'Reboot' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
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

// ── Multi-select ──────────────────────────────────────────────
const selected = reactive<Record<string, boolean>>({});

const selectedCount    = computed(() => Object.keys(selected).length);
const selectedIds      = computed(() => Object.keys(selected));
const allVisibleSelected = computed(() =>
  visibleDevices.value.length > 0 && visibleDevices.value.every(d => selected[d.id])
);
const someSelected = computed(() =>
  visibleDevices.value.some(d => selected[d.id]) && !allVisibleSelected.value
);

function toggleSelect(id: string) {
  if (selected[id]) delete selected[id];
  else selected[id] = true;
}

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    visibleDevices.value.forEach(d => delete selected[d.id]);
  } else {
    visibleDevices.value.forEach(d => { selected[d.id] = true; });
  }
}

function clearSelection() {
  Object.keys(selected).forEach(k => delete selected[k]);
}

function deviceName(id: string) {
  return devices.value.find(d => d.id === id)?.hostname ?? id;
}

// ── Maintenance modal ─────────────────────────────────────────
const maintModal        = ref(false);
const maintReason       = ref('');
const maintDurationType = ref<'hours' | 'until'>('hours');
const maintHours        = ref(1);
const maintUntil        = ref('');
const maintBusy         = ref(false);

function openMaintenanceModal() {
  maintReason.value = '';
  maintDurationType.value = 'hours';
  maintHours.value = 1;
  maintUntil.value = '';
  maintModal.value = true;
}

async function submitMaintenance() {
  let endsAt: number;
  if (maintDurationType.value === 'hours') {
    endsAt = Math.floor(Date.now() / 1000) + maintHours.value * 3600;
  } else {
    if (!maintUntil.value) return;
    endsAt = Math.floor(new Date(maintUntil.value).getTime() / 1000);
  }
  maintBusy.value = true;
  try {
    await Promise.all(
      selectedIds.value.map(id =>
        api.devices.maintenance.set(id, { ends_at: endsAt, reason: maintReason.value || undefined })
      )
    );
    // Update local state so the moon badges appear immediately
    selectedIds.value.forEach(id => {
      const d = devices.value.find(x => x.id === id);
      if (d) { d.maintenanceEndsAt = endsAt; d.maintenanceReason = maintReason.value || null; }
    });
    maintModal.value = false;
    clearSelection();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    maintBusy.value = false;
  }
}

async function bulkEndMaintenance() {
  try {
    await Promise.all(selectedIds.value.map(id => api.devices.maintenance.end(id)));
    selectedIds.value.forEach(id => {
      const d = devices.value.find(x => x.id === id);
      if (d) { d.maintenanceEndsAt = null; d.maintenanceReason = null; }
    });
    clearSelection();
  } catch (e: any) {
    error.value = e.message;
  }
}

// ── Reboot modal ──────────────────────────────────────────────
const rebootModal     = ref(false);
const rebootTiming    = ref<'immediate' | 'scheduled'>('immediate');
const rebootScheduledAt = ref('');
const rebootBusy      = ref(false);

function openRebootModal() {
  rebootTiming.value = 'immediate';
  rebootScheduledAt.value = '';
  rebootModal.value = true;
}

async function submitReboot() {
  rebootBusy.value = true;
  try {
    const isScheduled = rebootTiming.value === 'scheduled';
    const scheduledAt = isScheduled ? Math.floor(new Date(rebootScheduledAt.value).getTime() / 1000) : undefined;

    // Group by OS so the right shell/script is used per device
    const winIds  = selectedIds.value.filter(id => devices.value.find(d => d.id === id)?.osType === 'windows');
    const unixIds = selectedIds.value.filter(id => devices.value.find(d => d.id === id)?.osType !== 'windows');
    const jobRequests = [];
    if (winIds.length) {
      jobRequests.push(api.jobs.create({
        name: 'Reboot', type: isScheduled ? 'scheduled' : 'quick',
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
        target_type: 'devices', target_ids: winIds,
        components: [{ type: 'inline', shell: 'powershell', script: 'shutdown /r /t 10', timeout_seconds: 30, order: 0 }],
      }));
    }
    if (unixIds.length) {
      jobRequests.push(api.jobs.create({
        name: 'Reboot', type: isScheduled ? 'scheduled' : 'quick',
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
        target_type: 'devices', target_ids: unixIds,
        components: [{ type: 'inline', shell: 'bash', script: '(sleep 5; reboot) &', timeout_seconds: 30, order: 0 }],
      }));
    }
    await Promise.all(jobRequests);
    rebootModal.value = false;
    clearSelection();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    rebootBusy.value = false;
  }
}

async function bulkAudit() {
  try {
    await Promise.all(
      selectedIds.value.map(id => api.devices.commands.create(id, { type: 'run_audit' }))
    );
    clearSelection();
  } catch (e: any) {
    error.value = e.message;
  }
}

// ── Filters / tabs ────────────────────────────────────────────
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

// Clear selection when visible set changes
watch(visibleDevices, () => { clearSelection(); });

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

// ── Helpers ───────────────────────────────────────────────────
function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}

function isInMaintenance(d: Device) {
  return d.maintenanceEndsAt != null && d.maintenanceEndsAt > now.value;
}

function maintenanceLabel(d: Device) {
  if (!d.maintenanceEndsAt) return '';
  return new Date(d.maintenanceEndsAt * 1000).toLocaleString();
}

function effectiveClass(d: Device) { return d.overrideClass ?? d.detectedClass; }

function osShortLabel(d: Device) {
  if (!d.osType) return '—';
  const raw = d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
  const m = raw.match(/Windows\s+\d+\s+\w+/i);
  if (m) return m[0];
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

// ── Data loading ──────────────────────────────────────────────
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

function notifyPendingChanged() {
  window.dispatchEvent(new Event('beacon:pending-changed'));
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

/* ── Bulk action bar ── */
.bulk-bar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--accent-subtle, color-mix(in srgb, var(--accent) 8%, transparent)); border-bottom: 1px solid var(--border); }
.bulk-count { font-size: 13px; font-weight: 600; color: var(--accent); white-space: nowrap; }
.bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── Checkbox column ── */
.col-check { width: 36px; padding-left: 12px !important; }
.col-check input[type=checkbox] { cursor: pointer; width: 14px; height: 14px; }
tr.row-selected td { background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
tr.row-maintenance td { background: color-mix(in srgb, #7c3aed 5%, var(--surface)); }
tr.row-selected.row-maintenance td { background: color-mix(in srgb, var(--accent) 6%, color-mix(in srgb, #7c3aed 5%, var(--surface))); }

/* ── Maintenance badge ── */
.maint-badge { display: inline-flex; align-items: center; color: #7c3aed; margin-left: 5px; opacity: .85; }

/* ── Maintenance modal ── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.4); display: flex; flex-direction: column; max-height: 90vh; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-title { font-size: 15px; font-weight: 600; }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--border); }
.btn-icon { background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.btn-icon:hover { background: var(--surface-2); color: var(--text); }

.maint-device-list { line-height: 1.6; }
.maint-device-link { color: var(--accent); text-decoration: none; }
.maint-device-link:hover { text-decoration: underline; }

.maint-reason { width: 100%; min-height: 80px; resize: vertical; }

.maint-duration-opts { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.maint-radio { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.maint-radio input[type=radio] { cursor: pointer; }
.maint-hours-input { width: 60px; text-align: center; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text); font-size: 13px; }
.maint-hours-input:disabled { opacity: .4; }

.maint-hint { font-size: 12px; color: var(--muted); margin-top: 16px; line-height: 1.5; padding: 10px; background: var(--surface-2); border-radius: 4px; border: 1px solid var(--border); }

.field-label { font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; display: block; }
.field-input { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font); }
.field-input:focus { outline: none; border-color: var(--accent); }
.reboot-hint { font-size: 12px; color: var(--muted); margin-top: 10px; }
</style>
