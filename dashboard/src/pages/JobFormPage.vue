<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/jobs" class="pf-crumb-link">Jobs</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">Create a Job</span>
    </nav>

    <!-- Top bar -->
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
        <div class="pf-monitors">
          <div v-if="!orderedIds.length" class="pf-mon-empty">
            <p>Components are your scripts or application installers. You can create your own or download them from the ComStore.</p>
          </div>
          <template v-else>
            <div v-for="(id, idx) in orderedIds" :key="id" class="pf-comp-row">
              <div class="pf-comp-row-head">
                <span class="pf-comp-order">{{ idx + 1 }}</span>
                <span class="pf-mon-desc">{{ nameFor(id) }}</span>
                <div class="pf-mon-actions">
                  <button class="btn-icon" :disabled="idx === 0" @click="moveUp(idx)" title="Move up">↑</button>
                  <button class="btn-icon" :disabled="idx === orderedIds.length - 1" @click="moveDown(idx)" title="Move down">↓</button>
                  <button class="btn-text danger" @click="removeAt(idx)">Remove</button>
                </div>
              </div>
              <div v-if="varsFor(id).length" class="pf-comp-vars">
                <ComponentVariablePrompt
                  :ref="(el: any) => setPromptRef(id, el)"
                  :variables="varsFor(id)"
                  :values="variableValues[id] ?? {}"
                  @update:values="v => { variableValues[id] = v }"
                />
              </div>
            </div>
          </template>
          <div class="pf-mon-add">
            <div class="pf-site-wrap">
              <input
                v-model="compQuery" class="pf-input pf-site-input" placeholder="Search components to add…"
                @focus="compOpen = true" @blur="hideCompDrop"
              />
              <div v-if="compOpen && compMatches.length" class="pf-site-drop">
                <div v-for="c in compMatches" :key="c.id" class="pf-site-opt" @mousedown.prevent="addComponent(c)">
                  {{ c.name }} <span class="text-xs text-muted-2">{{ c.shell }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Targets -->
      <div class="pf-group">
        <label class="pf-label">Targets</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: targetType === 'all' }]" @click="targetType = 'all'">All Devices</button>
          <button :class="['seg-btn', { active: targetType === 'tenants' }]" @click="targetType = 'tenants'">A Company</button>
          <button :class="['seg-btn', { active: targetType === 'devices' }]" @click="targetType = 'devices'">Specific Devices</button>
        </div>

        <!-- Company picker -->
        <div v-if="targetType === 'tenants'" class="pf-site-wrap" style="margin-top:10px;max-width:340px">
          <input
            v-model="companyQuery" class="pf-input pf-site-input" placeholder="Enter company name…"
            @focus="companyOpen = true" @blur="hideCompanyDrop"
          />
          <div v-if="companyOpen && companyMatches.length" class="pf-site-drop">
            <div v-for="t in companyMatches" :key="t.id" class="pf-site-opt" @mousedown.prevent="selectCompany(t)">{{ t.name }}</div>
          </div>
        </div>

        <!-- Specific devices -->
        <div v-if="targetType === 'devices'" style="margin-top:10px">
          <input v-model="deviceSearch" class="pf-input" placeholder="Search devices…" style="margin-bottom:8px;max-width:340px" />
          <div class="pf-monitors" style="max-height:240px;overflow-y:auto">
            <label v-for="d in filteredDevices" :key="d.id" class="pf-mon-row" style="cursor:pointer">
              <input type="checkbox" :checked="!!selectedDevices[d.id]" @change="toggleDevice(d.id)" />
              <span class="mono text-sm">{{ d.hostname ?? d.id.slice(0, 8) }}</span>
              <span class="text-xs text-muted-2">{{ d.tenantName }}</span>
            </label>
            <div v-if="filteredDevices.length === 0" class="pf-mon-empty"><p>No matching devices.</p></div>
          </div>
        </div>

        <p v-if="zeroDeviceWarning" class="field-hint field-hint-warn">
          This target currently resolves to 0 approved devices.
        </p>
      </div>

      <!-- Schedule -->
      <div class="pf-group">
        <label class="pf-label">Schedule</label>
        <p class="field-hint">
          By default, offline devices queue until they come online or the job expires — we run this job as soon as possible after the configured start time.
        </p>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: recurrence === 'immediately' }]" @click="recurrence = 'immediately'">Immediately</button>
          <button :class="['seg-btn', { active: recurrence === 'scheduled' }]" @click="recurrence = 'scheduled'">At a scheduled time</button>
        </div>

        <template v-if="recurrence === 'scheduled'">
          <div style="margin-top:10px;max-width:280px">
            <input type="datetime-local" v-model="scheduledAtLocal" class="pf-input" />
          </div>

          <div style="margin-top:14px">
            <label class="pf-label" style="font-size:13px">Expiration</label>
            <select v-model="expirationChoice" class="pf-input" style="max-width:240px;margin-top:6px">
              <option value="none">No expiration</option>
              <option value="3600">1 hour after start</option>
              <option value="14400">4 hours after start</option>
              <option value="86400">24 hours after start</option>
            </select>
            <p class="field-hint">If this job hasn't started running by then, it's cancelled instead of running late.</p>
          </div>
        </template>
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

// ── Components ──────────────────────────────────────────────────

const library    = ref<Component[]>([]);
const orderedIds = ref<string[]>([]);
const compQuery  = ref('');
const compOpen   = ref(false);

const orderedRefs = computed<ComponentRef[]>(() =>
  orderedIds.value.map((id, i) => ({
    type: 'library', component_id: id, order: i + 1,
    variable_values: variableValues[id],
  }))
);

function nameFor(id: string): string {
  return library.value.find(c => c.id === id)?.name ?? id;
}

// ── Input variables ─────────────────────────────────────────────

const variableValues = reactive<Record<string, Record<string, string>>>({});
const promptRefs: Record<string, { validate: () => string | null } | null> = {};

function setPromptRef(id: string, el: { validate: () => string | null } | null) {
  promptRefs[id] = el;
}

function varsFor(id: string) {
  return library.value.find(c => c.id === id)?.variables ?? [];
}

const compMatches = computed(() => {
  const already = new Set(orderedIds.value);
  let list = library.value.filter(c => !already.has(c.id));
  const q = compQuery.value.trim().toLowerCase();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q));
  return list.slice(0, 10);
});

function addComponent(c: Component) {
  orderedIds.value.push(c.id);
  compQuery.value = '';
  compOpen.value  = false;
}
function removeAt(idx: number) { orderedIds.value.splice(idx, 1); }
function moveUp(idx: number) {
  if (idx === 0) return;
  const arr = orderedIds.value;
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
}
function moveDown(idx: number) {
  const arr = orderedIds.value;
  if (idx >= arr.length - 1) return;
  [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
}
function hideCompDrop() { setTimeout(() => { compOpen.value = false; }, 150); }

// ── Target ──────────────────────────────────────────────────────

type TargetType = 'all' | 'tenants' | 'devices';
const targetType = ref<TargetType>('all');

const tenants           = ref<Tenant[]>([]);
const companyQuery      = ref('');
const companyOpen       = ref(false);
const selectedCompanyId = ref<string | null>(null);

const companyMatches = computed(() => {
  if (!companyQuery.value.trim()) return tenants.value.slice(0, 10);
  const q = companyQuery.value.toLowerCase();
  return tenants.value.filter(t => t.name.toLowerCase().includes(q)).slice(0, 10);
});
function selectCompany(t: Tenant) {
  selectedCompanyId.value = t.id;
  companyQuery.value      = t.name;
  companyOpen.value       = false;
}
function hideCompanyDrop() { setTimeout(() => { companyOpen.value = false; }, 150); }

const devices         = ref<Device[]>([]);
const deviceSearch    = ref('');
const selectedDevices = reactive<Record<string, boolean>>({});

const filteredDevices = computed(() => {
  const q = deviceSearch.value.trim().toLowerCase();
  if (!q) return devices.value;
  return devices.value.filter(d =>
    (d.hostname ?? '').toLowerCase().includes(q) ||
    (d.tenantName ?? '').toLowerCase().includes(q)
  );
});
function toggleDevice(id: string) {
  if (selectedDevices[id]) delete selectedDevices[id];
  else selectedDevices[id] = true;
}

// null = target not yet meaningfully selected (no warning); 0 = resolves to
// nothing (warn) — mirrors the equivalent check the old CreateJobModal had.
const resolvedDeviceCount = computed<number | null>(() => {
  if (targetType.value === 'all') return devices.value.length;
  if (targetType.value === 'tenants')
    return selectedCompanyId.value ? devices.value.filter(d => d.tenantId === selectedCompanyId.value).length : null;
  if (targetType.value === 'devices') {
    const n = Object.keys(selectedDevices).length;
    return n > 0 ? n : null;
  }
  return null;
});
const zeroDeviceWarning = computed(() => resolvedDeviceCount.value === 0);

// ── Schedule ────────────────────────────────────────────────────

type Recurrence = 'immediately' | 'scheduled';
const recurrence        = ref<Recurrence>('immediately');
const scheduledAtLocal  = ref('');
const expirationChoice  = ref<'none' | '3600' | '14400' | '86400'>('3600');

// ── Submit ──────────────────────────────────────────────────────

function validate(): string | null {
  if (!name.value.trim()) return 'Name is required';
  if (orderedIds.value.length === 0) return 'Add at least one component';
  if (targetType.value === 'tenants' && !selectedCompanyId.value) return 'Select a company';
  if (targetType.value === 'devices' && Object.keys(selectedDevices).length === 0) return 'Select at least one device';

  if (recurrence.value === 'scheduled') {
    if (!scheduledAtLocal.value) return 'Choose a date and time to run this job';
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

  busy.value      = true;
  formError.value = '';
  try {
    const target_ids =
      targetType.value === 'tenants' ? [selectedCompanyId.value!] :
      targetType.value === 'devices' ? Object.keys(selectedDevices) :
      [];

    let scheduled_at: number | undefined;
    let expires_at:   number | undefined;
    const jobType: 'quick' | 'scheduled' = recurrence.value === 'scheduled' ? 'scheduled' : 'quick';
    if (recurrence.value === 'scheduled') {
      scheduled_at = Math.floor(new Date(scheduledAtLocal.value).getTime() / 1000);
      if (expirationChoice.value !== 'none') {
        expires_at = scheduled_at + Number(expirationChoice.value);
      }
    }

    await api.jobs.create({
      name:          name.value.trim(),
      description:   description.value.trim() || undefined,
      type:          jobType,
      components:    orderedRefs.value,
      target_type:   targetType.value,
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
  const [comps, tenantList, deviceList] = await Promise.all([
    api.components.list(),
    api.tenants.list(),
    api.devices.list('approved'),
  ]);
  library.value = comps;
  tenants.value = tenantList;
  devices.value = deviceList;

  // Pre-populate from ComponentsPage.vue's "Run as Job" action.
  const preselect = route.query.components;
  if (typeof preselect === 'string' && preselect) {
    orderedIds.value = preselect.split(',').filter(id => library.value.some(c => c.id === id));
  }
});
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* ── Breadcrumb ── */
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* ── Top bar ── */
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

/* ── Body ── */
.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--border); max-width: 760px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--text); }
.pf-input {
  width: 100%; max-width: 480px; padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.pf-err { font-size: 11px; color: var(--red); }
.field-hint { font-size: 11px; color: var(--muted); margin: 0; }
.field-hint-warn {
  color: var(--amber); background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2); border-radius: 5px; padding: 6px 10px;
}

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn { padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font); background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer; transition: background .12s, color .12s; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }
.seg-btn:disabled { opacity: .4; cursor: not-allowed; }

/* ── Search comboboxes (component add, company picker) ── */
.pf-site-wrap { position: relative; }
.pf-site-input { max-width: none; }
.pf-site-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden; max-height: 220px; overflow-y: auto;
}
.pf-site-opt {
  padding: 8px 12px; font-size: 13px; color: var(--text); cursor: pointer;
  display: flex; justify-content: space-between; gap: 8px; transition: background .08s;
}
.pf-site-opt:hover { background: var(--surface-2); }

/* ── Components / device "table" containers (reuse monitor-list chrome) ── */
.pf-monitors { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-mon-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--text); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
.pf-mon-add { padding: 10px 14px; border-top: 1px solid var(--border); }

.pf-comp-row { border-bottom: 1px solid var(--border); }
.pf-comp-row:last-of-type { border-bottom: none; }
.pf-comp-row-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 12px; }
.pf-comp-vars { padding: 4px 14px 12px 40px; background: var(--surface-2); }
.pf-comp-order {
  width: 18px; height: 18px; border-radius: 4px; background: var(--surface-2); color: var(--muted-2);
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}

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
</style>
