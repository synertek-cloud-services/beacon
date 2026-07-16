<template>
  <div class="pf-page">

    <nav class="pf-crumb">
      <RouterLink to="/jobs" class="pf-crumb-link">Jobs</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">Create a Job</span>
    </nav>

    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/jobs')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">Create a Job</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/jobs')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="submit">
          {{ busy ? 'Creating…' : 'Create Job' }}
        </button>
      </div>
    </div>

    <div v-if="formError" class="error-banner" style="margin:0 0 16px">{{ formError }}</div>

    <div class="pf-body">

      <!-- Name -->
      <div class="pf-group">
        <label class="pf-label">Name</label>
        <input v-model="name" class="pf-input" placeholder="Enter a name" />
      </div>

      <!-- Description -->
      <div class="pf-group">
        <label class="pf-label">Description</label>
        <input v-model="description" class="pf-input" placeholder="Optional" />
      </div>

      <!-- Components -->
      <div class="pf-group">
        <label class="pf-label">Components</label>
        <div class="jf-table">
          <div class="jf-thead">
            <span class="jf-th" style="flex:1">Name</span>
            <span class="jf-th" style="width:110px">Variables</span>
            <span class="jf-th" style="width:110px"></span>
          </div>

          <!-- Empty state -->
          <div v-if="!orderedIds.length" class="jf-empty">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" color="var(--muted)">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <rect x="6" y="3" width="4" height="4" rx="1"/>
              <rect x="14" y="3" width="4" height="4" rx="1"/>
            </svg>
            <p>Components are your scripts or application installers. You can create your own or download them from the ComStore.</p>
            <button class="btn btn-primary btn-sm" @click="openCompFlyout">Add Component</button>
          </div>

          <!-- Component rows -->
          <template v-for="(id, idx) in orderedIds" :key="id">
            <div class="jf-row">
              <div class="jf-td" style="flex:1;display:flex;align-items:center;gap:8px">
                <span class="jf-order">{{ idx + 1 }}</span>
                <span>{{ nameFor(id) }}</span>
              </div>
              <div class="jf-td" style="width:110px">
                <span v-if="varsFor(id).length" class="jf-var-badge">{{ varsFor(id).length }} var{{ varsFor(id).length !== 1 ? 's' : '' }}</span>
                <span v-else class="jf-muted">—</span>
              </div>
              <div class="jf-td jf-td-actions" style="width:110px">
                <button class="btn-icon" :disabled="idx === 0" @click="moveUp(idx)" title="Move up">↑</button>
                <button class="btn-icon" :disabled="idx === orderedIds.length - 1" @click="moveDown(idx)" title="Move down">↓</button>
                <button class="btn-text danger" @click="removeAt(idx)">Remove</button>
              </div>
            </div>
            <div v-if="varsFor(id).length" class="jf-vars-row">
              <ComponentVariablePrompt
                :ref="(el: any) => setPromptRef(id, el)"
                :variables="varsFor(id)"
                :values="variableValues[id] ?? {}"
                @update:values="v => { variableValues[id] = v }"
              />
            </div>
          </template>

          <!-- Add more button -->
          <div v-if="orderedIds.length" class="jf-footer">
            <button class="btn btn-ghost btn-sm" @click="openCompFlyout">+ Add Component</button>
          </div>
        </div>
      </div>

      <!-- Targets -->
      <div class="pf-group">
        <label class="pf-label">Targets</label>
        <div class="jf-table">
          <div class="jf-thead">
            <span class="jf-th" style="flex:1">Name</span>
            <span class="jf-th" style="width:80px"></span>
          </div>

          <!-- Empty state -->
          <div v-if="!targetItems.length" class="jf-empty">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" color="var(--muted)">
              <rect x="5" y="2" width="9" height="14" rx="2"/>
              <rect x="13" y="8" width="8" height="11" rx="2"/>
              <line x1="9" y1="14" x2="9" y2="14" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <p>Targets are the devices this Job will run on. The Devices targeted by a Job are calculated just before it is scheduled to run.</p>
            <button class="btn btn-primary btn-sm" @click="openTargetFlyout">Add Target</button>
          </div>

          <!-- Target rows -->
          <template v-else>
            <div v-for="(t, i) in targetItems" :key="i" class="jf-row">
              <div class="jf-td" style="flex:1;display:flex;align-items:center;gap:8px">
                <span>{{ targetLabel(t) }}</span>
                <span v-if="t.kind !== 'all'" class="jf-kind-tag">{{ t.kind === 'company' ? 'Company' : 'Device' }}</span>
              </div>
              <div class="jf-td jf-td-actions" style="width:80px">
                <button class="btn-text danger" @click="removeTargetItem(i)">Remove</button>
              </div>
            </div>
            <div v-if="targetItems[0]?.kind !== 'all'" class="jf-footer">
              <button class="btn btn-ghost btn-sm" @click="openTargetFlyout">+ Add Target</button>
            </div>
          </template>
        </div>
        <p v-if="zeroDeviceWarning" class="field-hint field-hint-warn">
          This target currently resolves to 0 approved devices.
        </p>
      </div>

      <!-- Schedule -->
      <div class="pf-group">
        <label class="pf-label">Schedule</label>
        <p class="field-hint">By default, offline devices queue until they come online or the job expires — we run this job as soon as possible after the configured start time.</p>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: recurrence === 'immediately' }]" @click="recurrence = 'immediately'">Immediately</button>
          <button :class="['seg-btn', { active: recurrence === 'scheduled' }]" @click="recurrence = 'scheduled'">At a scheduled time</button>
        </div>

        <template v-if="recurrence === 'scheduled'">
          <div style="margin-top:12px;max-width:280px">
            <label class="jf-sublabel">Start time</label>
            <input type="datetime-local" v-model="scheduledAtLocal" class="pf-input" style="margin-top:6px" />
          </div>
        </template>

        <div style="margin-top:14px;max-width:320px">
          <label class="jf-sublabel">Expiration</label>
          <select v-model="expirationChoice" class="pf-input" style="margin-top:6px">
            <option value="none">Never</option>
            <option value="3600">1 hour after {{ recurrence === 'scheduled' ? 'start time' : 'creation' }}</option>
            <option value="14400">4 hours after {{ recurrence === 'scheduled' ? 'start time' : 'creation' }}</option>
            <option value="86400">24 hours after {{ recurrence === 'scheduled' ? 'start time' : 'creation' }}</option>
          </select>
          <p class="field-hint" style="margin-top:4px">If the job hasn't run on a device by then, it won't run at all.</p>
        </div>
      </div>

      <!-- Execution -->
      <div class="pf-group">
        <label class="pf-label">Execution</label>
        <div class="seg-bar">
          <button class="seg-btn active">Run as system account</button>
          <button class="seg-btn" disabled title="Not supported yet — the agent has no Windows user-impersonation support.">Run as a logged in user</button>
        </div>
        <p class="field-hint">Running as the logged-in user isn't supported yet — every job runs under the system account.</p>
      </div>

    </div>
  </div>

  <!-- Component flyout -->
  <Teleport to="body">
    <div v-if="compFlyoutOpen" class="tf-overlay" @click.self="compFlyoutOpen = false">
      <div class="tf-panel cf-panel">
        <div class="tf-head">
          <h2 class="tf-title">Add Component</h2>
          <button class="tf-close" @click="compFlyoutOpen = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="cf-tabs">
          <button :class="['cf-tab', { active: compFlyoutTab === 'library' }]" @click="compFlyoutTab = 'library'">
            Component Library <span class="cf-count">{{ library.length }}</span>
          </button>
          <button :class="['cf-tab', { active: compFlyoutTab === 'store' }]" @click="compFlyoutTab = 'store'">
            ComStore <span class="cf-count">{{ storeLibrary.length }}</span>
          </button>
        </div>
        <div class="tf-search">
          <input v-model="compFlyoutQuery" class="pf-input" placeholder="Find Component" style="max-width:none" />
        </div>
        <div class="tf-list">
          <div v-for="c in compFlyoutMatches" :key="c.id" :class="['cf-row', { 'cf-row-added': orderedIds.includes(c.id) }]">
            <div class="cf-row-icon">
              <svg v-if="c.type === 'script'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <div class="cf-row-info">
              <span class="cf-row-name">{{ c.name }}</span>
              <span v-if="c.description" class="cf-row-desc">{{ c.description }}</span>
            </div>
            <button v-if="!orderedIds.includes(c.id)" class="btn btn-ghost btn-sm cf-add-btn" @click="addComponent(c)">Add</button>
            <span v-else class="cf-check">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </div>
          <div v-if="!compFlyoutMatches.length" class="tf-empty-msg">No components found.</div>
        </div>
        <div class="tf-footer">
          <button class="btn btn-primary btn-sm" @click="compFlyoutOpen = false">Done</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Target flyout -->
  <Teleport to="body">
    <div v-if="targetFlyoutOpen" class="tf-overlay" @click.self="closeTargetFlyout">
      <div class="tf-panel">
        <div class="tf-head">
          <h2 class="tf-title">
            {{ flyoutStep === 'company' ? 'Add Company' : flyoutStep === 'devices' ? 'Add Devices' : 'Add Target' }}
          </h2>
          <button class="tf-close" @click="closeTargetFlyout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Step 1: type picker -->
        <template v-if="flyoutStep === ''">
          <div class="tf-options">
            <button class="tf-opt" @click="addAllDevices">
              <span class="tf-opt-name">All Devices</span>
              <span class="tf-opt-desc">Target every enrolled device</span>
            </button>
            <button class="tf-opt" @click="flyoutStep = 'company'">
              <span class="tf-opt-name">A Company</span>
              <span class="tf-opt-desc">Target all devices in one or more companies</span>
            </button>
            <button class="tf-opt" @click="flyoutStep = 'devices'">
              <span class="tf-opt-name">Specific Devices</span>
              <span class="tf-opt-desc">Choose individual devices by name</span>
            </button>
          </div>
        </template>

        <!-- Step 2a: company picker -->
        <template v-else-if="flyoutStep === 'company'">
          <div class="tf-search">
            <input v-model="flyoutCompanyQuery" class="pf-input" placeholder="Search companies…" style="max-width:none" />
          </div>
          <div class="tf-list">
            <label v-for="t in flyoutCompanyMatches" :key="t.id" class="tf-row" :class="{ 'tf-row-selected': !!flyoutSelectedCompanies[t.id] }">
              <input type="checkbox" :checked="!!flyoutSelectedCompanies[t.id]" @change="toggleFlyoutCompany(t.id, t.name)" style="accent-color:var(--accent)" />
              <span>{{ t.name }}</span>
            </label>
            <div v-if="!flyoutCompanyMatches.length" class="tf-empty-msg">No companies found.</div>
          </div>
          <div class="tf-footer">
            <button class="btn btn-ghost btn-sm" @click="flyoutStep = ''">Back</button>
            <button class="btn btn-primary btn-sm" :disabled="!Object.keys(flyoutSelectedCompanies).length" @click="addCompanyTargets">
              Add {{ Object.keys(flyoutSelectedCompanies).length > 0 ? Object.keys(flyoutSelectedCompanies).length : '' }}
              {{ Object.keys(flyoutSelectedCompanies).length === 1 ? 'company' : 'companies' }}
            </button>
          </div>
        </template>

        <!-- Step 2b: device picker -->
        <template v-else-if="flyoutStep === 'devices'">
          <div class="tf-search">
            <input v-model="flyoutDeviceQuery" class="pf-input" placeholder="Search devices…" style="max-width:none" />
          </div>
          <div class="tf-list">
            <label v-for="d in flyoutDeviceMatches" :key="d.id" class="tf-row" :class="{ 'tf-row-selected': !!flyoutSelectedDevices[d.id] }">
              <input type="checkbox" :checked="!!flyoutSelectedDevices[d.id]" @change="toggleFlyoutDevice(d.id, d.hostname ?? d.id.slice(0, 8))" style="accent-color:var(--accent)" />
              <div class="tf-row-info">
                <span>{{ d.hostname ?? d.id.slice(0, 8) }}</span>
                <span class="tf-row-sub">{{ d.tenantName }}</span>
              </div>
            </label>
            <div v-if="!flyoutDeviceMatches.length" class="tf-empty-msg">No matching devices.</div>
          </div>
          <div class="tf-footer">
            <button class="btn btn-ghost btn-sm" @click="flyoutStep = ''">Back</button>
            <button class="btn btn-primary btn-sm" :disabled="!Object.keys(flyoutSelectedDevices).length" @click="addDeviceTargets">
              Add {{ Object.keys(flyoutSelectedDevices).length > 0 ? Object.keys(flyoutSelectedDevices).length : '' }}
              device{{ Object.keys(flyoutSelectedDevices).length !== 1 ? 's' : '' }}
            </button>
          </div>
        </template>

      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type Component, type ComponentRef, type Tenant, type Device } from '../api';
import ComponentVariablePrompt from '../components/ComponentVariablePrompt.vue';

const router = useRouter();
const route  = useRoute();

const name        = ref('');
const description = ref('');
const busy        = ref(false);
const formError   = ref('');

// ── Data ─────────────────────────────────────────────────────────

const library      = ref<Component[]>([]);
const storeLibrary = ref<Component[]>([]);
const tenants      = ref<Tenant[]>([]);
const devices      = ref<Device[]>([]);

// ── Components ────────────────────────────────────────────────────

const orderedIds      = ref<string[]>([]);
const compFlyoutOpen  = ref(false);
const compFlyoutTab   = ref<'library' | 'store'>('library');
const compFlyoutQuery = ref('');

const variableValues = reactive<Record<string, Record<string, string>>>({});
const promptRefs: Record<string, { validate: () => string | null } | null> = {};

function setPromptRef(id: string, el: { validate: () => string | null } | null) {
  promptRefs[id] = el;
}

function nameFor(id: string) { return library.value.find(c => c.id === id)?.name ?? id; }
function varsFor(id: string) { return library.value.find(c => c.id === id)?.variables ?? []; }

const orderedRefs = computed<ComponentRef[]>(() =>
  orderedIds.value.map((id, i) => ({
    type: 'library', component_id: id, order: i + 1,
    variable_values: variableValues[id],
  }))
);

const compFlyoutMatches = computed(() => {
  const src = compFlyoutTab.value === 'store' ? storeLibrary.value : library.value;
  const q = compFlyoutQuery.value.trim().toLowerCase();
  return q ? src.filter(c => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)) : src;
});

function openCompFlyout() {
  compFlyoutQuery.value = '';
  compFlyoutTab.value   = 'library';
  compFlyoutOpen.value  = true;
}
function addComponent(c: Component) {
  if (!orderedIds.value.includes(c.id)) orderedIds.value.push(c.id);
}
function removeAt(idx: number) { orderedIds.value.splice(idx, 1); }
function moveUp(idx: number) {
  if (idx === 0) return;
  [orderedIds.value[idx - 1], orderedIds.value[idx]] = [orderedIds.value[idx], orderedIds.value[idx - 1]];
}
function moveDown(idx: number) {
  if (idx >= orderedIds.value.length - 1) return;
  [orderedIds.value[idx + 1], orderedIds.value[idx]] = [orderedIds.value[idx], orderedIds.value[idx + 1]];
}

// ── Targets ───────────────────────────────────────────────────────

type TargetItem =
  | { kind: 'all' }
  | { kind: 'company'; id: string; name: string }
  | { kind: 'device';  id: string; hostname: string }

const targetItems     = ref<TargetItem[]>([]);
const targetFlyoutOpen = ref(false);
type FlyoutStep = '' | 'company' | 'devices';
const flyoutStep = ref<FlyoutStep>('');

const flyoutCompanyQuery     = ref('');
const flyoutSelectedCompanies = reactive<Record<string, string>>({}); // id → name
const flyoutDeviceQuery      = ref('');
const flyoutSelectedDevices  = reactive<Record<string, string>>({}); // id → hostname

const flyoutCompanyMatches = computed(() => {
  const q = flyoutCompanyQuery.value.toLowerCase();
  return tenants.value.filter(t => !q || t.name.toLowerCase().includes(q));
});

const flyoutDeviceMatches = computed(() => {
  const q = flyoutDeviceQuery.value.toLowerCase();
  return devices.value.filter(d =>
    !q ||
    (d.hostname ?? '').toLowerCase().includes(q) ||
    (d.tenantName ?? '').toLowerCase().includes(q)
  );
});

function openTargetFlyout() {
  flyoutCompanyQuery.value = '';
  flyoutDeviceQuery.value  = '';
  Object.keys(flyoutSelectedCompanies).forEach(k => delete flyoutSelectedCompanies[k]);
  Object.keys(flyoutSelectedDevices).forEach(k => delete flyoutSelectedDevices[k]);

  const existing = targetItems.value;
  if (existing.length && existing[0].kind === 'company') {
    existing.forEach(t => { if (t.kind === 'company') flyoutSelectedCompanies[t.id] = t.name; });
    flyoutStep.value = 'company';
  } else if (existing.length && existing[0].kind === 'device') {
    existing.forEach(t => { if (t.kind === 'device') flyoutSelectedDevices[t.id] = t.hostname; });
    flyoutStep.value = 'devices';
  } else {
    flyoutStep.value = '';
  }
  targetFlyoutOpen.value = true;
}
function closeTargetFlyout() { targetFlyoutOpen.value = false; }

function addAllDevices() {
  targetItems.value = [{ kind: 'all' }];
  closeTargetFlyout();
}
function toggleFlyoutCompany(id: string, name: string) {
  if (flyoutSelectedCompanies[id]) delete flyoutSelectedCompanies[id];
  else flyoutSelectedCompanies[id] = name;
}
function addCompanyTargets() {
  targetItems.value = Object.entries(flyoutSelectedCompanies).map(([id, name]) => ({ kind: 'company' as const, id, name }));
  closeTargetFlyout();
}
function toggleFlyoutDevice(id: string, hostname: string) {
  if (flyoutSelectedDevices[id]) delete flyoutSelectedDevices[id];
  else flyoutSelectedDevices[id] = hostname;
}
function addDeviceTargets() {
  targetItems.value = Object.entries(flyoutSelectedDevices).map(([id, hostname]) => ({ kind: 'device' as const, id, hostname }));
  closeTargetFlyout();
}
function removeTargetItem(i: number) { targetItems.value.splice(i, 1); }

function targetLabel(t: TargetItem): string {
  if (t.kind === 'all') return 'All Devices';
  if (t.kind === 'company') return t.name;
  return t.hostname;
}

const resolvedDeviceCount = computed<number | null>(() => {
  if (!targetItems.value.length) return null;
  const first = targetItems.value[0];
  if (first.kind === 'all') return devices.value.length;
  if (first.kind === 'company') {
    const ids = new Set(targetItems.value.filter(t => t.kind === 'company').map(t => (t as any).id));
    return devices.value.filter(d => ids.has(d.tenantId)).length;
  }
  return targetItems.value.length;
});
const zeroDeviceWarning = computed(() => resolvedDeviceCount.value === 0);

// ── Schedule ──────────────────────────────────────────────────────

type Recurrence = 'immediately' | 'scheduled';
const recurrence       = ref<Recurrence>('immediately');
const scheduledAtLocal = ref('');
const expirationChoice = ref<'none' | '3600' | '14400' | '86400'>('none');

// ── Submit ────────────────────────────────────────────────────────

function validate(): string | null {
  if (!name.value.trim()) return 'Name is required';
  if (!orderedIds.value.length) return 'Add at least one component';
  if (!targetItems.value.length) return 'Add at least one target';
  if (recurrence.value === 'scheduled') {
    if (!scheduledAtLocal.value) return 'Choose a start time';
    const ts = new Date(scheduledAtLocal.value).getTime();
    if (Number.isNaN(ts)) return 'Invalid scheduled date/time';
    if (ts <= Date.now()) return 'Scheduled time must be in the future';
  }
  for (const id of orderedIds.value) {
    const err = promptRefs[id]?.validate();
    if (err) return err;
  }
  return null;
}

async function submit() {
  const err = validate();
  if (err) { formError.value = err; return; }

  busy.value = true;
  formError.value = '';
  try {
    const first = targetItems.value[0];
    const target_type: 'all' | 'tenants' | 'devices' =
      first.kind === 'company' ? 'tenants' :
      first.kind === 'device'  ? 'devices' : 'all';
    const target_ids =
      target_type === 'tenants' ? targetItems.value.filter(t => t.kind === 'company').map(t => (t as any).id) :
      target_type === 'devices' ? targetItems.value.filter(t => t.kind === 'device').map(t => (t as any).id) :
      [];

    const jobType: 'quick' | 'scheduled' = recurrence.value === 'scheduled' ? 'scheduled' : 'quick';
    const baseTime = recurrence.value === 'scheduled'
      ? Math.floor(new Date(scheduledAtLocal.value).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const scheduled_at = recurrence.value === 'scheduled' ? baseTime : undefined;
    const expires_at   = expirationChoice.value !== 'none' ? baseTime + Number(expirationChoice.value) : undefined;

    await api.jobs.create({
      name:          name.value.trim(),
      description:   description.value.trim() || undefined,
      type:          jobType,
      components:    orderedRefs.value,
      target_type,
      target_ids,
      scheduled_at,
      expires_at,
      run_as_system: true,
    });
    router.push('/jobs');
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const [comps, storeComps, tenantList, deviceList] = await Promise.all([
    api.components.list(),
    api.components.store.list(),
    api.tenants.list(),
    api.devices.list('approved'),
  ]);
  library.value      = comps;
  storeLibrary.value = storeComps;
  tenants.value = tenantList;
  devices.value = deviceList;

  const preselect = route.query.components;
  if (typeof preselect === 'string' && preselect) {
    orderedIds.value = preselect.split(',').filter(id => library.value.some(c => c.id === id));
  }
});
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* Breadcrumb */
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* Top bar */
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
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

/* Body / form groups */
.pf-body { display: flex; flex-direction: column; }
.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--border); max-width: 760px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--text); }
.jf-sublabel { font-size: 13px; font-weight: 600; color: var(--text); display: block; }
.pf-input {
  width: 100%; max-width: 480px; padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.field-hint { font-size: 11px; color: var(--muted); margin: 0; }
.field-hint-warn {
  color: var(--amber); background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2); border-radius: 5px; padding: 6px 10px;
}

/* Segmented bar */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn { padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font); background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer; transition: background .12s, color .12s; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }
.seg-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Component / target table */
.jf-table { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.jf-thead { display: flex; align-items: center; padding: 7px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.jf-th { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.jf-row { display: flex; align-items: center; border-bottom: 1px solid var(--border); }
.jf-row:last-of-type { border-bottom: none; }
.jf-td { padding: 9px 14px; font-size: 13px; color: var(--text); display: flex; align-items: center; }
.jf-td-actions { gap: 4px; }
.jf-footer { padding: 9px 14px; border-top: 1px solid var(--border); }

/* Empty state */
.jf-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 20px; text-align: center; }
.jf-empty p { font-size: 12px; color: var(--muted); max-width: 360px; line-height: 1.6; margin: 0; }

/* Component-specific */
.jf-order {
  width: 18px; height: 18px; border-radius: 4px; background: var(--surface-2); color: var(--muted-2);
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.jf-var-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px; background: rgba(78,126,247,.12); color: var(--accent); }
.jf-muted { font-size: 12px; color: var(--muted-2); }
.jf-vars-row { padding: 4px 14px 12px 40px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.jf-vars-row:last-child { border-bottom: none; }

/* Component search picker row */
.jf-picker-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }

/* Target kind tag */
.jf-kind-tag { font-size: 10px; font-weight: 700; color: var(--muted-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; }

/* Combobox */
.pf-site-wrap { position: relative; }
.pf-site-input { max-width: none; }
.pf-site-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden; max-height: 220px; overflow-y: auto;
}
.pf-site-opt {
  padding: 8px 12px; font-size: 13px; color: var(--text); cursor: pointer;
  display: flex; align-items: center; gap: 8px; transition: background .08s;
}
.pf-site-opt:hover { background: var(--surface-2); }

/* Utility buttons */
.btn-text { background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font); color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s; }
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }
.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-2);
  background: var(--surface-2); color: var(--muted-2); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s; flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--border); color: var(--text); }
.btn-icon:disabled { opacity: .3; cursor: not-allowed; }

/* ── Target flyout ── */
.tf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 500;
  display: flex; align-items: stretch; justify-content: flex-end;
}
.tf-panel {
  display: flex; flex-direction: column;
  width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.tf-head { display: flex; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tf-title { font-size: 15px; font-weight: 600; color: var(--text); flex: 1; margin: 0; }
.tf-close {
  background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s;
}
.tf-close:hover { background: var(--surface-2); color: var(--text); }

/* Type picker options */
.tf-options { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
.tf-opt {
  display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; text-align: left;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  cursor: pointer; font-family: var(--font); transition: border-color .12s, background .12s;
}
.tf-opt:hover { border-color: var(--accent); background: rgba(78,126,247,.05); }
.tf-opt-name { font-size: 13px; font-weight: 600; color: var(--text); }
.tf-opt-desc { font-size: 11px; color: var(--muted); }

/* Search + list (company/device steps) */
.tf-search { padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tf-list { flex: 1; overflow-y: auto; }
.tf-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 1px solid var(--border); cursor: pointer; transition: background .08s;
  font-size: 13px; color: var(--text);
}
.tf-row:last-child { border-bottom: none; }
.tf-row:hover { background: var(--surface-2); }
.tf-row-selected { background: rgba(78,126,247,.06); }
.tf-row-info { display: flex; flex-direction: column; gap: 1px; }
.tf-row-sub { font-size: 11px; color: var(--muted-2); }
.tf-empty-msg { padding: 20px 16px; font-size: 13px; color: var(--muted); text-align: center; }
.tf-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }

/* ── Component flyout (wider than target flyout) ── */
.cf-panel { width: 520px; }
.cf-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.cf-tab {
  flex: 1; padding: 10px 14px; font-size: 12px; font-weight: 600; font-family: var(--font);
  color: var(--muted-2); background: none; border: none; cursor: pointer;
  border-bottom: 2px solid transparent; transition: color .12s, border-color .12s;
}
.cf-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.cf-count { font-size: 10px; font-weight: 700; background: var(--border-2); color: var(--muted); padding: 1px 5px; border-radius: 3px; margin-left: 5px; }
.cf-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); transition: background .08s; }
.cf-row:last-child { border-bottom: none; }
.cf-row:hover { background: var(--surface-2); }
.cf-row-icon { width: 28px; height: 28px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--muted-2); flex-shrink: 0; }
.cf-row-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cf-row-name { font-size: 13px; color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-row-desc { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-row-added { background: rgba(78,126,247,.07); border-left: 2px solid var(--accent); }
.cf-row-added .cf-row-icon { border-color: rgba(78,126,247,.4); color: var(--accent); }
.cf-add-btn { flex-shrink: 0; }
.cf-check { width: 28px; display: flex; align-items: center; justify-content: center; color: var(--teal); flex-shrink: 0; }
</style>
