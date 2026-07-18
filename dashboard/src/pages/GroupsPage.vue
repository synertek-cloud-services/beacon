<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ groups.length }}</span>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Device Groups</span>
        <div style="display:flex;align-items:center;gap:10px">
          <input v-model="search" class="search-input" placeholder="Search groups…" />
          <button class="btn btn-primary btn-sm" @click="router.push('/groups/new')">+ New Group</button>
        </div>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="visible.length === 0" class="empty">
        <div class="empty-title">{{ search ? 'No matching groups' : 'No device groups yet' }}</div>
        <p class="empty-sub">Create a named, reusable collection of devices to target with Jobs and Policies.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Members</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in visible" :key="g.id" class="row-clickable" @click="router.push('/groups/' + g.id)">
            <td class="group-name">{{ g.name }}</td>
            <td class="text-sm text-muted-2">{{ g.description || '—' }}</td>
            <td class="text-sm">{{ g.memberCount }}</td>
            <td class="text-sm text-muted-2">{{ relDate(g.createdAt) }}</td>
            <td @click.stop>
              <div class="row-actions">
                <button class="btn btn-ghost btn-sm" @click="router.push('/groups/' + g.id)">Edit</button>
                <button class="btn btn-ghost btn-sm btn-danger-ghost" @click="confirmDelete(g)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-head">
          <div class="modal-title">Delete Group</div>
        </div>
        <div class="modal-body">
          <p class="text-sm" style="color:var(--text)">
            Delete <strong>{{ deleteTarget.name }}</strong>? This removes its membership list and any Job/Policy targeting that references it. This cannot be undone.
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteTarget = null">Cancel</button>
          <button class="btn btn-danger" :disabled="deleteBusy" @click="doDelete">
            {{ deleteBusy ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type DeviceGroup } from '../api';

const router = useRouter();

const groups  = ref<DeviceGroup[]>([]);
const loading = ref(true);
const error   = ref('');
const search  = ref('');

const visible = computed(() => {
  if (!search.value.trim()) return groups.value;
  const q = search.value.toLowerCase();
  return groups.value.filter(g =>
    g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q)
  );
});

async function load() {
  loading.value = groups.value.length === 0;
  error.value = '';
  try {
    groups.value = await api.groups.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

const deleteTarget = ref<DeviceGroup | null>(null);
const deleteBusy   = ref(false);

function confirmDelete(g: DeviceGroup) {
  deleteTarget.value = g;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleteBusy.value = true;
  try {
    await api.groups.delete(deleteTarget.value.id);
    groups.value = groups.value.filter(g => g.id !== deleteTarget.value!.id);
    deleteTarget.value = null;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    deleteBusy.value = false;
  }
}

function relDate(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

onMounted(load);
</script>

<style scoped>
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
}
.stat-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

.search-input {
  height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font); width: 220px;
}
.search-input:focus { outline: none; border-color: var(--accent); }

.group-name { font-size: 13px; font-weight: 500; color: var(--text); }
.row-clickable { cursor: pointer; }
.row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.btn-danger-ghost { color: var(--red) !important; }
.btn-danger-ghost:hover { background: rgba(232,86,106,.08) !important; }
</style>
