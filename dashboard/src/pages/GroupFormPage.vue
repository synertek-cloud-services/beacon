<template>
  <div class="pf-page">

    <nav class="pf-crumb">
      <RouterLink to="/groups" class="pf-crumb-link">Device Groups</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Create Group' : 'Edit Group' }}</span>
    </nav>

    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/groups')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">{{ isNew ? 'Create Group' : (form.name || 'Edit Group') }}</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/groups')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : (isNew ? 'Create Group' : 'Save Changes') }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="error-banner" style="margin:0 0 16px">{{ loadError }}</div>
    <div v-if="saveError" class="error-banner" style="margin:0 0 16px">{{ saveError }}</div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">

      <div class="pf-group">
        <label class="pf-label">Name</label>
        <input v-model="form.name" class="pf-input" placeholder="e.g. Finance Workstations" />
        <span v-if="fieldErr.name" class="pf-err">{{ fieldErr.name }}</span>
      </div>

      <div class="pf-group">
        <label class="pf-label">Description</label>
        <textarea v-model="form.description" class="pf-input pf-textarea" rows="2" placeholder="What is this group for?" />
      </div>

      <div class="pf-group">
        <label class="pf-label">Devices</label>
        <p class="field-hint" style="margin-top:-4px">
          A static, manually-curated set of devices — membership never changes on its own. Usable to target Jobs and Policies.
        </p>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-primary btn-sm" @click="devicesFlyoutOpen = true">Add Device</button>
          <button class="btn btn-ghost btn-sm" :disabled="members.length === 0" @click="removeAllMembers">Remove all</button>
        </div>
        <div class="pf-monitors" style="margin-top:8px">
          <div v-if="members.length === 0" class="pf-mon-empty">
            <p>Select which devices belong to this group.</p>
          </div>
          <div v-else v-for="m in members" :key="m.deviceId" class="pf-mon-row">
            <span class="pf-mon-desc"><strong>{{ m.hostname ?? m.deviceId.slice(0, 8) }}</strong> — {{ m.tenantName }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text danger" @click="removeMember(m.deviceId)">Remove</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Device flyout -->
    <Teleport to="body">
      <div v-if="devicesFlyoutOpen" class="sf-overlay" @click.self="devicesFlyoutOpen = false">
        <div class="sf-panel">
          <div class="sf-head">
            <h2 class="sf-title">Devices</h2>
            <button class="btn-icon" @click="devicesFlyoutOpen = false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="sf-search">
            <input v-model="deviceFlyoutQuery" class="pf-input" placeholder="Search by hostname" />
          </div>
          <div class="sf-list">
            <div v-for="d in deviceFlyoutMatches" :key="d.id" class="sf-row" :class="{ selected: isMember(d.id) }">
              <span>{{ d.hostname ?? d.id.slice(0, 8) }} <span class="text-xs text-muted-2">— {{ d.tenantName }}</span></span>
              <button v-if="isMember(d.id)" class="btn btn-primary btn-sm" @click="removeMember(d.id)">Remove</button>
              <button v-else class="btn btn-ghost btn-sm" @click="addMember(d)">Add</button>
            </div>
            <div v-if="deviceFlyoutMatches.length === 0" class="pf-mon-empty"><p>No matching devices.</p></div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type Device, type DeviceGroupMember } from '../api';

const router = useRouter();
const route  = useRoute();

const groupId = computed(() => route.params.id as string | undefined);
const isNew   = computed(() => !groupId.value);

const loading   = ref(false);
const loadError = ref('');
const saving    = ref(false);
const saveError = ref('');
const fieldErr  = reactive({ name: '' });

const form = reactive({ name: '', description: '' });

const members = ref<DeviceGroupMember[]>([]);
const allDevices = ref<Device[]>([]);

const devicesFlyoutOpen = ref(false);
const deviceFlyoutQuery = ref('');

const deviceFlyoutMatches = computed(() => {
  const q = deviceFlyoutQuery.value.trim().toLowerCase();
  const list = q
    ? allDevices.value.filter(d => (d.hostname ?? '').toLowerCase().includes(q) || (d.tenantName ?? '').toLowerCase().includes(q))
    : allDevices.value;
  return list.slice(0, 50);
});

function isMember(deviceId: string): boolean {
  return members.value.some(m => m.deviceId === deviceId);
}

async function addMember(d: Device) {
  if (isMember(d.id)) return;
  if (!isNew.value && groupId.value) {
    try { await api.groups.members.add(groupId.value, d.id); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  members.value.push({ deviceId: d.id, hostname: d.hostname, tenantName: d.tenantName ?? '' });
}

async function removeMember(deviceId: string) {
  if (!isNew.value && groupId.value) {
    try { await api.groups.members.remove(groupId.value, deviceId); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  members.value = members.value.filter(m => m.deviceId !== deviceId);
}

async function removeAllMembers() {
  if (!isNew.value && groupId.value) {
    for (const m of members.value) {
      try { await api.groups.members.remove(groupId.value, m.deviceId); } catch { /* best-effort, continue clearing locally */ }
    }
  }
  members.value = [];
}

onMounted(async () => {
  try { allDevices.value = await api.devices.list(); } catch { /* ok */ }

  if (!isNew.value && groupId.value) {
    loading.value = true;
    try {
      const g = await api.groups.get(groupId.value);
      form.name = g.name;
      form.description = g.description ?? '';
      members.value = await api.groups.members.list(groupId.value);
    } catch (e: any) {
      loadError.value = e.message;
    } finally {
      loading.value = false;
    }
  }
});

async function save() {
  fieldErr.name = '';
  saveError.value = '';
  if (!form.name.trim()) { fieldErr.name = 'Name is required.'; return; }

  saving.value = true;
  try {
    if (isNew.value) {
      const { id } = await api.groups.create({ name: form.name.trim(), description: form.description.trim() || undefined });
      if (members.value.length > 0) {
        await api.groups.members.addBulk(id, members.value.map(m => m.deviceId));
      }
    } else if (groupId.value) {
      await api.groups.update(groupId.value, { name: form.name.trim(), description: form.description.trim() || undefined });
    }
    router.push('/groups');
  } catch (e: any) {
    saveError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

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

.pf-state { padding: 40px; text-align: center; color: var(--muted); }

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
.pf-textarea { resize: vertical; min-height: 60px; }
.pf-err { font-size: 11px; color: var(--red); }
.field-hint { font-size: 11px; color: var(--muted); margin: 0; }

.pf-monitors { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-mon-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--text); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }

.btn-text { background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font); color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s; }
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }

.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-2);
  background: var(--surface-2); color: var(--muted-2); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s; flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--border); color: var(--text); }

/* ── Add Device flyout (right-side panel, mirrors ComponentFormPage's Add Site flyout) ── */
.sf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  z-index: 500; display: flex; align-items: stretch; justify-content: flex-end;
}
.sf-panel {
  display: flex; flex-direction: column;
  width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.sf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.sf-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; }
.sf-search { padding: 14px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sf-search .pf-input { max-width: none; }
.sf-list { flex: 1; overflow-y: auto; }
.sf-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid var(--border);
  font-size: 13px; color: var(--text);
}
.sf-row.selected { background: rgba(78,126,247,.06); }
</style>
