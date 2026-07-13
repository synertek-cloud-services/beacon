<template>
  <div class="up-page">
    <div class="up-header">
      <h1 class="up-title">Users</h1>
      <button class="btn btn-primary btn-sm" @click="router.push('/settings/users/new')">Add User</button>
    </div>

    <div class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Users <span class="row-count-badge">{{ users.length }}</span></span>
      </div>

      <div v-if="loading" class="up-state">Loading…</div>
      <div v-else-if="!users.length" class="up-state">No users yet.</div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Sign-in</th>
            <th>Status</th>
            <th>Last login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.displayName || '—' }}</td>
            <td>{{ u.email }}</td>
            <td><span :class="['role-chip', 'role-' + u.role]">{{ u.role }}</span></td>
            <td>{{ u.authSource === 'microsoft' ? 'Microsoft' : 'Local' }}</td>
            <td>
              <button :class="['toggle-btn', 'toggle-sm', { enabled: u.status === 'active' }]" @click="toggleStatus(u)">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </button>
            </td>
            <td class="text-muted">{{ u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never' }}</td>
            <td class="up-row-actions">
              <button class="btn-text" @click="router.push('/settings/users/' + u.id)">Edit</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type AppUser } from '../api';

const router = useRouter();
const users = ref<AppUser[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    users.value = await api.users.list();
  } finally {
    loading.value = false;
  }
}

async function toggleStatus(u: AppUser) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  await api.users.update(u.id, { status: next });
  u.status = next;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

onMounted(load);
</script>

<style scoped>
.up-page { display: flex; flex-direction: column; }
.up-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.up-title { font-size: 20px; font-weight: 700; color: var(--text); margin: 0; }
.up-state { padding: 32px; text-align: center; color: var(--muted); font-size: 13px; }
.up-row-actions { text-align: right; }

.role-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 10px;
}
.role-admin      { background: rgba(232,86,106,.14); color: var(--red); }
.role-technician { background: rgba(78,126,247,.14); color: var(--accent); }
.role-readonly   { background: var(--surface-2); color: var(--muted-2); }

.row-count-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px;
  background: var(--surface-2); color: var(--muted-2); margin-left: 4px;
}

th, td { padding: 10px 20px; text-align: left; font-size: 13px; }
thead th {
  font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  color: var(--muted); border-bottom: 1px solid var(--border);
}
tbody tr { border-bottom: 1px solid var(--border); }
tbody tr:last-child { border-bottom: none; }

.btn-text {
  background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 500;
  cursor: pointer; padding: 2px 4px;
}
.btn-text:hover { text-decoration: underline; }

/* ── Toggle switch (duplicated per-component, matches this codebase's convention) ── */
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
</style>
