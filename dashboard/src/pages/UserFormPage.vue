<template>
  <div class="pf-page">
    <nav class="pf-crumb">
      <RouterLink to="/settings/users" class="pf-crumb-link">Users</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Add User' : 'Edit User' }}</span>
    </nav>

    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/settings/users')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">{{ isNew ? 'Add User' : (form.email || 'Edit User') }}</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/settings/users')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : (isNew ? 'Create User' : 'Save Changes') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="pf-state">Loading…</div>
    <div v-else class="pf-body">

      <!-- Identity -->
      <div class="pf-group">
        <label class="pf-label">Email</label>
        <input v-model="form.email" class="pf-input" type="email" placeholder="name@example.com" :disabled="!isNew" />
      </div>

      <div class="pf-group">
        <label class="pf-label">Display Name</label>
        <input v-model="form.displayName" class="pf-input" placeholder="Jane Smith" />
      </div>

      <!-- Access -->
      <div class="pf-group">
        <label class="pf-label">Role</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: form.role === 'admin' }]" @click="form.role = 'admin'">Admin</button>
          <button :class="['seg-btn', { active: form.role === 'technician' }]" @click="form.role = 'technician'">Technician</button>
          <button :class="['seg-btn', { active: form.role === 'readonly' }]" @click="form.role = 'readonly'">Read-only</button>
        </div>
      </div>

      <div v-if="!isNew" class="pf-group">
        <label class="pf-label">Status</label>
        <div class="seg-bar">
          <button :class="['seg-btn', 'seg-primary', { active: form.status === 'active' }]" @click="form.status = 'active'">Active</button>
          <button :class="['seg-btn', { active: form.status === 'disabled' }]" @click="form.status = 'disabled'">Disabled</button>
        </div>
      </div>

      <!-- Password -->
      <div v-if="isNew" class="pf-group">
        <label class="pf-label">Password</label>
        <input v-model="form.password" class="pf-input" type="password" autocomplete="new-password" placeholder="Set an initial password" />
      </div>

      <div v-else-if="authSource === 'microsoft'" class="pf-group">
        <label class="pf-label">Password</label>
        <p class="field-hint">This account signs in via Microsoft SSO — Beacon doesn't hold a password for it. Password recovery happens through Microsoft.</p>
      </div>

      <div v-else class="pf-group">
        <label class="pf-label">Reset Password</label>
        <div class="pf-row">
          <input v-model="newPassword" class="pf-input" type="password" autocomplete="new-password" placeholder="New password" style="max-width:280px" />
          <button class="btn btn-ghost btn-sm" :disabled="!newPassword || resettingPassword" @click="resetPassword">
            {{ resettingPassword ? 'Setting…' : 'Set Password' }}
          </button>
        </div>
        <p v-if="resetMessage" class="field-hint">{{ resetMessage }}</p>
      </div>

      <div v-if="saveError" class="error-banner">{{ saveError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Role } from '../api';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.path === '/settings/users/new');
const userId = computed(() => route.params.id as string | undefined);

const loading = ref(!isNew.value);
const saving = ref(false);
const saveError = ref('');
const authSource = ref<'local' | 'microsoft'>('local');
const newPassword = ref('');
const resettingPassword = ref(false);
const resetMessage = ref('');

const form = reactive({
  email: '',
  displayName: '',
  role: 'technician' as Role,
  status: 'active' as 'active' | 'disabled',
  password: '',
});

onMounted(async () => {
  if (isNew.value) return;
  const users = await api.users.list();
  const u = users.find(x => x.id === userId.value);
  if (!u) { loading.value = false; return; }
  form.email = u.email;
  form.displayName = u.displayName ?? '';
  form.role = u.role;
  form.status = u.status;
  authSource.value = u.authSource;
  loading.value = false;
});

async function save() {
  saveError.value = '';
  if (isNew.value) {
    if (!form.email.trim() || !form.password) { saveError.value = 'Email and password are required.'; return; }
    saving.value = true;
    try {
      await api.users.create({ email: form.email.trim(), displayName: form.displayName || undefined, role: form.role, password: form.password });
      router.push('/settings/users');
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : 'Failed to create user.';
    } finally {
      saving.value = false;
    }
    return;
  }

  saving.value = true;
  try {
    await api.users.update(userId.value!, { displayName: form.displayName, role: form.role, status: form.status });
    router.push('/settings/users');
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save user.';
  } finally {
    saving.value = false;
  }
}

async function resetPassword() {
  if (!newPassword.value || !userId.value) return;
  resettingPassword.value = true;
  resetMessage.value = '';
  try {
    await api.users.resetPassword(userId.value, newPassword.value);
    resetMessage.value = 'Password updated.';
    newPassword.value = '';
  } catch (e) {
    resetMessage.value = e instanceof Error ? e.message : 'Failed to reset password.';
  } finally {
    resettingPassword.value = false;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--color-primary); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--color-text-subtle); }

.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
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
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--color-border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-input:disabled { opacity: .6; cursor: not-allowed; }
.pf-row { display: flex; align-items: center; gap: 8px; }

.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }

.seg-bar { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--color-surface-raised); color: var(--color-text-subtle); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--color-border-strong); }
.seg-btn.active { background: var(--color-surface); color: var(--color-text-primary); }
.seg-btn.seg-primary.active { background: var(--color-primary); color: #fff; }
</style>
