<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal modal-xl">
      <div class="modal-head">
        <div class="modal-title">Create Job</div>
      </div>

      <div class="modal-body">
        <div class="field">
          <label>Name <span class="required">*</span></label>
          <input v-model="name" type="text" placeholder="e.g. Clear Temp Files — All Devices" />
        </div>
        <div class="field">
          <label>Description</label>
          <input v-model="description" type="text" placeholder="Optional" />
        </div>

        <!-- Components -->
        <div class="field">
          <label>Components <span class="required">*</span></label>
          <div class="cj-comp-list">
            <div v-if="!orderedIds.length" class="cj-empty">No components added yet.</div>
            <div v-for="(id, idx) in orderedIds" :key="id" class="cj-comp-row">
              <span class="cj-comp-order">{{ idx + 1 }}</span>
              <span class="cj-comp-name">{{ nameFor(id) }}</span>
              <div class="cj-comp-actions">
                <button class="btn-icon" :disabled="idx === 0" @click="moveUp(idx)" title="Move up">↑</button>
                <button class="btn-icon" :disabled="idx === orderedIds.length - 1" @click="moveDown(idx)" title="Move down">↓</button>
                <button class="btn-icon" @click="removeAt(idx)" title="Remove">×</button>
              </div>
            </div>
          </div>
          <div class="cj-search-wrap">
            <input
              v-model="compQuery" class="cj-search-input" placeholder="Search components to add…"
              @focus="compOpen = true" @blur="hideCompDrop"
            />
            <div v-if="compOpen && compMatches.length" class="cj-dropdown">
              <div v-for="c in compMatches" :key="c.id" class="cj-dropdown-opt" @mousedown.prevent="addComponent(c)">
                {{ c.name }} <span class="text-xs text-muted-2">{{ c.shell }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Target -->
        <div class="field">
          <label>Target</label>
          <div class="seg-bar">
            <button :class="['seg-btn', { active: targetType === 'all' }]" @click="targetType = 'all'">All Devices</button>
            <button :class="['seg-btn', { active: targetType === 'tenants' }]" @click="targetType = 'tenants'">A Company</button>
            <button :class="['seg-btn', { active: targetType === 'devices' }]" @click="targetType = 'devices'">Specific Devices</button>
          </div>

          <!-- Company picker -->
          <div v-if="targetType === 'tenants'" class="cj-search-wrap" style="margin-top:10px;max-width:340px">
            <input
              v-model="companyQuery" class="cj-search-input" placeholder="Enter company name…"
              @focus="companyOpen = true" @blur="hideCompanyDrop"
            />
            <div v-if="companyOpen && companyMatches.length" class="cj-dropdown">
              <div v-for="t in companyMatches" :key="t.id" class="cj-dropdown-opt" @mousedown.prevent="selectCompany(t)">{{ t.name }}</div>
            </div>
          </div>

          <!-- Specific devices -->
          <div v-if="targetType === 'devices'" class="cj-device-picker">
            <input v-model="deviceSearch" class="cj-search-input" placeholder="Search devices…" style="margin-bottom:8px" />
            <div class="cj-device-list">
              <label v-for="d in filteredDevices" :key="d.id" class="cj-device-row">
                <input type="checkbox" :checked="!!selectedDevices[d.id]" @change="toggleDevice(d.id)" />
                <span class="mono">{{ d.hostname ?? d.id.slice(0, 8) }}</span>
                <span class="text-xs text-muted-2">{{ d.tenantName }}</span>
              </label>
              <div v-if="filteredDevices.length === 0" class="cj-empty">No matching devices.</div>
            </div>
          </div>

          <p v-if="zeroDeviceWarning" class="field-hint field-hint-warn">
            This target currently resolves to 0 approved devices.
          </p>
        </div>
      </div>

      <div v-if="formError" class="error-banner" style="margin:0 20px 12px">{{ formError }}</div>
      <div class="modal-foot">
        <button class="btn btn-ghost" @click="$emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="submit">
          {{ busy ? 'Creating…' : 'Create Job' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { api, type Component, type ComponentRef, type Job, type Tenant, type Device } from '../api';

const props = defineProps<{ initialComponents?: Component[] }>();
const emit = defineEmits<{ created: [Job]; close: [] }>();

const name        = ref('');
const description = ref('');
const busy        = ref(false);
const formError   = ref('');

// ── Components ──────────────────────────────────────────────────

const library    = ref<Component[]>([]);
const orderedIds = ref<string[]>((props.initialComponents ?? []).map(c => c.id));
const compQuery  = ref('');
const compOpen   = ref(false);

const orderedRefs = computed<ComponentRef[]>(() =>
  orderedIds.value.map((id, i) => ({ type: 'library', component_id: id, order: i + 1 }))
);

function nameFor(id: string): string {
  return library.value.find(c => c.id === id)?.name
    ?? props.initialComponents?.find(c => c.id === id)?.name
    ?? id;
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

const tenants          = ref<Tenant[]>([]);
const companyQuery     = ref('');
const companyOpen      = ref(false);
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

const devices        = ref<Device[]>([]);
const deviceSearch   = ref('');
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
// nothing (warn); the backend only 400s on a zero match for target_type
// 'devices', not 'tenants'/'all', so this covers the gap client-side.
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

// ── Submit ──────────────────────────────────────────────────────

function validate(): string | null {
  if (!name.value.trim()) return 'Name is required';
  if (orderedIds.value.length === 0) return 'Add at least one component';
  if (targetType.value === 'tenants' && !selectedCompanyId.value) return 'Select a company';
  if (targetType.value === 'devices' && Object.keys(selectedDevices).length === 0) return 'Select at least one device';
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

    const job = await api.jobs.create({
      name:        name.value.trim(),
      description: description.value.trim() || undefined,
      type:        'quick',
      components:  orderedRefs.value,
      target_type: targetType.value,
      target_ids,
    });
    emit('created', job);
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
});
</script>

<style scoped>
/* ── Modal shell — duplicated per this codebase's established convention,
   not actually shared globally despite living in multiple pages ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border-2); border-radius: 10px;
  width: 440px; box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden;
  max-height: 90vh; display: flex; flex-direction: column;
}
.modal-xl { width: 860px; }
.modal-head {
  padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.required { color: var(--red); }

/* ── Segmented target picker (copied from PolicyFormPage.vue) ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }

/* ── Search comboboxes (component add, company picker) ── */
.cj-search-wrap { position: relative; margin-top: 8px; }
.cj-search-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border-2); border-radius: 6px;
  background: var(--surface); color: var(--text); font-size: 13px; font-family: var(--font);
}
.cj-search-input:focus { outline: none; border-color: var(--accent); }
.cj-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden; max-height: 220px; overflow-y: auto;
}
.cj-dropdown-opt {
  padding: 8px 12px; font-size: 13px; color: var(--text); cursor: pointer;
  display: flex; justify-content: space-between; gap: 8px;
  transition: background .08s;
}
.cj-dropdown-opt:hover { background: var(--surface-2); }

/* ── Ordered component list ── */
.cj-comp-list { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.cj-comp-row {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); font-size: 13px;
}
.cj-comp-row:last-child { border-bottom: none; }
.cj-comp-order {
  width: 18px; height: 18px; border-radius: 4px; background: var(--surface-2); color: var(--muted-2);
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cj-comp-name { flex: 1; color: var(--text); }
.cj-comp-actions { display: flex; gap: 4px; }
.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-2);
  background: var(--surface-2); color: var(--muted-2); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s;
}
.btn-icon:hover:not(:disabled) { background: var(--border); color: var(--text); }
.btn-icon:disabled { opacity: .3; cursor: not-allowed; }

.cj-empty { padding: 14px; font-size: 12px; color: var(--muted); }

/* ── Specific-devices picker ── */
.cj-device-picker { margin-top: 10px; }
.cj-device-list {
  border: 1px solid var(--border); border-radius: 7px; max-height: 220px; overflow-y: auto;
  background: var(--surface);
}
.cj-device-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 12px;
  border-bottom: 1px solid var(--border); font-size: 13px; cursor: pointer;
}
.cj-device-row:last-child { border-bottom: none; }
.cj-device-row:hover { background: var(--surface-2); }

/* ── Field hint (duplicated per-component per this codebase's convention) ── */
.field-hint { display: block; font-size: 11px; color: var(--muted); margin-top: 6px; }
.field-hint-warn {
  color: var(--amber); background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2); border-radius: 5px; padding: 6px 10px;
}
</style>
