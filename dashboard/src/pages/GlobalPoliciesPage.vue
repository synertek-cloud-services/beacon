<template>
  <div class="gp-page">

    <!-- Tab bar -->
    <div class="gp-tabs">
      <button class="gp-tab" :class="{ active: tab === 'global' }" @click="tab = 'global'">Global Policies</button>
      <button class="gp-tab" :class="{ active: tab === 'company' }" @click="tab = 'company'">Company Overrides</button>
    </div>

    <!-- ── GLOBAL TAB ──────────────────────────────────────────────────────── -->
    <div v-if="tab === 'global'" class="gp-content">
      <div class="gp-toolbar">
        <span class="gp-toolbar-label">{{ globalPolicies.length }} {{ globalPolicies.length === 1 ? 'policy' : 'policies' }}</span>
        <button class="btn btn-primary btn-sm" @click="openNewPolicy('global')">+ New Policy</button>
      </div>

      <div v-if="loading" class="gp-empty text-muted">Loading…</div>

      <div v-else-if="!globalPolicies.length" class="gp-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);margin-bottom:8px">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <div style="font-weight:500">No global policies yet</div>
        <div class="text-muted text-xs" style="margin-top:4px">Create a global policy to start monitoring all devices.</div>
      </div>

      <div v-else class="policy-list">
        <div v-for="policy in globalPolicies" :key="policy.id" class="policy-card">
          <!-- Policy header -->
          <div class="policy-header" @click="toggleExpand(policy.id)">
            <div class="policy-header-left">
              <button
                class="policy-toggle-btn"
                :class="{ enabled: policy.enabled }"
                @click.stop="togglePolicy(policy)"
                title="Toggle enabled"
              >
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </button>
              <div class="policy-info">
                <div class="policy-name">{{ policy.name }}</div>
                <div v-if="policy.description" class="policy-desc">{{ policy.description }}</div>
              </div>
            </div>
            <div class="policy-header-right">
              <div class="policy-meta">
                <span class="meta-chip" v-for="os in parsedOs(policy.targetOs)" :key="os">{{ os }}</span>
              </div>
              <div class="policy-meta">
                <span class="meta-chip class-chip" v-for="cls in parsedClass(policy.targetClass)" :key="cls">{{ cls }}</span>
              </div>
              <span class="monitor-count">{{ policy.monitors.length }} monitor{{ policy.monitors.length !== 1 ? 's' : '' }}</span>
              <svg class="expand-icon" :class="{ open: expanded.has(policy.id) }"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>

          <!-- Expanded monitor list -->
          <div v-if="expanded.has(policy.id)" class="policy-monitors">
            <div v-if="!policy.monitors.length" class="monitors-empty text-muted text-xs">
              No monitors — add one below.
            </div>
            <div v-for="m in policy.monitors" :key="m.id" class="monitor-row">
              <span class="check-chip" :class="`chip-${m.checkType}`">{{ checkLabel(m.checkType) }}</span>
              <span class="monitor-config">{{ monitorSummary(m) }}</span>
              <span class="pri-badge" :class="`pri-${m.alertPriority}`">{{ capitalize(m.alertPriority) }}</span>
              <span class="monitor-meta">{{ m.sustainedMinutes }}m sustained</span>
              <span class="monitor-meta">{{ m.autoResolve ? `auto-resolve ${m.autoResolveAfterMinutes}m` : 'manual resolve' }}</span>
              <div class="monitor-row-actions">
                <button class="btn-text" @click="openEditMonitor(policy, m)">Edit</button>
                <button class="btn-text danger" @click="deleteMonitor(policy, m)">Delete</button>
              </div>
            </div>
            <div class="monitors-footer">
              <button class="btn btn-ghost btn-sm" @click="openAddMonitor(policy)">+ Add Monitor</button>
              <div class="policy-footer-actions">
                <button class="btn btn-ghost btn-sm" @click="openEditPolicy(policy)">Edit Policy</button>
                <button class="btn btn-ghost btn-sm danger" @click="deletePolicy(policy)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── COMPANY TAB ─────────────────────────────────────────────────────── -->
    <div v-if="tab === 'company'" class="gp-content">
      <div class="gp-toolbar">
        <div class="company-selector">
          <label class="field-label">Company</label>
          <select v-model="selectedCompanyId" class="field-input" style="width:240px" @change="loadCompanyPolicies">
            <option value="">Select a company…</option>
            <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <button v-if="selectedCompanyId" class="btn btn-primary btn-sm" @click="openNewPolicy('company')">+ New Override</button>
      </div>

      <div v-if="!selectedCompanyId" class="gp-empty text-muted">Select a company to manage its policy overrides.</div>

      <div v-else-if="loadingCompany" class="gp-empty text-muted">Loading…</div>

      <div v-else class="policy-list">
        <!-- Global (inherited) -->
        <div class="section-label">Inherited Global Policies</div>
        <div v-if="!globalPolicies.length" class="gp-empty text-muted text-xs">No global policies.</div>
        <div v-for="policy in globalPolicies" :key="'g-' + policy.id" class="policy-card inherited">
          <div class="policy-header">
            <div class="policy-header-left">
              <span class="global-badge">Global</span>
              <div class="policy-info">
                <div class="policy-name">{{ policy.name }}</div>
                <div class="policy-monitor-summary text-xs text-muted">{{ policy.monitors.length }} monitors</div>
              </div>
            </div>
            <div class="policy-header-right">
              <button class="btn btn-ghost btn-sm" @click="cloneAsOverride(policy)">+ Override</button>
            </div>
          </div>
        </div>

        <!-- Company overrides -->
        <div class="section-label" style="margin-top:20px">Company Overrides</div>
        <div v-if="!companyPolicies.length" class="gp-empty text-muted text-xs" style="padding:12px 0">
          No overrides — global policies apply as-is.
        </div>
        <div v-for="policy in companyPolicies" :key="'c-' + policy.id" class="policy-card">
          <div class="policy-header" @click="toggleExpand(policy.id)">
            <div class="policy-header-left">
              <button
                class="policy-toggle-btn"
                :class="{ enabled: policy.enabled }"
                @click.stop="togglePolicy(policy)"
              >
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </button>
              <div class="policy-info">
                <div class="policy-name">{{ policy.name }}</div>
                <div v-if="policy.description" class="policy-desc">{{ policy.description }}</div>
              </div>
            </div>
            <div class="policy-header-right">
              <span class="monitor-count">{{ policy.monitors.length }} monitor{{ policy.monitors.length !== 1 ? 's' : '' }}</span>
              <svg class="expand-icon" :class="{ open: expanded.has(policy.id) }"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
          <div v-if="expanded.has(policy.id)" class="policy-monitors">
            <div v-for="m in policy.monitors" :key="m.id" class="monitor-row">
              <span class="check-chip" :class="`chip-${m.checkType}`">{{ checkLabel(m.checkType) }}</span>
              <span class="monitor-config">{{ monitorSummary(m) }}</span>
              <span class="pri-badge" :class="`pri-${m.alertPriority}`">{{ capitalize(m.alertPriority) }}</span>
              <span class="monitor-meta">{{ m.sustainedMinutes }}m sustained</span>
              <div class="monitor-row-actions">
                <button class="btn-text" @click="openEditMonitor(policy, m)">Edit</button>
                <button class="btn-text danger" @click="deleteMonitor(policy, m)">Delete</button>
              </div>
            </div>
            <div class="monitors-footer">
              <button class="btn btn-ghost btn-sm" @click="openAddMonitor(policy)">+ Add Monitor</button>
              <div class="policy-footer-actions">
                <button class="btn btn-ghost btn-sm" @click="openEditPolicy(policy)">Edit Policy</button>
                <button class="btn btn-ghost btn-sm danger" @click="deletePolicy(policy)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── POLICY MODAL ────────────────────────────────────────────────────── -->
    <div v-if="policyModal.open" class="modal-backdrop" @click.self="policyModal.open = false">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ policyModal.editId ? 'Edit Policy' : 'New Policy' }}</span>
          <button class="btn-icon" @click="policyModal.open = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label">Name</label>
            <input v-model="policyModal.form.name" class="field-input" type="text" placeholder="e.g. Antivirus Health" />
          </div>
          <div class="field">
            <label class="field-label">Description</label>
            <input v-model="policyModal.form.description" class="field-input" type="text" placeholder="Optional" />
          </div>
          <div class="field">
            <label class="field-label">Target OS</label>
            <div class="check-group horizontal">
              <label class="check-row" v-for="os in ['windows', 'linux', 'macos']" :key="os">
                <input type="checkbox" :value="os" v-model="policyModal.form.targetOs" />
                <span>{{ os }}</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label class="field-label">Target Device Class</label>
            <div class="check-group horizontal">
              <label class="check-row" v-for="cls in ['server', 'workstation', 'laptop']" :key="cls">
                <input type="checkbox" :value="cls" v-model="policyModal.form.targetClass" />
                <span>{{ cls }}</span>
              </label>
            </div>
          </div>
          <div v-if="policyModal.error" class="error-msg">{{ policyModal.error }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" @click="policyModal.open = false">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="policyModal.saving" @click="savePolicy">
            {{ policyModal.saving ? 'Saving…' : (policyModal.editId ? 'Save Changes' : 'Create Policy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── MONITOR MODAL ───────────────────────────────────────────────────── -->
    <div v-if="monitorModal.open" class="modal-backdrop" @click.self="monitorModal.open = false">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ monitorModal.editId ? 'Edit Monitor' : 'Add Monitor' }}</span>
          <button class="btn-icon" @click="monitorModal.open = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label">Monitor Type</label>
            <select v-model="monitorModal.form.checkType" class="field-input" :disabled="!!monitorModal.editId">
              <option value="offline">Offline — device stops checking in</option>
              <option value="disk_space">Disk Space — free space below limit</option>
              <option value="cpu_usage">CPU Usage — sustained high CPU</option>
              <option value="memory_usage">Memory Usage — sustained high memory</option>
              <option value="av_status">Antivirus Status</option>
            </select>
          </div>

          <!-- Config fields by type -->
          <div v-if="monitorModal.form.checkType === 'offline'" class="field">
            <label class="field-label">Alert after offline for</label>
            <div class="input-row">
              <input v-model.number="monitorModal.form.offlineMinutes" type="number" min="1" class="field-input" style="max-width:90px" />
              <span class="input-unit">minutes</span>
            </div>
          </div>
          <div v-if="monitorModal.form.checkType === 'disk_space'" class="field">
            <label class="field-label">Alert when free space below</label>
            <div class="input-row">
              <input v-model.number="monitorModal.form.diskGb" type="number" min="1" class="field-input" style="max-width:90px" />
              <span class="input-unit">GB</span>
            </div>
          </div>
          <div v-if="monitorModal.form.checkType === 'cpu_usage'" class="field">
            <label class="field-label">Alert when CPU exceeds</label>
            <div class="input-row">
              <input v-model.number="monitorModal.form.cpuPercent" type="number" min="1" max="100" class="field-input" style="max-width:90px" />
              <span class="input-unit">%</span>
            </div>
          </div>
          <div v-if="monitorModal.form.checkType === 'memory_usage'" class="field">
            <label class="field-label">Alert when memory exceeds</label>
            <div class="input-row">
              <input v-model.number="monitorModal.form.memPercent" type="number" min="1" max="100" class="field-input" style="max-width:90px" />
              <span class="input-unit">%</span>
            </div>
          </div>
          <div v-if="monitorModal.form.checkType === 'av_status'" class="field">
            <label class="field-label">Alert when AV state is</label>
            <select v-model="monitorModal.form.avState" class="field-input">
              <option value="not_detected">Not Detected — no AV product found</option>
              <option value="not_running">Not Running — AV installed but disabled</option>
              <option value="running_not_up_to_date">Out of Date — definitions stale</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Priority</label>
            <select v-model="monitorModal.form.alertPriority" class="field-input">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label">Sustained (minutes)</label>
              <input v-model.number="monitorModal.form.sustainedMinutes" type="number" min="0" class="field-input" style="max-width:90px" />
            </div>
            <div class="field">
              <label class="field-label">Auto-resolve after (minutes)</label>
              <input v-model.number="monitorModal.form.autoResolveAfterMinutes" type="number" min="0" class="field-input" style="max-width:90px" />
            </div>
          </div>

          <div class="field">
            <label class="check-row">
              <input type="checkbox" v-model="monitorModal.form.autoResolve" />
              <span>Auto-resolve when condition clears</span>
            </label>
          </div>

          <div v-if="monitorModal.error" class="error-msg">{{ monitorModal.error }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" @click="monitorModal.open = false">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="monitorModal.saving" @click="saveMonitor">
            {{ monitorModal.saving ? 'Saving…' : (monitorModal.editId ? 'Save Changes' : 'Add Monitor') }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { api, type Policy, type PolicyMonitor, type CheckType, type AlertPriority, type Tenant } from '../api';

const tab              = ref<'global' | 'company'>('global');
const loading          = ref(true);
const loadingCompany   = ref(false);
const globalPolicies   = ref<Policy[]>([]);
const companyPolicies  = ref<Policy[]>([]);
const tenants          = ref<Tenant[]>([]);
const selectedCompanyId = ref('');
const expanded         = ref(new Set<string>());

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
  if (!selectedCompanyId.value) return;
  loadingCompany.value = true;
  try {
    companyPolicies.value = await api.policies.list({ scope: 'company', company_id: selectedCompanyId.value });
  } catch {
    companyPolicies.value = [];
  } finally {
    loadingCompany.value = false;
  }
}

onMounted(load);

// ── Expand ────────────────────────────────────────────────────────────────────

function toggleExpand(id: string) {
  const s = new Set(expanded.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expanded.value = s;
}

// ── Toggle policy enabled ─────────────────────────────────────────────────────

async function togglePolicy(policy: Policy) {
  try {
    await api.policies.update(policy.id, { enabled: !policy.enabled });
    policy.enabled = !policy.enabled;
  } catch {}
}

// ── Clone as company override ─────────────────────────────────────────────────

async function cloneAsOverride(globalPolicy: Policy) {
  if (!selectedCompanyId.value) return;
  try {
    const clone = await api.policies.create({
      name:       globalPolicy.name + ' (Override)',
      scope:      'company',
      company_id: selectedCompanyId.value,
      clone_from: globalPolicy.id,
    });
    companyPolicies.value.push(clone);
    expanded.value = new Set(expanded.value).add(clone.id);
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : 'Failed to create override');
  }
}

// ── Policy modal ──────────────────────────────────────────────────────────────

const policyModal = reactive({
  open:   false,
  editId: null as string | null,
  scope:  'global' as 'global' | 'company',
  saving: false,
  error:  '',
  form: {
    name:        '',
    description: '',
    targetOs:    ['windows', 'linux', 'macos'] as string[],
    targetClass: ['server', 'workstation', 'laptop'] as string[],
  },
});

function openNewPolicy(scope: 'global' | 'company') {
  policyModal.editId      = null;
  policyModal.scope       = scope;
  policyModal.error       = '';
  policyModal.form.name        = '';
  policyModal.form.description = '';
  policyModal.form.targetOs    = ['windows', 'linux', 'macos'];
  policyModal.form.targetClass = ['server', 'workstation', 'laptop'];
  policyModal.open = true;
}

function openEditPolicy(policy: Policy) {
  policyModal.editId      = policy.id;
  policyModal.scope       = policy.scope;
  policyModal.error       = '';
  policyModal.form.name        = policy.name;
  policyModal.form.description = policy.description ?? '';
  policyModal.form.targetOs    = JSON.parse(policy.targetOs) as string[];
  policyModal.form.targetClass = JSON.parse(policy.targetClass) as string[];
  policyModal.open = true;
}

async function savePolicy() {
  if (!policyModal.form.name.trim()) {
    policyModal.error = 'Name is required.';
    return;
  }
  policyModal.saving = true;
  policyModal.error  = '';
  try {
    if (policyModal.editId) {
      await api.policies.update(policyModal.editId, {
        name:         policyModal.form.name,
        description:  policyModal.form.description || null,
        target_os:    policyModal.form.targetOs,
        target_class: policyModal.form.targetClass,
      });
      await load();
      if (tab.value === 'company') await loadCompanyPolicies();
    } else {
      const newPolicy = await api.policies.create({
        name:         policyModal.form.name,
        description:  policyModal.form.description || null,
        scope:        policyModal.scope,
        company_id:   policyModal.scope === 'company' ? selectedCompanyId.value : null,
        target_os:    policyModal.form.targetOs,
        target_class: policyModal.form.targetClass,
      });
      if (policyModal.scope === 'global') {
        globalPolicies.value.push(newPolicy);
      } else {
        companyPolicies.value.push(newPolicy);
      }
    }
    policyModal.open = false;
  } catch (e: unknown) {
    policyModal.error = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    policyModal.saving = false;
  }
}

async function deletePolicy(policy: Policy) {
  if (!confirm(`Delete policy "${policy.name}"?`)) return;
  try {
    await api.policies.delete(policy.id);
    globalPolicies.value  = globalPolicies.value.filter(p => p.id !== policy.id);
    companyPolicies.value = companyPolicies.value.filter(p => p.id !== policy.id);
    expanded.value.delete(policy.id);
  } catch {}
}

// ── Monitor modal ─────────────────────────────────────────────────────────────

const monitorModal = reactive({
  open:     false,
  editId:   null as string | null,
  policyId: '',
  saving:   false,
  error:    '',
  form: {
    checkType:               'offline' as CheckType,
    alertPriority:           'high'    as AlertPriority,
    sustainedMinutes:        5,
    autoResolve:             true,
    autoResolveAfterMinutes: 60,
    offlineMinutes:          30,
    diskGb:                  10,
    cpuPercent:              90,
    memPercent:              90,
    avState:                 'not_detected',
  },
});

function openAddMonitor(policy: Policy) {
  monitorModal.editId       = null;
  monitorModal.policyId     = policy.id;
  monitorModal.error        = '';
  monitorModal.form.checkType = 'offline';
  monitorModal.form.alertPriority = 'high';
  monitorModal.form.sustainedMinutes = 5;
  monitorModal.form.autoResolve = true;
  monitorModal.form.autoResolveAfterMinutes = 60;
  monitorModal.form.offlineMinutes = 30;
  monitorModal.form.diskGb = 10;
  monitorModal.form.cpuPercent = 90;
  monitorModal.form.memPercent = 90;
  monitorModal.form.avState = 'not_detected';
  monitorModal.open = true;
}

function openEditMonitor(policy: Policy, m: PolicyMonitor) {
  monitorModal.editId   = m.id;
  monitorModal.policyId = policy.id;
  monitorModal.error    = '';
  monitorModal.form.checkType               = m.checkType;
  monitorModal.form.alertPriority           = m.alertPriority;
  monitorModal.form.sustainedMinutes        = m.sustainedMinutes;
  monitorModal.form.autoResolve             = m.autoResolve;
  monitorModal.form.autoResolveAfterMinutes = m.autoResolveAfterMinutes;
  try {
    const cfg = JSON.parse(m.config) as Record<string, unknown>;
    monitorModal.form.offlineMinutes = Math.round((cfg.offline_after_seconds as number ?? 1800) / 60);
    monitorModal.form.diskGb         = Math.round((cfg.bytes_free_min        as number ?? 10737418240) / 1073741824);
    monitorModal.form.cpuPercent     = (cfg.percent_max as number) ?? 90;
    monitorModal.form.memPercent     = (cfg.percent_max as number) ?? 90;
    monitorModal.form.avState        = (cfg.av_state    as string) ?? 'not_detected';
  } catch {}
  monitorModal.open = true;
}

function buildMonitorConfig(): Record<string, unknown> {
  const f = monitorModal.form;
  switch (f.checkType) {
    case 'offline':      return { offline_after_seconds: f.offlineMinutes * 60 };
    case 'disk_space':   return { bytes_free_min: f.diskGb * 1073741824 };
    case 'cpu_usage':    return { percent_max: f.cpuPercent };
    case 'memory_usage': return { percent_max: f.memPercent };
    case 'av_status':    return { av_state: f.avState };
    default:             return {};
  }
}

async function saveMonitor() {
  monitorModal.saving = true;
  monitorModal.error  = '';
  try {
    const config = buildMonitorConfig();
    const f      = monitorModal.form;

    if (monitorModal.editId) {
      await api.policies.monitors.update(monitorModal.policyId, monitorModal.editId, {
        config,
        alert_priority:           f.alertPriority,
        sustained_minutes:        f.sustainedMinutes,
        auto_resolve:             f.autoResolve,
        auto_resolve_after_minutes: f.autoResolveAfterMinutes,
      });
    } else {
      await api.policies.monitors.create(monitorModal.policyId, {
        check_type:               f.checkType,
        config,
        alert_priority:           f.alertPriority,
        sustained_minutes:        f.sustainedMinutes,
        auto_resolve:             f.autoResolve,
        auto_resolve_after_minutes: f.autoResolveAfterMinutes,
      });
    }

    // Reload the relevant policy list to refresh monitors
    await load();
    if (tab.value === 'company') await loadCompanyPolicies();
    monitorModal.open = false;
  } catch (e: unknown) {
    monitorModal.error = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    monitorModal.saving = false;
  }
}

async function deleteMonitor(policy: Policy, m: PolicyMonitor) {
  if (!confirm(`Delete this monitor?`)) return;
  try {
    await api.policies.monitors.delete(policy.id, m.id);
    policy.monitors = policy.monitors.filter(x => x.id !== m.id);
  } catch {}
}

// ── Formatters ────────────────────────────────────────────────────────────────

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function parsedOs(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}
function parsedClass(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function checkLabel(ct: CheckType): string {
  switch (ct) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Offline';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    case 'av_status':    return 'Antivirus';
    default:             return ct;
  }
}

function monitorSummary(m: PolicyMonitor): string {
  try {
    const cfg = JSON.parse(m.config) as Record<string, unknown>;
    switch (m.checkType) {
      case 'offline':
        return `after ${Math.round((cfg.offline_after_seconds as number) / 60)}m offline`;
      case 'disk_space':
        return `< ${Math.round((cfg.bytes_free_min as number) / 1073741824)} GB free`;
      case 'cpu_usage':
        return `> ${cfg.percent_max}% CPU`;
      case 'memory_usage':
        return `> ${cfg.percent_max}% memory`;
      case 'av_status': {
        const state = cfg.av_state as string;
        if (state === 'not_detected')          return 'AV: not detected';
        if (state === 'not_running')            return 'AV: not running';
        if (state === 'running_not_up_to_date') return 'AV: out of date';
        return `AV: ${state}`;
      }
      default: return m.config;
    }
  } catch { return m.config; }
}
</script>

<style scoped>
.gp-page { display: flex; flex-direction: column; height: 100%; gap: 0; }

/* ── Tabs ── */
.gp-tabs {
  display: flex; gap: 0; border-bottom: 1px solid var(--border);
  flex-shrink: 0; margin-bottom: 16px;
}
.gp-tab {
  padding: 8px 16px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--muted); cursor: pointer; transition: color .12s, border-color .12s;
  margin-bottom: -1px;
}
.gp-tab:hover  { color: var(--text); }
.gp-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Content ── */
.gp-content { flex: 1; overflow: auto; display: flex; flex-direction: column; }

.gp-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; flex-shrink: 0;
}
.gp-toolbar-label { font-size: 12px; color: var(--muted); }

.company-selector { display: flex; align-items: center; gap: 10px; }

.gp-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 120px; gap: 4px; color: var(--text);
}

/* ── Policy list ── */
.policy-list { display: flex; flex-direction: column; gap: 10px; }

.section-label {
  font-size: 11px; font-weight: 600; letter-spacing: .05em;
  text-transform: uppercase; color: var(--muted); margin-bottom: 6px;
}

.policy-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  overflow: hidden;
}
.policy-card.inherited {
  opacity: .8;
  background: var(--surface-2);
}

.policy-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; cursor: pointer; user-select: none;
  transition: background .08s;
}
.policy-card.inherited .policy-header { cursor: default; }
.policy-header:hover { background: var(--surface-2); }
.policy-card.inherited .policy-header:hover { background: transparent; }

.policy-header-left  { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.policy-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.policy-info { min-width: 0; }
.policy-name { font-size: 13px; font-weight: 600; color: var(--text); }
.policy-desc { font-size: 11px; color: var(--muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.policy-monitor-summary { margin-top: 2px; }

/* Toggle switch */
.policy-toggle-btn {
  background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0;
}
.toggle-track {
  display: block; width: 28px; height: 16px; border-radius: 8px;
  background: var(--border); position: relative; transition: background .15s;
}
.policy-toggle-btn.enabled .toggle-track { background: var(--accent); }
.toggle-thumb {
  display: block; width: 12px; height: 12px; border-radius: 6px;
  background: #fff; position: absolute; top: 2px; left: 2px;
  transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.policy-toggle-btn.enabled .toggle-thumb { left: 14px; }

.policy-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.meta-chip {
  display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;
  background: rgba(78,126,247,.12); color: var(--accent); text-transform: capitalize;
}
.class-chip { background: rgba(45,207,160,.12); color: var(--teal); }

.monitor-count { font-size: 11px; color: var(--muted); white-space: nowrap; }

.global-badge {
  display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700;
  background: var(--surface); border: 1px solid var(--border); color: var(--muted);
  white-space: nowrap;
}

.expand-icon { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.expand-icon.open { transform: rotate(180deg); }

/* ── Monitor rows ── */
.policy-monitors {
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}

.monitors-empty {
  padding: 12px 14px;
}

.monitor-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 12px;
}
.monitor-row:last-of-type { border-bottom: none; }

.monitor-config { color: var(--muted-2); font-size: 11px; }
.monitor-meta   { font-size: 11px; color: var(--muted); }

.monitor-row-actions { margin-left: auto; display: flex; gap: 6px; }

.monitors-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; border-top: 1px solid var(--border);
}
.policy-footer-actions { display: flex; gap: 6px; }

.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 10px; font-weight: 700;
  white-space: nowrap;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16);  color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12);   color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14);  color: var(--accent); }
.chip-av_status    { background: rgba(45,207,160,.14);  color: var(--teal); }

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
  width: 440px; max-width: 95vw; box-shadow: 0 12px 40px rgba(0,0,0,.25);
  display: flex; flex-direction: column; max-height: 90vh;
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

.field { display: flex; flex-direction: column; gap: 5px; }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.field-input {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; width: 100%; box-sizing: border-box;
}
.field-input:focus { border-color: var(--accent); }
.field-input option { background: var(--surface); }
.field-input:disabled { opacity: .5; cursor: default; }

.input-row   { display: flex; align-items: center; gap: 8px; }
.input-unit  { font-size: 13px; color: var(--muted); white-space: nowrap; }

.check-group { display: flex; flex-direction: column; gap: 8px; }
.check-group.horizontal {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 0;
}
.check-row {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  font-size: 13px; color: var(--text); padding: 4px 0;
  white-space: nowrap;
}
.check-row input[type="checkbox"] { flex-shrink: 0; accent-color: var(--accent); }

.error-msg { color: #e04040; font-size: 12px; }

.text-xs { font-size: 11px; }
.text-muted { color: var(--muted); }
</style>
