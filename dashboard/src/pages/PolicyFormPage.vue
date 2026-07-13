<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/global/policies" class="pf-crumb-link">Policies</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-link">Monitoring</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Create Policy' : 'Edit Policy' }}</span>
    </nav>

    <!-- Top bar -->
    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/global/policies')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">{{ isNew ? 'Create Policy' : (form.name || 'Edit Policy') }}</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/global/policies')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : (isNew ? 'Create Policy' : 'Save Changes') }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="error-banner" style="margin:0 0 16px">{{ loadError }}</div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">

      <!-- Name -->
      <div class="pf-group">
        <label class="pf-label">Name</label>
        <input v-model="form.name" class="pf-input" placeholder="Enter a name" />
        <span v-if="fieldErr.name" class="pf-err">{{ fieldErr.name }}</span>
      </div>

      <!-- Description -->
      <div class="pf-group">
        <label class="pf-label">Description</label>
        <textarea v-model="form.description" class="pf-input pf-textarea" rows="3" placeholder="Enter a description" />
      </div>

      <!-- Scope -->
      <div class="pf-group">
        <label class="pf-label">Scope</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: form.scope === 'global' }]" @click="form.scope = 'global'">Global</button>
          <button :class="['seg-btn', { active: form.scope === 'company' }]" @click="form.scope = 'company'">Site</button>
        </div>
        <div v-if="form.scope === 'company'" class="pf-site-wrap">
          <div class="pf-site-row">
            <input v-model="siteQuery" class="pf-input pf-site-input" placeholder="Enter Site name"
              @focus="siteOpen = true" @blur="hideSiteDrop" />
            <svg class="pf-site-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div v-if="siteOpen && siteMatches.length" class="pf-site-drop">
            <div v-for="t in siteMatches" :key="t.id" class="pf-site-opt" @mousedown.prevent="selectSite(t)">{{ t.name }}</div>
          </div>
        </div>
        <span v-if="fieldErr.companyId" class="pf-err">{{ fieldErr.companyId }}</span>
      </div>

      <!-- Monitors -->
      <div class="pf-group">
        <label class="pf-label">Monitors</label>
        <div class="pf-monitors">
          <div class="pf-tbl-head">
            <span class="pf-th-type">Type</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>Description</span>
          </div>
          <div v-if="!monitors.length" class="pf-mon-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="color:var(--muted);flex-shrink:0">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            <p>Add Monitors to keep track of attributes, processes and events on devices that have been targeted.</p>
            <button class="btn btn-primary btn-sm" @click="openAddMonitor">Add Monitor</button>
          </div>
          <template v-else>
            <div v-for="(m, idx) in monitors" :key="m._key" class="pf-mon-row">
              <span :class="['check-chip', 'chip-' + m.checkType]">{{ checkLabel(m.checkType) }}</span>
              <span class="pf-mon-desc">{{ monitorSummaryLocal(m) }}</span>
              <div class="pf-mon-actions">
                <button class="btn-text" @click="openEditMonitor(idx)">Edit</button>
                <button class="btn-text danger" @click="doDeleteMonitor(idx)">Delete</button>
              </div>
            </div>
            <div class="pf-mon-add">
              <button class="btn btn-ghost btn-sm" @click="openAddMonitor">+ Add Monitor</button>
            </div>
          </template>
        </div>
      </div>

      <!-- Targets -->
      <div class="pf-group">
        <label class="pf-label">Targets</label>
        <div class="pf-targets">
          <div class="pf-tbl-head"><span>Name</span></div>
          <div class="pf-target-body">
            <div class="pf-target-sec">
              <span class="pf-target-label">Operating System</span>
              <div class="pill-group">
                <label v-for="os in osOptions" :key="os.value" :class="['pill-opt', { active: form.targetOs.includes(os.value) }]">
                  <input type="checkbox" :value="os.value" v-model="form.targetOs" class="pill-cb" />
                  {{ os.label }}
                </label>
              </div>
            </div>
            <div class="pf-target-sec">
              <span class="pf-target-label">Device Class</span>
              <div class="pill-group">
                <label v-for="cls in classOptions" :key="cls.value" :class="['pill-opt', { active: form.targetClass.includes(cls.value) }]">
                  <input type="checkbox" :value="cls.value" v-model="form.targetClass" class="pill-cb" />
                  {{ cls.label }}
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Enabled -->
      <div class="pf-group">
        <label class="pf-label">Enabled</label>
        <div class="seg-bar">
          <button :class="['seg-btn', 'seg-primary', { active: form.enabled }]" @click="form.enabled = true">Enabled</button>
          <button :class="['seg-btn', { active: !form.enabled }]" @click="form.enabled = false">Disabled</button>
        </div>
      </div>

      <div v-if="saveError" class="error-banner">{{ saveError }}</div>

    </div><!-- /pf-body -->

    <!-- ── Add / Edit Monitor Overlay ── -->
    <Teleport to="body">
    <div v-if="monPanel.open" class="mo-overlay">
      <div class="mo-inner">

        <div class="mo-head">
          <h2 class="mo-head-title">{{ monPanel.editIndex != null ? 'Edit Monitor' : 'Add Monitor' }}</h2>
          <button class="btn-icon" @click="monPanel.open = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="mo-body">

          <!-- ● Monitor Type -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot active"></span>
              <strong>Monitor Type</strong>
            </div>
            <div class="mo-type-grid">
              <button v-for="ct in checkTypeOptions" :key="ct.value"
                :class="['mo-type-card', { selected: monPanel.form.checkType === ct.value }]"
                @click="monPanel.form.checkType = ct.value as CheckType">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" v-html="ct.iconPaths"></svg>
                <span>{{ ct.label }}</span>
              </button>
            </div>
          </div>

          <div class="mo-div"></div>

          <!-- ● Alert -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot" :class="{ active: !!monPanel.form.checkType }"></span>
              <strong>Alert</strong>
            </div>
            <p class="mo-sec-sub">Configure the Monitor alert criteria</p>

            <div v-if="monPanel.form.checkType === 'offline'" class="mf-field">
              <label class="mf-label">Alert after offline for</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.offlineMinutes" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">minutes</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'disk_space'" class="mf-field">
              <label class="mf-label">Alert when free space below</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.diskGb" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">GB</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'cpu_usage'" class="mf-field">
              <label class="mf-label">CPU usage has reached</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.cpuPercent" type="number" min="1" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>
              <p v-if="monPanel.form.cpuPercent >= 95" class="mf-warn">
                Monitoring at ≥95% alone may not alert reliably — a device at 100% CPU can fail to report. Consider a lower threshold (e.g. 85%) with a longer period as an early warning.
              </p>
            </div>

            <div v-if="monPanel.form.checkType === 'memory_usage'" class="mf-field">
              <label class="mf-label">Memory usage has reached</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.memPercent" type="number" min="1" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'av_status'" class="mf-field">
              <label class="mf-label">Alert when AV state is</label>
              <select v-model="monPanel.form.avState" class="mf-input mf-select">
                <option value="not_detected">Not Detected — no AV product found</option>
                <option value="not_running">Not Running — AV installed but disabled</option>
                <option value="running_not_up_to_date">Out of Date — definitions stale</option>
              </select>
            </div>

            <div class="mf-pair">
              <div class="mf-field">
                <label class="mf-label">For a period of</label>
                <div class="mf-row">
                  <input v-model.number="monPanel.form.sustainedMinutes" type="number" min="0" class="mf-input" style="max-width:90px"/>
                  <span class="mf-unit">min</span>
                </div>
              </div>
              <div class="mf-field">
                <label class="mf-label">Alert priority</label>
                <select v-model="monPanel.form.alertPriority" class="mf-input mf-select">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="moderate">Moderate</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            <label class="mf-check-row">
              <input type="checkbox" v-model="monPanel.form.autoResolve" style="accent-color:var(--accent)" />
              <span>Auto-resolve alert when condition is no longer met</span>
            </label>
            <div v-if="monPanel.form.autoResolve" class="mf-field" style="margin-top:10px">
              <label class="mf-label">Keep alert visible for at least</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.autoResolveAfterMinutes" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">min before resolving</span>
              </div>
            </div>
          </div>

          <div class="mo-div"></div>

          <!-- ● Response -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot"></span>
              <strong>Response</strong>
              <span class="mo-optional">(Optional)</span>
            </div>
            <p class="mo-sec-sub">Configure the system response when the Monitor alert is triggered</p>
            <div class="mf-toggle-row">
              <div class="mf-toggle-text">
                <span class="mf-toggle-title">Send a Webhook</span>
                <span class="mf-toggle-sub">When alert is triggered</span>
              </div>
              <button :class="['mf-tgl', { on: monPanel.form.sendWebhook }]"
                @click="monPanel.form.sendWebhook = !monPanel.form.sendWebhook">
                <span class="mf-tgl-thumb"></span>
              </button>
            </div>
          </div>

          <div v-if="monPanel.error" class="mo-error">{{ monPanel.error }}</div>

        </div><!-- /mo-body -->

        <div class="mo-foot">
          <button class="btn btn-ghost btn-sm" @click="monPanel.open = false">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="monPanel.saving" @click="saveMonitor">
            {{ monPanel.saving ? 'Saving…' : (monPanel.editIndex != null ? 'Save Changes' : 'Add Monitor') }}
          </button>
        </div>

      </div><!-- /mo-inner -->
    </div>
    </Teleport>

  </div><!-- /pf-page -->
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type CheckType, type AlertPriority, type Tenant } from '../api';

const router = useRouter();
const route  = useRoute();

const policyId = computed(() => route.params.id as string | undefined);
const isNew    = computed(() => !policyId.value);

const loading   = ref(false);
const saving    = ref(false);
const loadError = ref('');
const saveError = ref('');
const tenants   = ref<Tenant[]>([]);
const siteQuery = ref('');
const siteOpen  = ref(false);
const fieldErr  = reactive({ name: '', companyId: '' });

const form = reactive({
  name:        '',
  description: '',
  scope:       (route.query.scope as 'global' | 'company') ?? 'global',
  companyId:   (route.query.company_id as string) ?? '',
  enabled:     true,
  targetOs:    ['windows', 'linux', 'macos'] as string[],
  targetClass: ['server', 'workstation', 'laptop'] as string[],
});

const osOptions    = [{ value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }, { value: 'macos', label: 'macOS' }];
const classOptions = [{ value: 'server', label: 'Server' }, { value: 'workstation', label: 'Workstation' }, { value: 'laptop', label: 'Laptop' }];

const checkTypeOptions = [
  { value: 'offline',
    label: 'Offline',
    iconPaths: '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>' },
  { value: 'disk_space',
    label: 'Disk Space',
    iconPaths: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
  { value: 'cpu_usage',
    label: 'CPU Usage',
    iconPaths: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>' },
  { value: 'memory_usage',
    label: 'Memory',
    iconPaths: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 11v2M12 11v2M17 11v2M2 11h1M21 11h1"/>' },
  { value: 'av_status',
    label: 'Antivirus',
    iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>' },
];

// ── Site search ──

const siteMatches = computed(() => {
  if (!siteQuery.value) return tenants.value.slice(0, 10);
  const q = siteQuery.value.toLowerCase();
  return tenants.value.filter(t => t.name.toLowerCase().includes(q)).slice(0, 10);
});

function selectSite(t: Tenant) {
  form.companyId = t.id;
  siteQuery.value = t.name;
  siteOpen.value  = false;
}

function hideSiteDrop() {
  setTimeout(() => { siteOpen.value = false; }, 150);
}

// ── Local monitor type ──

interface LocalMonitor {
  _key:                    string;
  id?:                     string;
  checkType:               CheckType;
  alertPriority:           AlertPriority;
  sustainedMinutes:        number;
  autoResolve:             boolean;
  autoResolveAfterMinutes: number;
  offlineMinutes:          number;
  diskGb:                  number;
  cpuPercent:              number;
  memPercent:              number;
  avState:                 string;
  sendWebhook:             boolean;
}

let keySeq = 0;
const monitors = ref<LocalMonitor[]>([]);

// ── Monitor panel ──

const monPanel = reactive({
  open:      false,
  editIndex: null as number | null,
  saving:    false,
  error:     '',
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
    sendWebhook:             false,
  },
});

function openAddMonitor() {
  monPanel.editIndex = null;
  monPanel.error     = '';
  Object.assign(monPanel.form, {
    checkType: 'offline', alertPriority: 'high',
    sustainedMinutes: 5, autoResolve: true, autoResolveAfterMinutes: 60,
    offlineMinutes: 30, diskGb: 10, cpuPercent: 90, memPercent: 90,
    avState: 'not_detected', sendWebhook: false,
  });
  monPanel.open = true;
}

function openEditMonitor(index: number) {
  const m = monitors.value[index];
  monPanel.editIndex = index;
  monPanel.error     = '';
  Object.assign(monPanel.form, {
    checkType:               m.checkType,
    alertPriority:           m.alertPriority,
    sustainedMinutes:        m.sustainedMinutes,
    autoResolve:             m.autoResolve,
    autoResolveAfterMinutes: m.autoResolveAfterMinutes,
    offlineMinutes:          m.offlineMinutes,
    diskGb:                  m.diskGb,
    cpuPercent:              m.cpuPercent,
    memPercent:              m.memPercent,
    avState:                 m.avState,
    sendWebhook:             m.sendWebhook,
  });
  monPanel.open = true;
}

function buildConfig(f: typeof monPanel.form): Record<string, unknown> {
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
  const f      = monPanel.form;
  const config = buildConfig(f);

  if (!isNew.value && policyId.value) {
    monPanel.saving = true;
    monPanel.error  = '';
    try {
      if (monPanel.editIndex != null) {
        const m = monitors.value[monPanel.editIndex];
        if (m.id) {
          await api.policies.monitors.update(policyId.value, m.id, {
            config,
            alert_priority:             f.alertPriority,
            sustained_minutes:          f.sustainedMinutes,
            auto_resolve:               f.autoResolve,
            auto_resolve_after_minutes: f.autoResolveAfterMinutes,
          });
        }
        monitors.value[monPanel.editIndex] = { ...m, ...f };
      } else {
        const res = await api.policies.monitors.create(policyId.value, {
          check_type:                 f.checkType,
          config,
          alert_priority:             f.alertPriority,
          sustained_minutes:          f.sustainedMinutes,
          auto_resolve:               f.autoResolve,
          auto_resolve_after_minutes: f.autoResolveAfterMinutes,
        });
        monitors.value.push({ _key: String(keySeq++), id: res.monitor_id, ...f });
      }
      monPanel.open = false;
    } catch (e) {
      monPanel.error = e instanceof Error ? e.message : 'Failed to save.';
    } finally {
      monPanel.saving = false;
    }
    return;
  }

  // New policy: accumulate locally
  if (monPanel.editIndex != null) {
    monitors.value[monPanel.editIndex] = { ...monitors.value[monPanel.editIndex], ...f };
  } else {
    monitors.value.push({ _key: String(keySeq++), ...f });
  }
  monPanel.open = false;
}

async function doDeleteMonitor(index: number) {
  const m = monitors.value[index];
  if (!isNew.value && policyId.value && m.id) {
    try { await api.policies.monitors.delete(policyId.value, m.id); }
    catch { return; }
  }
  monitors.value.splice(index, 1);
}

// ── Load ──

onMounted(async () => {
  try { tenants.value = await api.tenants.list(); } catch { /* ok */ }

  if (!isNew.value && policyId.value) {
    loading.value = true;
    try {
      const all    = await api.policies.list();
      const policy = all.find(p => p.id === policyId.value);
      if (!policy) { loadError.value = 'Policy not found.'; return; }

      form.name        = policy.name;
      form.description = policy.description ?? '';
      form.scope       = policy.scope;
      form.companyId   = policy.companyId ?? '';
      form.enabled     = policy.enabled;
      form.targetOs    = JSON.parse(policy.targetOs)    as string[];
      form.targetClass = JSON.parse(policy.targetClass) as string[];

      if (form.scope === 'company' && form.companyId) {
        const t = tenants.value.find(t => t.id === form.companyId);
        if (t) siteQuery.value = t.name;
      }

      monitors.value = policy.monitors.map(m => {
        const cfg = JSON.parse(m.config) as Record<string, unknown>;
        return {
          _key:                    String(keySeq++),
          id:                      m.id,
          checkType:               m.checkType,
          alertPriority:           m.alertPriority,
          sustainedMinutes:        m.sustainedMinutes,
          autoResolve:             m.autoResolve,
          autoResolveAfterMinutes: m.autoResolveAfterMinutes,
          offlineMinutes:          Math.round(((cfg.offline_after_seconds as number) ?? 1800) / 60),
          diskGb:                  Math.round(((cfg.bytes_free_min        as number) ?? 10737418240) / 1073741824),
          cpuPercent:              (cfg.percent_max as number) ?? 90,
          memPercent:              (cfg.percent_max as number) ?? 90,
          avState:                 (cfg.av_state   as string) ?? 'not_detected',
          sendWebhook:             false,
        };
      });
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load policy.';
    } finally {
      loading.value = false;
    }
  }
});

// ── Save policy ──

async function save() {
  fieldErr.name      = '';
  fieldErr.companyId = '';
  saveError.value    = '';

  if (!form.name.trim()) { fieldErr.name = 'Name is required.'; return; }
  if (form.scope === 'company' && !form.companyId) { fieldErr.companyId = 'Select a company.'; return; }

  saving.value = true;
  try {
    if (isNew.value) {
      const policy = await api.policies.create({
        name:         form.name,
        description:  form.description || null,
        scope:        form.scope,
        company_id:   form.scope === 'company' ? form.companyId : null,
        target_os:    form.targetOs,
        target_class: form.targetClass,
      });
      for (const m of monitors.value) {
        await api.policies.monitors.create(policy.id, {
          check_type:                 m.checkType,
          config:                     buildConfig({ ...monPanel.form, ...m }),
          alert_priority:             m.alertPriority,
          sustained_minutes:          m.sustainedMinutes,
          auto_resolve:               m.autoResolve,
          auto_resolve_after_minutes: m.autoResolveAfterMinutes,
        });
      }
    } else if (policyId.value) {
      await api.policies.update(policyId.value, {
        name:         form.name,
        description:  form.description || null,
        enabled:      form.enabled,
        target_os:    form.targetOs,
        target_class: form.targetClass,
      });
    }
    router.push('/global/policies');
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    saving.value = false;
  }
}

// ── Formatters ──

function checkLabel(ct: CheckType): string {
  const m: Record<CheckType, string> = { disk_space: 'Disk Space', offline: 'Offline', cpu_usage: 'CPU', memory_usage: 'Memory', av_status: 'Antivirus' };
  return m[ct] ?? ct;
}

function monitorSummaryLocal(m: LocalMonitor): string {
  switch (m.checkType) {
    case 'offline':      return `alert after ${m.offlineMinutes}m offline`;
    case 'disk_space':   return `alert when < ${m.diskGb} GB free`;
    case 'cpu_usage':    return `alert at > ${m.cpuPercent}% CPU`;
    case 'memory_usage': return `alert at > ${m.memPercent}% memory`;
    case 'av_status': {
      const labels: Record<string, string> = { not_detected: 'AV not detected', not_running: 'AV not running', running_not_up_to_date: 'AV out of date' };
      return labels[m.avState] ?? `AV: ${m.avState}`;
    }
    default: return m.checkType;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* ── Breadcrumb ── */
.pf-crumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted); margin-bottom: 14px;
}
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* ── Top bar ── */
.pf-topbar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 28px;
}
.pf-back {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--muted-2); cursor: pointer; flex-shrink: 0;
  transition: color .12s, background .12s;
}
.pf-back:hover { color: var(--text); background: var(--border); }
.pf-title { font-size: 20px; font-weight: 700; color: var(--text); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }

.pf-state { padding: 40px; text-align: center; color: var(--muted); }

/* ── Body ── */
.pf-body { display: flex; flex-direction: column; gap: 0; }

/* ── Form group ── */
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label {
  font-size: 15px; font-weight: 600; color: var(--text);
}
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.pf-textarea { resize: vertical; min-height: 80px; }
.pf-err { font-size: 11px; color: var(--red); }

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }
.seg-btn.seg-primary.active { background: var(--accent); color: #fff; }

/* ── Site search ── */
.pf-site-wrap { position: relative; max-width: 340px; }
.pf-site-row  { position: relative; }
.pf-site-input { padding-right: 32px; }
.pf-site-icon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.pf-site-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden;
}
.pf-site-opt {
  padding: 8px 12px; font-size: 13px; color: var(--text); cursor: pointer;
  transition: background .08s;
}
.pf-site-opt:hover { background: var(--surface-2); }

/* ── Monitors section ── */
.pf-monitors {
  border: 1px solid var(--border); border-radius: 7px; overflow: hidden;
  background: var(--surface);
}
.pf-tbl-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  font-size: 11px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .05em;
}
.pf-th-type { min-width: 80px; }
.pf-mon-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 32px 24px; text-align: center;
}
.pf-mon-empty p { font-size: 12px; color: var(--muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; border-bottom: 1px solid var(--border);
}
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--muted); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }
.pf-mon-add { padding: 8px 14px; border-top: 1px solid var(--border); }

/* ── Targets section ── */
.pf-targets { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-target-body { padding: 16px 14px; display: flex; flex-direction: column; gap: 16px; }
.pf-target-sec { display: flex; flex-direction: column; gap: 8px; }
.pf-target-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

.pill-group { display: flex; flex-wrap: wrap; gap: 6px; }
.pill-opt {
  display: inline-flex; align-items: center;
  padding: 5px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: var(--surface-2); font-size: 12px; font-weight: 500; color: var(--muted);
  cursor: pointer; user-select: none;
  transition: border-color .12s, background .12s, color .12s;
}
.pill-opt.active { border-color: var(--accent); background: rgba(78,126,247,.12); color: var(--accent); }
.pill-cb { display: none; }

/* ── btn-text ── */
.btn-text {
  background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font);
  color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s;
}
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }

/* ── check chip (reuse from policies page) ── */
.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; white-space: nowrap;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16);  color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12);   color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14);  color: var(--accent); }
.chip-av_status    { background: rgba(45,207,160,.14);  color: var(--teal); }

/* ── btn-icon ── */
.btn-icon {
  background: none; border: none; cursor: pointer; color: var(--muted);
  padding: 6px; display: flex; align-items: center; border-radius: 4px;
  transition: background .1s, color .1s;
}
.btn-icon:hover { background: var(--surface-2); color: var(--text); }

/* ═══════════════════════════════════════════════════════
   Add / Edit Monitor drawer (right-side panel)
   ═══════════════════════════════════════════════════════ */
.mo-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 500;
  display: flex; align-items: stretch; justify-content: flex-end;
}

.mo-inner {
  display: flex; flex-direction: column;
  width: 620px; max-width: calc(100vw - 160px);
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4);
  overflow: hidden;
}

.mo-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.mo-head-title { font-size: 18px; font-weight: 700; color: var(--text); margin: 0; }

.mo-body { flex: 1; overflow-y: auto; padding: 0 24px; }
.mo-sec  { padding: 24px 0; }
.mo-div  { border-top: 1px solid var(--border); margin: 0; }

.mo-sec-hd {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
}
.mo-sec-hd strong { font-size: 15px; font-weight: 600; color: var(--text); }
.mo-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--border-2); flex-shrink: 0;
}
.mo-dot.active { background: var(--accent); box-shadow: 0 0 0 3px rgba(78,126,247,.2); }
.mo-optional { font-size: 12px; color: var(--muted); margin-left: 2px; }
.mo-sec-sub { font-size: 12px; color: var(--muted); margin: -8px 0 16px 20px; line-height: 1.5; }

/* Type card grid */
.mo-type-grid {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.mo-type-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 20px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--muted-2); font-size: 12px; font-weight: 500; font-family: var(--font);
  transition: border-color .12s, color .12s, background .12s;
  min-width: 100px;
}
.mo-type-card:hover { border-color: var(--border-2); color: var(--text); }
.mo-type-card.selected {
  border-color: var(--accent); background: rgba(78,126,247,.08); color: var(--accent);
}
.mo-type-card svg { flex-shrink: 0; }

/* Monitor fields */
.mf-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.mf-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .04em;
}
.mf-row   { display: flex; align-items: center; gap: 8px; }
.mf-unit  { font-size: 13px; color: var(--muted); white-space: nowrap; }
.mf-input {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box; width: 100%;
}
.mf-input:focus { border-color: var(--accent); }
.mf-select { max-width: 380px; }
.mf-pair { display: flex; gap: 16px; }
.mf-pair .mf-field { flex: 1; min-width: 0; }
.mf-warn {
  font-size: 11px; color: var(--amber); line-height: 1.5;
  background: rgba(240,168,64,.08); border: 1px solid rgba(240,168,64,.2);
  border-radius: 5px; padding: 7px 10px; margin-top: 4px;
}
.mf-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text); cursor: pointer;
  margin-bottom: 4px;
}

/* Toggle in response section */
.mf-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-top: 1px solid var(--border);
}
.mf-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.mf-toggle-title { font-size: 13px; font-weight: 500; color: var(--text); }
.mf-toggle-sub   { font-size: 11px; color: var(--muted); }
.mf-tgl {
  position: relative; width: 40px; height: 22px; border-radius: 11px;
  background: var(--border); border: none; cursor: pointer;
  transition: background .15s; flex-shrink: 0;
}
.mf-tgl.on { background: var(--accent); }
.mf-tgl-thumb {
  position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  transition: left .15s;
}
.mf-tgl.on .mf-tgl-thumb { left: 21px; }

.mo-error { color: var(--red); font-size: 12px; padding: 8px 0; }

.mo-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border); flex-shrink: 0;
}
</style>
