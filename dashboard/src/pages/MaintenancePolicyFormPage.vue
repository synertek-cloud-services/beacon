<template>
  <div class="pf-page">

    <nav class="pf-crumb">
      <RouterLink to="/global/maintenance-policies" class="pf-crumb-link">Maintenance Policies</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Create Policy' : 'Edit Policy' }}</span>
    </nav>

    <div class="pf-sticky-bar">
      <div class="pf-topbar">
        <button class="pf-back" @click="router.push('/global/maintenance-policies')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 class="pf-title">{{ isNew ? 'Create Policy' : (form.name || 'Edit Policy') }}</h1>
        <div class="pf-topbar-right">
          <button class="btn btn-ghost btn-sm" @click="router.push('/global/maintenance-policies')">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : (isNew ? 'Create Policy' : 'Save Changes') }}
          </button>
        </div>
      </div>
      <div v-if="loadError" class="error-banner">{{ loadError }}</div>
      <div v-if="saveError" class="error-banner">{{ saveError }}</div>
    </div>

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

      <!-- Schedule -->
      <div class="pf-group">
        <label class="pf-label">Schedule</label>
        <p class="field-hint" style="margin-top:-4px">
          Times below are in the host time zone: <strong>{{ hostTimezone }}</strong>
          (<RouterLink to="/settings/general" class="pf-crumb-link">Settings &gt; General</RouterLink>).
        </p>
        <div class="seg-bar">
          <button :class="['seg-btn', 'seg-primary', { active: form.recurrenceType === 'one_time' }]" @click="form.recurrenceType = 'one_time'">One-time</button>
          <button :class="['seg-btn', 'seg-primary', { active: form.recurrenceType === 'weekly' }]" @click="form.recurrenceType = 'weekly'">Weekly</button>
        </div>

        <template v-if="form.recurrenceType === 'one_time'">
          <div class="sched-row">
            <div class="sched-field">
              <span class="sched-label">Start</span>
              <input type="datetime-local" v-model="form.oneTimeLocal" class="pf-input" style="max-width:260px" />
            </div>
            <div class="sched-field">
              <span class="sched-label">Duration</span>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="number" min="0" v-model.number="form.oneTimeDurationHours" class="pf-input" style="max-width:80px" />
                <span class="text-muted-2">h</span>
                <select v-model.number="form.oneTimeDurationMinutes" class="pf-input" style="max-width:90px">
                  <option v-for="m in [0,15,30,45]" :key="m" :value="m">{{ m }}m</option>
                </select>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="pf-target-sec" style="margin-top:6px">
            <span class="pf-target-label">Days</span>
            <div class="pill-group">
              <label v-for="d in weekdayOptions" :key="d.value" :class="['pill-opt', { active: form.weeklyDays.includes(d.value) }]">
                <input type="checkbox" :value="d.value" v-model="form.weeklyDays" class="pill-cb" />
                {{ d.label }}
              </label>
            </div>
          </div>
          <div class="sched-row" style="margin-top:10px">
            <div class="sched-field">
              <span class="sched-label">Start Time</span>
              <input type="time" v-model="form.weeklyStartTime" class="pf-input" style="max-width:140px" />
            </div>
            <div class="sched-field">
              <span class="sched-label">Duration</span>
              <div style="display:flex;gap:6px;align-items:center">
                <select v-model.number="form.weeklyDurationHours" class="pf-input" style="max-width:80px">
                  <option v-for="h in 24" :key="h-1" :value="h-1">{{ h-1 }}h</option>
                </select>
                <select v-model.number="form.weeklyDurationMinutes" class="pf-input" style="max-width:90px">
                  <option v-for="m in [0,15,30,45]" :key="m" :value="m">{{ m }}m</option>
                </select>
              </div>
            </div>
          </div>
        </template>
        <span v-if="fieldErr.schedule" class="pf-err">{{ fieldErr.schedule }}</span>
      </div>

      <!-- Targets -->
      <div class="pf-group">
        <label class="pf-label">Targets</label>
        <p class="field-hint" style="margin-top:-4px">
          Add Companies, Devices, or Device Groups to restrict this policy — a device qualifies if it matches
          ANY target below (not all of them). Leave empty to target every device.
        </p>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-primary btn-sm" @click="openTargetFlyout">Add Target</button>
          <button class="btn btn-ghost btn-sm" :disabled="targetItems.length === 0" @click="removeAllTargets">Remove all</button>
        </div>
        <div class="pf-monitors" style="margin-top:8px">
          <div v-if="targetItems.length === 0" class="pf-mon-empty">
            <p>No targets selected — this policy targets all devices.</p>
          </div>
          <div v-else v-for="(t, i) in targetItems" :key="i" class="pf-mon-row">
            <span class="pf-mon-desc">{{ targetLabel(t) }}</span>
            <span class="jf-kind-tag">{{ t.kind === 'company' ? 'Company' : t.kind === 'device' ? 'Device' : 'Device Group' }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text danger" @click="removeTargetItem(i)">Remove</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Target flyout -->
      <Teleport to="body">
        <div v-if="targetFlyoutOpen" class="tf-overlay" @click.self="targetFlyoutOpen = false">
          <div class="tf-panel">
            <div class="tf-head">
              <h2 class="tf-title">Targets</h2>
              <button class="tf-close" @click="targetFlyoutOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="tf-cat">
              <select v-model="flyoutCategory" class="pf-input" style="max-width:none">
                <option value="companies">Companies</option>
                <option value="devices">Devices</option>
                <option value="groups">Device Groups</option>
              </select>
            </div>
            <div class="tf-search">
              <input v-model="flyoutSearch" class="pf-input"
                :placeholder="flyoutCategory === 'companies' ? 'Search companies…' : flyoutCategory === 'groups' ? 'Search groups…' : 'Search devices…'"
                style="max-width:none" />
            </div>
            <div class="tf-list">
              <template v-if="flyoutCategory === 'companies'">
                <div v-for="t in flyoutCompanyMatches" :key="t.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('company', t.id) }">
                  <div class="tf-row-info" style="flex:1"><span>{{ t.name }}</span></div>
                  <button v-if="!isTargeted('company', t.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'company',id:t.id,name:t.name})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'company',id:t.id,name:t.name})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutCompanyMatches.length" class="tf-empty-msg">No companies found.</div>
              </template>
              <template v-else-if="flyoutCategory === 'devices'">
                <div v-for="d in flyoutDeviceMatches" :key="d.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('device', d.id) }">
                  <div class="tf-row-info" style="flex:1">
                    <span>{{ d.hostname ?? d.id.slice(0,8) }}</span>
                    <span class="tf-row-sub">{{ d.companyName }}</span>
                  </div>
                  <button v-if="!isTargeted('device', d.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'device',id:d.id,hostname:d.hostname??d.id.slice(0,8)})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'device',id:d.id,hostname:d.hostname??d.id.slice(0,8)})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutDeviceMatches.length" class="tf-empty-msg">No matching devices.</div>
              </template>
              <template v-else>
                <div v-for="g in flyoutGroupMatches" :key="g.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('group', g.id) }">
                  <div class="tf-row-info" style="flex:1">
                    <span>{{ g.name }}</span>
                    <span class="tf-row-sub">{{ g.memberCount }} device{{ g.memberCount === 1 ? '' : 's' }}</span>
                  </div>
                  <button v-if="!isTargeted('group', g.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'group',id:g.id,name:g.name})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'group',id:g.id,name:g.name})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutGroupMatches.length" class="tf-empty-msg">No matching groups.</div>
              </template>
            </div>
            <div class="tf-footer">
              <button class="btn btn-primary btn-sm" @click="targetFlyoutOpen = false">Done</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Enabled -->
      <div class="pf-group">
        <label class="pf-label">Enabled</label>
        <div class="seg-bar">
          <button :class="['seg-btn', 'seg-primary', { active: form.enabled }]" @click="form.enabled = true">Enabled</button>
          <button :class="['seg-btn', { active: !form.enabled }]" @click="form.enabled = false">Disabled</button>
        </div>
      </div>

    </div><!-- /pf-body -->
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type Company, type Device, type DeviceGroup, type MaintenanceRecurrenceType } from '../api';
import { zonedTimeToUtc, utcToZonedInputValue } from '../timezone';

const router = useRouter();
const route  = useRoute();

const policyId = computed(() => route.params.id as string | undefined);
const isNew    = computed(() => !policyId.value);

const loading   = ref(false);
const saving    = ref(false);
const loadError = ref('');
const saveError = ref('');
const companies   = ref<Company[]>([]);
const devices   = ref<Device[]>([]);
const groups    = ref<DeviceGroup[]>([]);
const fieldErr  = reactive({ name: '', schedule: '' });
const hostTimezone = ref('UTC');

const weekdayOptions = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
];

const form = reactive({
  name: '',
  description: '',
  enabled: true,
  recurrenceType: 'one_time' as MaintenanceRecurrenceType,
  oneTimeLocal: '',
  oneTimeDurationHours: 1,
  oneTimeDurationMinutes: 0,
  weeklyDays: [] as number[],
  weeklyStartTime: '20:00',
  weeklyDurationHours: 2,
  weeklyDurationMinutes: 0,
});

// ── Targets: Companies / Devices / Device Groups — same defer-and-batch (new) /
// hit-immediately (existing) split and heterogeneous OR-list shape as
// PolicyFormPage.vue's Targets section (copied verbatim, no OS/Class
// section exists here at all — Maintenance Policy has no such filter). ──
type MaintenanceTargetItem =
  | { kind: 'company';   id: string; name: string }
  | { kind: 'device'; id: string; hostname: string }
  | { kind: 'group';  id: string; name: string };

const targetItems      = ref<MaintenanceTargetItem[]>([]);
const targetFlyoutOpen = ref(false);
const flyoutCategory   = ref<'companies' | 'devices' | 'groups'>('companies');
const flyoutSearch     = ref('');

const flyoutCompanyMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return companies.value.filter(t => !q || t.name.toLowerCase().includes(q));
});
const flyoutDeviceMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return devices.value.filter(d =>
    !q || (d.hostname ?? '').toLowerCase().includes(q) || (d.companyName ?? '').toLowerCase().includes(q));
});
const flyoutGroupMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return groups.value.filter(g => !q || g.name.toLowerCase().includes(q));
});

function isTargeted(kind: string, id: string): boolean {
  return targetItems.value.some(t => t.kind === kind && t.id === id);
}

async function toggleTarget(item: MaintenanceTargetItem) {
  if (isTargeted(item.kind, item.id)) {
    if (!isNew.value && policyId.value) {
      try {
        if (item.kind === 'company')   await api.maintenancePolicies.companies.remove(policyId.value, item.id);
        if (item.kind === 'device') await api.maintenancePolicies.devices.remove(policyId.value, item.id);
        if (item.kind === 'group')  await api.maintenancePolicies.groups.remove(policyId.value, item.id);
      } catch (e: any) { saveError.value = e.message; return; }
    }
    targetItems.value = targetItems.value.filter(t => !(t.kind === item.kind && t.id === item.id));
    return;
  }

  if (!isNew.value && policyId.value) {
    try {
      if (item.kind === 'company')   await api.maintenancePolicies.companies.add(policyId.value, item.id);
      if (item.kind === 'device') await api.maintenancePolicies.devices.add(policyId.value, item.id);
      if (item.kind === 'group')  await api.maintenancePolicies.groups.add(policyId.value, item.id);
    } catch (e: any) { saveError.value = e.message; return; }
  }
  targetItems.value.push(item);
}

function openTargetFlyout() {
  flyoutSearch.value = '';
  targetFlyoutOpen.value = true;
}

async function removeTargetItem(i: number) {
  await toggleTarget(targetItems.value[i]);
}

async function removeAllTargets() {
  if (!isNew.value && policyId.value) {
    for (const t of targetItems.value) {
      try {
        if (t.kind === 'company')   await api.maintenancePolicies.companies.remove(policyId.value, t.id);
        if (t.kind === 'device') await api.maintenancePolicies.devices.remove(policyId.value, t.id);
        if (t.kind === 'group')  await api.maintenancePolicies.groups.remove(policyId.value, t.id);
      } catch { /* best-effort, continue clearing locally */ }
    }
  }
  targetItems.value = [];
}

function targetLabel(t: MaintenanceTargetItem): string {
  if (t.kind === 'company')   return t.name;
  if (t.kind === 'device') return t.hostname;
  return t.name;
}

// ── Load ────────────────────────────────────────────────────────────────────

onMounted(async () => {
  try { companies.value = await api.companies.list(); } catch { /* ok */ }
  try { devices.value = await api.devices.list(); } catch { /* ok */ }
  try { groups.value  = await api.groups.list(); } catch { /* ok */ }
  try { hostTimezone.value = (await api.settings.get()).timezone; } catch { /* falls back to UTC */ }

  if (isNew.value) {
    // Sensible default for a brand-new policy: today, at the current
    // wall-clock minute rounded up, in the host timezone.
    form.oneTimeLocal = utcToZonedInputValue(Math.floor(Date.now() / 1000), hostTimezone.value);
    return;
  }

  loading.value = true;
  try {
    const all    = await api.maintenancePolicies.list();
    const policy = all.find(p => p.id === policyId.value);
    if (!policy) { loadError.value = 'Policy not found.'; return; }

    try {
      const [companies, devs, grps] = await Promise.all([
        api.maintenancePolicies.companies.list(policyId.value!),
        api.maintenancePolicies.devices.list(policyId.value!),
        api.maintenancePolicies.groups.list(policyId.value!),
      ]);
      targetItems.value = [
        ...companies.map(s => ({ kind: 'company' as const, id: s.companyId, name: s.name })),
        ...devs.map(d => ({ kind: 'device' as const, id: d.deviceId, hostname: d.hostname ?? d.deviceId.slice(0, 8) })),
        ...grps.map(g => ({ kind: 'group' as const, id: g.groupId, name: g.name })),
      ];
    } catch { /* ok */ }

    form.name        = policy.name;
    form.description = policy.description ?? '';
    form.enabled     = policy.enabled;
    form.recurrenceType = policy.recurrenceType;

    if (policy.recurrenceType === 'one_time') {
      form.oneTimeLocal = policy.oneTimeStartAt != null
        ? utcToZonedInputValue(policy.oneTimeStartAt, hostTimezone.value)
        : utcToZonedInputValue(Math.floor(Date.now() / 1000), hostTimezone.value);
      const totalMin = policy.oneTimeDurationMinutes ?? 60;
      form.oneTimeDurationHours   = Math.floor(totalMin / 60);
      form.oneTimeDurationMinutes = totalMin % 60;
    } else {
      form.weeklyDays = policy.weeklyDays ? JSON.parse(policy.weeklyDays) : [];
      const startMin = policy.weeklyStartMinute ?? 20 * 60;
      form.weeklyStartTime = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
      const durMin = policy.weeklyDurationMinutes ?? 60;
      form.weeklyDurationHours   = Math.floor(durMin / 60);
      form.weeklyDurationMinutes = durMin % 60;
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load policy.';
  } finally {
    loading.value = false;
  }
});

// ── Save ──────────────────────────────────────────────────────────────────

function buildRecurrenceBody() {
  if (form.recurrenceType === 'one_time') {
    return {
      type: 'one_time' as const,
      one_time_start_at: zonedTimeToUtc(form.oneTimeLocal, hostTimezone.value),
      one_time_duration_minutes: form.oneTimeDurationHours * 60 + form.oneTimeDurationMinutes,
    };
  }
  const [hh, mm] = form.weeklyStartTime.split(':').map(Number);
  return {
    type: 'weekly' as const,
    weekly_days: form.weeklyDays,
    weekly_start_minute: hh * 60 + mm,
    weekly_duration_minutes: form.weeklyDurationHours * 60 + form.weeklyDurationMinutes,
  };
}

function validateSchedule(): string {
  if (form.recurrenceType === 'one_time') {
    if (!form.oneTimeLocal) return 'Start date/time is required.';
    if (form.oneTimeDurationHours * 60 + form.oneTimeDurationMinutes <= 0) return 'Duration must be greater than zero.';
    return '';
  }
  if (form.weeklyDays.length === 0) return 'Select at least one day.';
  const total = form.weeklyDurationHours * 60 + form.weeklyDurationMinutes;
  if (total < 1 || total > 1439) return 'Duration must be between 1 minute and just under 24 hours.';
  return '';
}

async function save() {
  fieldErr.name     = '';
  fieldErr.schedule = '';
  saveError.value   = '';

  if (!form.name.trim()) { fieldErr.name = 'Name is required.'; return; }
  const scheduleErr = validateSchedule();
  if (scheduleErr) { fieldErr.schedule = scheduleErr; return; }

  saving.value = true;
  try {
    if (isNew.value) {
      const policy = await api.maintenancePolicies.create({
        name: form.name,
        description: form.description || null,
        enabled: form.enabled,
        recurrence: buildRecurrenceBody(),
      });
      for (const t of targetItems.value) {
        if (t.kind === 'company')   await api.maintenancePolicies.companies.add(policy.id, t.id);
        if (t.kind === 'device') await api.maintenancePolicies.devices.add(policy.id, t.id);
        if (t.kind === 'group')  await api.maintenancePolicies.groups.add(policy.id, t.id);
      }
    } else if (policyId.value) {
      await api.maintenancePolicies.update(policyId.value, {
        name: form.name,
        description: form.description || null,
        enabled: form.enabled,
        recurrence: buildRecurrenceBody(),
      });
    }
    router.push('/global/maintenance-policies');
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--color-primary); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--color-text-subtle); }

/* Sticky so Save/Cancel and any error feedback stay reachable and visible
   without scrolling on a long form -- position:sticky respects the .page
   scroll container's own padding box, so top:0 alone is enough to pin it
   flush against the visible top edge with no negative-margin trick needed. */
.pf-sticky-bar {
  position: sticky; top: 0; z-index: 20;
  background: var(--color-canvas);
  padding-bottom: 14px; margin-bottom: 14px;
  border-bottom: 1px solid var(--color-border);
}
.pf-sticky-bar .error-banner { margin-top: 12px; }

.pf-topbar { display: flex; align-items: center; gap: 12px; }
.pf-back {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border);
  color: var(--color-text-subtle); cursor: pointer; flex-shrink: 0;
  transition: color .12s, background .12s;
}
.pf-back:hover { color: var(--color-text-primary); background: var(--color-border); }
.pf-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }

.pf-state { padding: 40px; text-align: center; color: var(--color-text-muted); }

.pf-body { display: flex; flex-direction: column; gap: 0; }

.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--color-border); max-width: 760px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-input {
  width: 100%; max-width: 480px; padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-textarea { resize: vertical; min-height: 80px; }
.pf-err { font-size: 11px; color: var(--color-danger); }

.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 6px; }

.seg-bar { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--color-surface-raised); color: var(--color-text-subtle); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--color-border-strong); }
.seg-btn.active { background: var(--color-surface); color: var(--color-text-primary); }
.seg-btn.seg-primary.active { background: var(--color-primary); color: #fff; }

.sched-row { display: flex; gap: 24px; margin-top: 10px; }
.sched-field { display: flex; flex-direction: column; gap: 6px; }
.sched-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }

.pf-target-sec { display: flex; flex-direction: column; gap: 8px; }
.pf-target-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.pill-group { display: flex; flex-wrap: wrap; gap: 6px; }
.pill-opt {
  display: inline-flex; align-items: center;
  padding: 5px 14px; border-radius: 20px; border: 1px solid var(--color-border);
  background: var(--color-surface-raised); font-size: 12px; font-weight: 500; color: var(--color-text-muted);
  cursor: pointer; user-select: none;
  transition: border-color .12s, background .12s, color .12s;
}
.pill-opt.active { border-color: var(--color-primary); background: rgba(78,126,247,.12); color: var(--color-primary); }
.pill-cb { display: none; }

.pf-monitors { border: 1px solid var(--color-border); border-radius: 7px; overflow: hidden; background: var(--color-surface); }
.pf-mon-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--color-text-muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--color-border); }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--color-text-muted); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }

.btn-text { background: none; border: none; cursor: pointer; font-size: 12px; color: var(--color-primary); font-family: var(--font); padding: 0; }
.btn-text.danger { color: var(--color-danger); }
.btn-text:hover { text-decoration: underline; }

/* ── Target flyout (mirrors PolicyFormPage.vue's .tf- pattern verbatim) ── */
.tf-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 500; display: flex; align-items: stretch; justify-content: flex-end; }
.tf-panel {
  display: flex; flex-direction: column; width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--color-surface); border-left: 1px solid var(--color-border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.tf-head { display: flex; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.tf-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); flex: 1; margin: 0; }
.tf-close {
  background: none; border: none; cursor: pointer; color: var(--color-text-muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s;
}
.tf-close:hover { background: var(--color-surface-raised); color: var(--color-text-primary); }
.tf-cat { padding: 12px 16px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.tf-act-btn { flex-shrink: 0; }
.tf-search { padding: 12px 16px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.tf-list { flex: 1; overflow-y: auto; }
.tf-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 1px solid var(--color-border); cursor: pointer; transition: background .08s;
  font-size: 13px; color: var(--color-text-primary);
}
.tf-row:last-child { border-bottom: none; }
.tf-row:hover { background: var(--color-surface-raised); }
.tf-row-selected { background: rgba(78,126,247,.08); border-left: 2px solid var(--color-primary); }
.tf-check { width: 22px; display: flex; align-items: center; justify-content: center; color: var(--color-success); flex-shrink: 0; cursor: pointer; }
.tf-row-info { display: flex; flex-direction: column; gap: 1px; }
.tf-row-sub { font-size: 11px; color: var(--color-text-subtle); }
.tf-empty-msg { padding: 20px 16px; font-size: 13px; color: var(--color-text-muted); text-align: center; }
.tf-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--color-border); flex-shrink: 0; }

.jf-kind-tag { font-size: 10px; font-weight: 700; color: var(--color-text-subtle); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
</style>
