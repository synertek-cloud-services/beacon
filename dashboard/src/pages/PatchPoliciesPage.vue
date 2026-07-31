<template>
  <div class="gp-page">

    <div class="gp-header">
      <h1 class="gp-title">Patch Policies</h1>
      <div class="gp-header-actions">
        <button class="btn btn-primary btn-sm" @click="router.push('/global/patch-policies/new')">Create Policy</button>
      </div>
    </div>

    <div class="gp-content">
      <div class="gp-toolbar">
        <span class="row-count-label">Policies <span class="row-count-badge">{{ policies.length }}</span></span>
        <div class="toolbar-sep"></div>
        <button class="btn btn-ghost btn-xs" :disabled="selectedIds.size !== 1" @click="editSelected">Edit</button>
        <button class="btn btn-ghost btn-xs" :disabled="selectedIds.size === 0" @click="bulkDelete">Delete</button>
      </div>

      <div v-if="loading" class="gp-state">Loading…</div>
      <div v-else-if="policies.length === 0" class="gp-state">No patch policies configured.</div>

      <div v-else class="table-wrap">
        <table class="policy-table">
          <thead>
            <tr>
              <th class="col-check">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              </th>
              <th class="col-name">Name</th>
              <th class="col-targets">Targets</th>
              <th class="col-schedule">Schedule</th>
              <th class="col-severity">Auto-Approve</th>
              <th class="col-reboot">Auto Reboot</th>
              <th class="col-enabled">Enabled</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="policy in policies" :key="policy.id"
              :class="['policy-row', { selected: selectedIds.has(policy.id) }]"
              @click="router.push('/global/patch-policies/' + policy.id)"
            >
              <td class="col-check" @click.stop>
                <input type="checkbox" :checked="selectedIds.has(policy.id)" @change="toggleSelect(policy.id)" />
              </td>
              <td class="col-name">
                <span class="policy-link">{{ policy.name }}</span>
                <div v-if="policy.description" class="policy-desc">{{ policy.description }}</div>
              </td>
              <td class="col-targets">{{ targetSummary(policy) }}</td>
              <td class="col-schedule">{{ scheduleSummary(policy) }}</td>
              <td class="col-severity">{{ policy.minSeverity ?? 'Off' }}</td>
              <td class="col-reboot">{{ policy.autoReboot ? 'On' : 'Off' }}</td>
              <td class="col-enabled" @click.stop>
                <button :class="['toggle-btn', { enabled: policy.enabled }]" @click="togglePolicy(policy)">
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type PatchPolicy } from '../api';

const router = useRouter();

const loading    = ref(false);
const policies   = ref<PatchPolicy[]>([]);
const selectedIds = ref(new Set<string>());

const allSelected = computed(() =>
  policies.value.length > 0 && policies.value.every(p => selectedIds.value.has(p.id)));

async function load() {
  loading.value = true;
  try { policies.value = await api.patchPolicies.list(); }
  catch { policies.value = []; }
  finally { loading.value = false; }
}

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selectedIds.value = s;
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(policies.value.map(p => p.id));
}

function editSelected() {
  if (selectedIds.value.size !== 1) return;
  router.push('/global/patch-policies/' + [...selectedIds.value][0]);
}

async function bulkDelete() {
  const ids = [...selectedIds.value];
  if (!ids.length || !confirm(`Delete ${ids.length} ${ids.length === 1 ? 'policy' : 'policies'}?`)) return;
  try {
    await Promise.all(ids.map(id => api.patchPolicies.delete(id)));
    policies.value = policies.value.filter(p => !ids.includes(p.id));
    const next = new Set(selectedIds.value);
    ids.forEach(id => next.delete(id));
    selectedIds.value = next;
  } catch { /* best-effort */ }
}

async function togglePolicy(policy: PatchPolicy) {
  try {
    await api.patchPolicies.update(policy.id, { enabled: !policy.enabled });
    policy.enabled = !policy.enabled;
  } catch { /* leave as-is on failure */ }
}

function targetSummary(p: PatchPolicy): string {
  const sites = p.siteIds?.length ?? 0, devices = p.deviceIds?.length ?? 0, groups = p.groupIds?.length ?? 0;
  if (sites + devices + groups === 0) return 'All devices';
  const parts: string[] = [];
  if (sites)   parts.push(`${sites} site${sites === 1 ? '' : 's'}`);
  if (devices) parts.push(`${devices} device${devices === 1 ? '' : 's'}`);
  if (groups)  parts.push(`${groups} group${groups === 1 ? '' : 's'}`);
  return parts.join(', ');
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtMinutes(total: number): string {
  const h = Math.floor(total / 60), m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function scheduleSummary(p: PatchPolicy): string {
  if (p.recurrenceType === 'one_time') {
    if (p.oneTimeStartAt == null) return 'One-time';
    const d = new Date(p.oneTimeStartAt * 1000);
    return `One-time, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (!p.weeklyDays || p.weeklyStartMinute == null || p.weeklyDurationMinutes == null) return 'Weekly';
  const days = (JSON.parse(p.weeklyDays) as number[]).sort().map(d => DAY_ABBR[d]).join('/');
  const h = Math.floor(p.weeklyStartMinute / 60), m = p.weeklyStartMinute % 60;
  const time = new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Weekly, ${days} ${time} for ${fmtMinutes(p.weeklyDurationMinutes)}`;
}

onMounted(load);
</script>

<style scoped>
.gp-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.gp-header { display: flex; align-items: center; justify-content: space-between; padding: 0 0 16px 0; flex-shrink: 0; }
.gp-title  { font-size: 20px; font-weight: 700; color: var(--color-text-primary); margin: 0; }

.gp-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; padding-top: 14px; }

.gp-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: var(--color-surface); border: 1px solid var(--color-border);
  border-bottom: none; flex-shrink: 0; border-radius: 7px 7px 0 0;
}
.row-count-label { font-size: 12px; font-weight: 600; color: var(--color-text-muted); white-space: nowrap; }
.row-count-badge {
  display: inline-block; margin-left: 5px; padding: 1px 6px; border-radius: 8px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border);
  font-size: 11px; font-weight: 700; color: var(--color-text-primary);
}
.toolbar-sep { width: 1px; height: 16px; background: var(--color-border); margin: 0 4px; }

.btn-xs {
  padding: 3px 10px; font-size: 12px; font-family: var(--font); font-weight: 500;
  border-radius: 4px; cursor: pointer; border: 1px solid var(--color-border);
  background: var(--color-surface-raised); color: var(--color-text-primary); transition: background .1s, color .1s, opacity .1s;
}
.btn-xs:hover:not(:disabled) { background: var(--color-border); }
.btn-xs:disabled { opacity: .38; cursor: default; }

.gp-state {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--color-text-muted); padding: 40px;
}

.table-wrap { flex: 1; overflow: auto; border: 1px solid var(--color-border); border-radius: 0 0 7px 7px; }
.policy-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.policy-table thead tr { background: var(--color-surface-raised); position: sticky; top: 0; z-index: 1; }
.policy-table th {
  padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600;
  color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em;
  border-bottom: 1px solid var(--color-border); white-space: nowrap;
}
.col-check    { width: 40px; padding-left: 14px !important; }
.col-name     { min-width: 180px; }
.col-targets  { width: 160px; }
.col-schedule { width: 240px; }
.col-severity { width: 110px; }
.col-reboot   { width: 100px; }
.col-enabled  { width: 80px; text-align: center !important; }

.policy-row td { padding: 10px 12px; border-bottom: 1px solid var(--color-border); color: var(--color-text-primary); vertical-align: middle; }
.policy-row:last-child td { border-bottom: none; }
.policy-row { cursor: pointer; }
.policy-row:hover td { background: rgba(255,255,255,.025); }
.policy-row.selected td { background: rgba(78,126,247,.07); }
.col-check td { padding-left: 14px; }
.col-enabled td { text-align: center; }

.policy-link { font-size: 13px; font-weight: 600; color: var(--color-primary); }
.policy-row:hover .policy-link { text-decoration: underline; }
.policy-desc { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

.toggle-btn { background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0; }
.toggle-track {
  display: block; width: 28px; height: 16px; border-radius: 8px;
  background: var(--color-border); position: relative; transition: background .15s;
}
.toggle-btn.enabled .toggle-track { background: var(--color-primary); }
.toggle-thumb {
  display: block; width: 12px; height: 12px; border-radius: 6px;
  background: #fff; position: absolute; top: 2px; left: 2px;
  transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3);
}
.toggle-btn.enabled .toggle-thumb { left: 14px; }
</style>
