<template>
  <div class="gp-page">

    <!-- Page header -->
    <div class="gp-header">
      <h1 class="gp-title">Policies<span v-if="companyMode" class="gp-title-sub">for {{ companyName }}</span></h1>
      <div class="gp-header-actions">
        <button class="btn btn-primary btn-sm" @click="createPolicy">Create Policy</button>
      </div>
    </div>

    <!-- Tabs (hidden in company-context mode — that view merges both scopes) -->
    <div class="gp-tabs" v-if="!companyMode">
      <button :class="['gp-tab', { active: tab === 'global' }]" @click="switchTab('global')">
        Global <span class="tab-count">{{ globalPolicies.length }}</span>
      </button>
      <button :class="['gp-tab', { active: tab === 'company' }]" @click="switchTab('company')">
        Company <span class="tab-count">{{ companyPolicies.length }}</span>
      </button>
    </div>

    <div class="gp-content">

      <!-- Company filter -->
      <div v-if="tab === 'company' && !companyMode" class="gp-filter-bar">
        <span class="filter-label">Filter by Company</span>
        <input v-model="companyFilter" class="filter-input" placeholder="Enter company name…" />
      </div>

      <!-- Toolbar -->
      <div class="gp-toolbar">
        <span class="row-count-label">Policies <span class="row-count-badge">{{ displayedPolicies.length }}</span></span>
        <div class="toolbar-sep"></div>
        <button class="btn btn-ghost btn-xs" :disabled="selectedIds.size !== 1" @click="editSelected">Edit</button>
        <button class="btn btn-ghost btn-xs" :disabled="selectedIds.size === 0" @click="bulkDelete">Delete</button>
        <button v-if="canOverrideSelected" class="btn btn-ghost btn-xs" :disabled="selectedIds.size === 0" @click="openOverrideModal">Override</button>
        <span class="filter-status">Filtered by: {{ filterStatusLabel }}</span>
      </div>

      <!-- Loading -->
      <div v-if="loading || loadingCompany" class="gp-state">Loading…</div>

      <!-- Empty -->
      <div v-else-if="displayedPolicies.length === 0" class="gp-state">
        No policies found.
      </div>

      <!-- Table -->
      <div v-else class="table-wrap">
        <table class="policy-table">
          <thead>
            <tr>
              <th class="col-check">
                <input ref="headerCbRef" type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              </th>
              <th class="col-name">Name</th>
              <th class="col-targets">Targets</th>
              <th class="col-scope">Scope</th>
              <th v-if="tab === 'company' && !companyMode" class="col-company">Sites</th>
              <th class="col-monitors">Monitors</th>
              <th class="col-created">Created</th>
              <th class="col-enabled">Enabled</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="policy in displayedPolicies" :key="policy.id">
              <tr :class="['policy-row', { selected: selectedIds.has(policy.id), 'row-open': expanded[policy.id] }]"
                  @click="toggleExpand(policy.id)">
                <td class="col-check" @click.stop>
                  <input type="checkbox" :checked="selectedIds.has(policy.id)" @change="toggleSelect(policy.id)" />
                </td>
                <td class="col-name">
                  <span class="policy-link">{{ policy.name }}</span>
                  <div v-if="policy.description" class="policy-desc">{{ policy.description }}</div>
                </td>
                <td class="col-targets">{{ targetSummary(policy) }}</td>
                <td class="col-scope">
                  <span :class="['scope-badge', 'scope-' + policy.scope]">{{ capitalize(policy.scope) }}</span>
                </td>
                <td v-if="tab === 'company' && !companyMode" class="col-company">{{ siteSummary(policy) }}</td>
                <td class="col-monitors">
                  <span class="monitor-count-badge">{{ policy.monitors.length }}</span>
                </td>
                <td class="col-created">{{ formatDate(policy.createdAt) }}</td>
                <td class="col-enabled" @click.stop>
                  <button :class="['toggle-btn', { enabled: policy.enabled }]" @click="togglePolicy(policy)">
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                  </button>
                </td>
              </tr>

              <!-- Expanded monitors panel -->
              <tr v-if="expanded[policy.id]" class="expand-row">
                <td :colspan="(tab === 'company' && !companyMode) ? 8 : 7" class="expand-cell">
                  <div class="expand-panel">
                    <div class="expand-panel-header">
                      <span class="expand-panel-title">Monitors</span>
                      <div class="expand-panel-actions">
                        <button class="btn btn-ghost btn-xs" @click="router.push('/global/policies/' + policy.id)">Edit Policy</button>
                        <button class="btn btn-ghost btn-xs danger" @click="deletePolicy(policy)">Delete Policy</button>
                      </div>
                    </div>
                    <div v-if="!policy.monitors.length" class="expand-empty">No monitors configured.</div>
                    <table v-else class="monitor-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Condition</th>
                          <th>Priority</th>
                          <th>Sustained</th>
                          <th>Auto-resolve</th>
                          <th>Enabled</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="m in policy.monitors" :key="m.id" class="monitor-row">
                          <td><span :class="['check-chip', 'chip-' + m.checkType]">{{ checkLabel(m.checkType) }}</span></td>
                          <td class="monitor-config-cell">{{ monitorSummary(m) }}</td>
                          <td><span :class="['pri-badge', 'pri-' + m.alertPriority]">{{ capitalize(m.alertPriority) }}</span></td>
                          <td class="tab-nums">{{ m.sustainedMinutes }}m</td>
                          <td class="tab-nums">{{ m.autoResolve ? m.autoResolveAfterMinutes + 'm' : '—' }}</td>
                          <td>
                            <button :class="['toggle-btn', 'toggle-sm', { enabled: m.enabled }]" @click="toggleMonitor(policy, m)">
                              <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── OVERRIDE MODAL ──────────────────────────────────────────────────────── -->
    <Teleport to="body">
    <div v-if="overrideModal.open" class="modal-backdrop" @click.self="overrideModal.open = false">
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <span class="modal-title">Create Company Override</span>
          <button class="btn-icon" @click="overrideModal.open = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label">Target Company</label>
            <select v-model="overrideModal.companyId" class="field-input">
              <option value="">Select a company…</option>
              <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <p class="override-hint">
            Creates a company-scoped copy of the {{ selectedIds.size }} selected {{ selectedIds.size === 1 ? 'policy' : 'policies' }},
            including all monitors. Customize without affecting global defaults.
          </p>
          <div v-if="overrideModal.error" class="error-msg">{{ overrideModal.error }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" @click="overrideModal.open = false">Cancel</button>
          <button class="btn btn-primary btn-sm"
            :disabled="!overrideModal.companyId || overrideModal.saving"
            @click="doOverride">
            {{ overrideModal.saving ? 'Creating…' : 'Create Override' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>


  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Policy, type PolicyMonitor, type CheckType, type Tenant } from '../api';

const route  = useRoute();
const router = useRouter();

const tab             = ref<'global' | 'company'>('global');
const loading         = ref(true);
const loadingCompany  = ref(false);
const globalPolicies  = ref<Policy[]>([]);
const companyPolicies = ref<Policy[]>([]);
const tenants         = ref<Tenant[]>([]);
const expanded        = reactive<Record<string, boolean>>({});
const selectedIds     = ref(new Set<string>());
const companyFilter   = ref('');
const headerCbRef     = ref<HTMLInputElement | null>(null);

// ── Computed ──────────────────────────────────────────────────────────────────

// Arriving from a company's sidebar context ("Acme" → Policies) — show a
// single merged view (all global policies + this company's overrides)
// instead of forcing a tab pick that hides whichever scope isn't selected.
// Global policies apply to every company regardless of scope, so hiding
// them behind a tab switch was actively misleading here.
const companyMode    = computed(() => !!route.query.company);
const companyIdParam = computed(() => route.query.company as string | undefined);
const companyName    = computed(() =>
  companyIdParam.value ? (tenants.value.find(t => t.id === companyIdParam.value)?.name ?? companyIdParam.value) : ''
);

const effectivePolicies = computed(() =>
  companyMode.value
    ? [...globalPolicies.value, ...companyPolicies.value.filter(p => (p.siteIds ?? []).includes(companyIdParam.value!))]
    : []
);

const displayedPolicies = computed(() => {
  if (companyMode.value) return effectivePolicies.value;
  if (tab.value === 'global') return globalPolicies.value;
  if (!companyFilter.value.trim()) return companyPolicies.value;
  const q = companyFilter.value.trim().toLowerCase();
  return companyPolicies.value.filter(p =>
    (p.siteIds ?? []).some(id => tenantName(id).toLowerCase().includes(q))
  );
});

// Override only makes sense for global policies (cloning a global default
// into a company-scoped copy) — in the merged company view, only allow it
// when every currently-selected row is actually global-scoped.
const canOverrideSelected = computed(() => {
  if (selectedIds.value.size === 0) return false;
  if (companyMode.value) {
    return [...selectedIds.value].every(id => globalPolicies.value.some(p => p.id === id));
  }
  return tab.value === 'global';
});

const allSelected = computed(() =>
  displayedPolicies.value.length > 0 &&
  displayedPolicies.value.every(p => selectedIds.value.has(p.id))
);

const someSelected = computed(() =>
  !allSelected.value && displayedPolicies.value.some(p => selectedIds.value.has(p.id))
);

const filterStatusLabel = computed(() => {
  if (companyMode.value) return companyName.value || 'Unfiltered';
  return tab.value === 'company' && companyFilter.value.trim() ? companyFilter.value.trim() : 'Unfiltered';
});

watch(someSelected, val => {
  if (headerCbRef.value) headerCbRef.value.indeterminate = val;
});

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true;
  try {
    const [globals, tenantList] = await Promise.all([
      api.policies.list({ scope: 'global' }),
      api.tenants.list(),
    ]);
    globalPolicies.value = globals;
    tenants.value        = tenantList;
  } catch {
    globalPolicies.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadCompanyPolicies() {
  loadingCompany.value = true;
  try {
    companyPolicies.value = await api.policies.list({ scope: 'company' });
  } catch {
    companyPolicies.value = [];
  } finally {
    loadingCompany.value = false;
  }
}

onMounted(async () => {
  await load();
  if (companyMode.value) await loadCompanyPolicies();
});

function createPolicy() {
  if (companyMode.value && companyIdParam.value) {
    router.push(`/global/policies/new?company_id=${companyIdParam.value}`);
  } else {
    router.push('/global/policies/new');
  }
}

function switchTab(t: 'global' | 'company') {
  tab.value = t;
  selectedIds.value = new Set();
  Object.keys(expanded).forEach(k => delete expanded[k]);
  if (t === 'company' && !companyPolicies.value.length && !loadingCompany.value) {
    loadCompanyPolicies();
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selectedIds.value = s;
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(displayedPolicies.value.map(p => p.id));
}

// ── Expand ────────────────────────────────────────────────────────────────────

function toggleExpand(id: string) {
  if (expanded[id]) delete expanded[id];
  else expanded[id] = true;
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

function editSelected() {
  if (selectedIds.value.size !== 1) return;
  const id = [...selectedIds.value][0];
  router.push('/global/policies/' + id);
}

async function bulkDelete() {
  const ids = [...selectedIds.value];
  if (!ids.length || !confirm(`Delete ${ids.length} ${ids.length === 1 ? 'policy' : 'policies'}?`)) return;
  try {
    await Promise.all(ids.map(id => api.policies.delete(id)));
    globalPolicies.value  = globalPolicies.value.filter(p => !ids.includes(p.id));
    companyPolicies.value = companyPolicies.value.filter(p => !ids.includes(p.id));
    const next = new Set(selectedIds.value);
    ids.forEach(id => { next.delete(id); delete expanded[id]; });
    selectedIds.value = next;
  } catch {}
}

// ── Toggle policy / monitor enabled ──────────────────────────────────────────

async function togglePolicy(policy: Policy) {
  try {
    await api.policies.update(policy.id, { enabled: !policy.enabled });
    policy.enabled = !policy.enabled;
  } catch {}
}

async function toggleMonitor(policy: Policy, m: PolicyMonitor) {
  try {
    await api.policies.monitors.update(policy.id, m.id, { enabled: !m.enabled });
    m.enabled = !m.enabled;
  } catch {}
}

// ── Override modal ────────────────────────────────────────────────────────────

const overrideModal = reactive({
  open:      false,
  companyId: '',
  saving:    false,
  error:     '',
});

function openOverrideModal() {
  overrideModal.companyId = companyMode.value ? (companyIdParam.value ?? '') : '';
  overrideModal.error     = '';
  overrideModal.open      = true;
}

async function doOverride() {
  if (!overrideModal.companyId) return;
  overrideModal.saving = true;
  overrideModal.error  = '';
  try {
    const ids = [...selectedIds.value];
    await Promise.all(
      ids.map(async id => {
        const src    = globalPolicies.value.find(p => p.id === id);
        const policy = await api.policies.create({
          name:       (src?.name ?? 'Policy') + ' (Override)',
          clone_from: id,
        });
        await api.policies.sites.add(policy.id, overrideModal.companyId);
      })
    );
    // Re-fetch rather than manually splice the local array -- the clones
    // just got a site added after creation, so the client's cached copy
    // would otherwise be missing siteIds until the next reload anyway.
    await loadCompanyPolicies();
    overrideModal.open = false;
    selectedIds.value  = new Set();
    if (!companyMode.value) switchTab('company');
  } catch (e: unknown) {
    overrideModal.error = e instanceof Error ? e.message : 'Failed to create overrides.';
  } finally {
    overrideModal.saving = false;
  }
}


async function deletePolicy(policy: Policy) {
  if (!confirm(`Delete policy "${policy.name}"?`)) return;
  try {
    await api.policies.delete(policy.id);
    globalPolicies.value  = globalPolicies.value.filter(p => p.id !== policy.id);
    companyPolicies.value = companyPolicies.value.filter(p => p.id !== policy.id);
    delete expanded[policy.id];
    const s = new Set(selectedIds.value); s.delete(policy.id); selectedIds.value = s;
  } catch {}
}


// ── Formatters ────────────────────────────────────────────────────────────────

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function parsedOs(raw: string):    string[] { try { return JSON.parse(raw) as string[]; } catch { return []; } }
function parsedClass(raw: string): string[] { try { return JSON.parse(raw) as string[]; } catch { return []; } }

function targetSummary(policy: Policy): string {
  const os  = parsedOs(policy.targetOs);
  const cls = parsedClass(policy.targetClass);
  const osStr  = os.length  === 3 ? 'All OS'      : os.map(capitalize).join(' / ');
  const clsStr = cls.length === 3 ? 'All Classes' : cls.map(capitalize).join(' / ');
  return `${osStr} · ${clsStr}`;
}

function siteSummary(policy: Policy): string {
  const ids = policy.siteIds ?? [];
  if (ids.length === 0) return '—';
  const names = ids.map(id => tenantName(id));
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function tenantName(id: string | null): string {
  if (!id) return '—';
  return tenants.value.find(t => t.id === id)?.name ?? id;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

function checkLabel(ct: CheckType): string {
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

function monitorSummary(m: PolicyMonitor): string {
  try {
    const cfg = JSON.parse(m.config) as Record<string, unknown>;
    switch (m.checkType) {
      case 'offline':      return (cfg.direction as string) === 'online'
        ? `online for ${m.sustainedMinutes}m`
        : `after ${Math.round((cfg.offline_after_seconds as number) / 60)}m offline`;
      case 'disk_space':   {
        const drive = (cfg.drive as string) === 'any' ? 'any drive' : (cfg.drive as string);
        const type  = (cfg.threshold_type as string) ?? 'gb_free';
        const value = cfg.threshold_value as number;
        const unit  = type === 'percent_used' ? '%' : ' GB';
        const cmp   = type === 'gb_free' ? '<' : type === 'percent_used' ? '≥' : '>';
        const label = type === 'gb_free' ? 'free' : 'used';
        return `${drive} ${cmp} ${value}${unit} ${label}`;
      }
      case 'cpu_usage':    return `≥ ${cfg.percent_max}% CPU`;
      case 'memory_usage': return `≥ ${cfg.percent_max}% memory`;
      case 'av_status': {
        const s = cfg.av_state as string;
        if (s === 'not_detected')          return 'AV: not detected';
        if (s === 'not_running')            return 'AV: not running';
        if (s === 'running_not_up_to_date') return 'AV: out of date';
        return `AV: ${s}`;
      }
      case 'file_size': {
        const cmp = (cfg.mode as string) === 'over' ? '>' : '<';
        return `${cfg.path} ${cmp} ${cfg.threshold_mb} MB`;
      }
      case 'ping': {
        const parts: string[] = [];
        if (cfg.check_unreachable) parts.push('unreachable');
        if (cfg.packet_loss_pct !== null && cfg.packet_loss_pct !== undefined) parts.push(`>${cfg.packet_loss_pct}% loss`);
        if (cfg.latency_ms !== null && cfg.latency_ms !== undefined) parts.push(`>${cfg.latency_ms}ms`);
        return `${cfg.target}: ${parts.join(', ') || 'no conditions set'}`;
      }
      case 'process': {
        const mode = cfg.mode as string;
        if (mode === 'running' || mode === 'stopped') return `${cfg.process_name} is ${mode}`;
        return `${cfg.process_name} ${mode} ≥ ${cfg.threshold_pct}%`;
      }
      case 'service': {
        const mode = cfg.mode as string;
        const delay = (cfg.boot_delay_minutes as number) > 0 ? ` (${cfg.boot_delay_minutes}m after boot)` : '';
        if (mode === 'running' || mode === 'stopped') return `${cfg.service_name} is ${mode}${delay}`;
        return `${cfg.service_name} ${mode} ≥ ${cfg.threshold_pct}%${delay}`;
      }
      case 'software': {
        const mode = cfg.mode as string;
        const verb = mode === 'installed' ? 'is installed' : mode === 'uninstalled' ? 'is uninstalled' : 'changes version';
        return `${cfg.name_pattern} ${verb}`;
      }
      default: return m.config;
    }
  } catch { return m.config; }
}
</script>

<style scoped>
.gp-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

/* ── Page header ── */
.gp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0 16px 0; flex-shrink: 0;
}
.gp-title { font-size: 20px; font-weight: 700; color: var(--text); margin: 0; }
.gp-title-sub { font-size: 14px; font-weight: 400; color: var(--muted-2); margin-left: 8px; }

/* ── Tabs ── */
.gp-tabs {
  display: flex; border-bottom: 1px solid var(--border);
  flex-shrink: 0; gap: 0;
}
.gp-tab {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--muted); cursor: pointer; transition: color .12s, border-color .12s;
  margin-bottom: -1px;
}
.gp-tab:hover  { color: var(--text); }
.gp-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.tab-count {
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 10px;
  background: rgba(78,126,247,.15); color: var(--accent);
}

/* ── Content area ── */
.gp-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; padding-top: 14px; }

/* ── Company filter ── */
.gp-filter-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 7px 7px 0 0; border-bottom: none; flex-shrink: 0;
}
.filter-label { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.filter-input {
  flex: 1; max-width: 340px; padding: 5px 10px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px;
  color: var(--text); font-size: 13px; font-family: var(--font); outline: none;
  transition: border-color .12s;
}
.filter-input:focus { border-color: var(--accent); }

/* ── Toolbar ── */
.gp-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: var(--surface); border: 1px solid var(--border);
  border-bottom: none; flex-shrink: 0;
}
.gp-filter-bar + .gp-toolbar { border-top: 1px solid var(--border); border-radius: 0; }
.gp-toolbar:not(:has(+ .table-wrap)) { border-radius: 0 0 7px 7px; }
.gp-toolbar:first-child { border-radius: 7px 7px 0 0; }
.row-count-label { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.row-count-badge {
  display: inline-block; margin-left: 5px; padding: 1px 6px; border-radius: 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: 11px; font-weight: 700; color: var(--text);
}
.toolbar-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
.filter-status { margin-left: auto; font-size: 11px; color: var(--muted); }

.btn-xs {
  padding: 3px 10px; font-size: 12px; font-family: var(--font); font-weight: 500;
  border-radius: 4px; cursor: pointer; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); transition: background .1s, color .1s, opacity .1s;
}
.btn-xs:hover:not(:disabled) { background: var(--border); }
.btn-xs:disabled { opacity: .38; cursor: default; }
.btn-xs.danger:hover:not(:disabled) { color: var(--red); border-color: var(--red); }

/* ── State ── */
.gp-state {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--muted); padding: 40px;
}

/* ── Table ── */
.table-wrap {
  flex: 1; overflow: auto;
  border: 1px solid var(--border); border-radius: 0 0 7px 7px;
}
.policy-table {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
.policy-table thead tr {
  background: var(--surface-2); position: sticky; top: 0; z-index: 1;
}
.policy-table th {
  padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600;
  color: var(--muted); text-transform: uppercase; letter-spacing: .04em;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
.col-check    { width: 40px;  padding-left: 14px !important; }
.col-name     { min-width: 180px; }
.col-targets  { width: 220px; }
.col-scope    { width: 90px; }
.col-company  { width: 160px; }
.col-monitors { width: 90px; text-align: center !important; }
.col-created  { width: 160px; }
.col-enabled  { width: 80px; text-align: center !important; }

.policy-row td {
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  color: var(--text); vertical-align: middle;
}
.policy-row:last-child td { border-bottom: none; }
.policy-row { cursor: pointer; }
.policy-row:hover td { background: rgba(255,255,255,.025); }
.policy-row.selected td { background: rgba(78,126,247,.07); }
.policy-row.row-open td { background: var(--surface-2); }
.policy-row.row-open td { border-bottom: none; }

.col-check td,
.col-check th { padding-left: 14px; }
.col-monitors td,
.col-enabled td { text-align: center; }

.policy-link {
  font-size: 13px; font-weight: 600; color: var(--accent);
}
.policy-row:hover .policy-link { text-decoration: underline; }
.policy-desc { font-size: 11px; color: var(--muted); margin-top: 2px; }

.scope-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.scope-global  { background: rgba(78,126,247,.14);  color: var(--accent); }
.scope-company { background: rgba(45,207,160,.14);  color: var(--teal); }

.monitor-count-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: 11px; font-weight: 700; color: var(--muted);
}

.col-created td { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* Toggle button */
.toggle-btn {
  background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0;
}
.toggle-track {
  display: block; width: 28px; height: 16px; border-radius: 8px;
  background: var(--border); position: relative; transition: background .15s;
}
.toggle-btn.enabled .toggle-track { background: var(--accent); }
.toggle-thumb {
  display: block; width: 12px; height: 12px; border-radius: 6px;
  background: #fff; position: absolute; top: 2px; left: 2px;
  transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3);
}
.toggle-btn.enabled .toggle-thumb { left: 14px; }
.toggle-btn.toggle-sm .toggle-track { width: 22px; height: 12px; border-radius: 6px; }
.toggle-btn.toggle-sm .toggle-thumb { width: 8px; height: 8px; }
.toggle-btn.toggle-sm.enabled .toggle-thumb { left: 12px; }

/* ── Expand row ── */
.expand-row td { border-bottom: 1px solid var(--border); padding: 0; }
.expand-cell { padding: 0 !important; }
.expand-panel {
  background: var(--surface-2); border-top: 1px solid var(--border);
  padding: 10px 14px 14px;
}
.expand-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.expand-panel-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.expand-panel-actions { display: flex; gap: 6px; }
.expand-empty { font-size: 12px; color: var(--muted); padding: 8px 0; }

/* Monitor nested table */
.monitor-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
  border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
}
.monitor-table th {
  padding: 6px 10px; text-align: left; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.monitor-row td {
  padding: 7px 10px; border-bottom: 1px solid var(--border);
  color: var(--text); vertical-align: middle;
}
.monitor-row:last-child td { border-bottom: none; }
.monitor-row:hover td { background: rgba(255,255,255,.02); }
.monitor-config-cell { color: var(--muted); font-size: 11px; }
.tab-nums { font-variant-numeric: tabular-nums; color: var(--muted); }
.monitor-row-actions { white-space: nowrap; text-align: right; }

.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; white-space: nowrap;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16);  color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12);   color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14);  color: var(--accent); }
.chip-av_status    { background: rgba(45,207,160,.14);  color: var(--teal); }
.chip-file_size    { background: rgba(132,134,168,.16);  color: var(--muted-2); }
.chip-ping         { background: rgba(45,207,160,.14);   color: var(--teal); }
.chip-process      { background: rgba(240,168,64,.16);   color: var(--amber); }
.chip-service      { background: rgba(200,80,180,.14);   color: #c850b4; }
.chip-software     { background: rgba(80,180,120,.14);   color: #50b478; }

.pri-badge {
  display: inline-block; padding: 1px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 700; white-space: nowrap;
}
.pri-critical { background: var(--red);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--amber); color: #1a1200; }
.pri-low      { background: var(--muted); color: var(--surface); }

.btn-text {
  background: none; border: none; padding: 2px 6px; font-size: 11px; font-family: var(--font);
  color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s;
}
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }

/* ── Modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  width: 440px; max-width: 95vw; box-shadow: 0 12px 40px rgba(0,0,0,.3);
  display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;
}
.modal-header {
  display: flex; align-items: center; padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.modal-title { flex: 1; font-weight: 600; font-size: 14px; }
.btn-icon {
  background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s;
}
.btn-icon:hover { background: var(--surface-2); color: var(--text); }
.modal-body {
  padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;
  overflow-y: auto; overflow-x: hidden;
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px 16px; border-top: 1px solid var(--border); flex-shrink: 0;
}

.override-hint { font-size: 12px; color: var(--muted); margin: 0; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 5px; }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; min-width: 0; }
.field-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .04em;
}
.field-input {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; width: 100%; box-sizing: border-box;
}
.field-input:focus { border-color: var(--accent); }
.field-input option { background: var(--surface); }
.field-input:disabled { opacity: .5; cursor: default; }

.input-row  { display: flex; align-items: center; gap: 8px; }
.input-unit { font-size: 13px; color: var(--muted); white-space: nowrap; }

.pill-group { display: flex; flex-wrap: wrap; gap: 6px; }
.pill-opt {
  display: inline-flex; align-items: center;
  padding: 5px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: var(--surface-2); font-size: 12px; font-weight: 500; color: var(--muted);
  cursor: pointer; user-select: none; text-transform: capitalize;
  transition: border-color .12s, background .12s, color .12s;
}
.pill-opt.active { border-color: var(--accent); background: rgba(78,126,247,.12); color: var(--accent); }
.pill-cb { display: none; }

.autoresolve-row {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  font-size: 13px; color: var(--text); width: 100%; box-sizing: border-box;
}
.autoresolve-row input[type="checkbox"] { flex-shrink: 0; accent-color: var(--accent); }
.autoresolve-row span { flex: 1; min-width: 0; }

.field-hint {
  font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.5;
}
.field-hint-warn {
  color: var(--amber);
  background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2);
  border-radius: 5px;
  padding: 6px 10px;
}

.error-msg { color: #e04040; font-size: 12px; }

.text-xs   { font-size: 11px; }
.text-muted { color: var(--muted); }
</style>
