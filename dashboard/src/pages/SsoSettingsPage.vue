<template>
  <div class="pf-page">
    <nav class="pf-crumb">
      <span class="pf-crumb-current">Single Sign-On</span>
    </nav>

    <div class="pf-topbar">
      <h1 class="pf-title">Single Sign-On</h1>
    </div>

    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <!-- Provider config -->
      <div class="pf-group">
        <label class="pf-label">Microsoft Entra ID</label>
        <p class="field-hint" style="margin-top:-4px">Anyone in a group mapped below can sign in with their Microsoft account. Users are auto-created on first sign-in with the mapped role.</p>

        <div class="pf-field-row">
          <label class="pf-sublabel">Name</label>
          <input v-model="provider.name" class="pf-input" placeholder="Microsoft 365" />
        </div>
        <div class="pf-field-row">
          <label class="pf-sublabel">Directory (Tenant) ID</label>
          <input v-model="provider.directoryId" class="pf-input" placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div class="pf-field-row">
          <label class="pf-sublabel">Application (Client) ID</label>
          <input v-model="provider.clientId" class="pf-input" placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div class="pf-field-row">
          <label class="pf-sublabel">Client Secret</label>
          <input v-model="provider.clientSecret" class="pf-input" type="password" :placeholder="provider.hasSecret ? '•••• configured — leave blank to keep' : 'Client secret value'" />
        </div>

        <div v-if="provider.id" class="pf-field-row">
          <label class="pf-sublabel">Enabled</label>
          <div class="seg-bar">
            <button :class="['seg-btn', 'seg-primary', { active: provider.enabled }]" @click="provider.enabled = true">Enabled</button>
            <button :class="['seg-btn', { active: !provider.enabled }]" @click="provider.enabled = false">Disabled</button>
          </div>
        </div>

        <div class="pf-row" style="margin-top:4px">
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveProvider">
            {{ saving ? 'Saving…' : (provider.id ? 'Save Changes' : 'Configure') }}
          </button>
        </div>
        <div v-if="saveError" class="error-banner">{{ saveError }}</div>
      </div>

      <!-- Group role mappings -->
      <div v-if="provider.id" class="pf-group">
        <label class="pf-label">Group → Role Mappings</label>
        <p class="field-hint" style="margin-top:-4px">Map Entra security group object IDs to a Beacon role. If a user belongs to more than one mapped group, the highest-privilege role wins.</p>

        <div class="pf-monitors">
          <div class="pf-tbl-head">
            <span style="min-width:220px">Group</span>
            <span>Role</span>
          </div>
          <div v-if="!mappings.length" class="pf-mon-empty">
            <p>No group mappings yet. Add one so someone can actually sign in.</p>
          </div>
          <div v-for="m in mappings" :key="m.id" class="pf-mon-row">
            <span class="pf-mon-desc" style="flex:1">
              <strong>{{ m.groupName || m.groupId }}</strong>
              <span v-if="m.groupName" class="text-muted" style="margin-left:6px">{{ m.groupId }}</span>
            </span>
            <span :class="['role-chip', 'role-' + m.role]">{{ m.role }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text danger" @click="removeMapping(m.id)">Remove</button>
            </div>
          </div>
        </div>

        <div class="pf-row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
          <input v-model="newMapping.groupId" class="pf-input" placeholder="Group object ID" style="max-width:260px" />
          <input v-model="newMapping.groupName" class="pf-input" placeholder="Group name (optional)" style="max-width:200px" />
          <select v-model="newMapping.role" class="pf-input" style="max-width:150px">
            <option value="admin">Admin</option>
            <option value="technician">Technician</option>
            <option value="readonly">Read-only</option>
          </select>
          <button class="btn btn-ghost btn-sm" :disabled="!newMapping.groupId" @click="addMapping">Add Mapping</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { api, type SsoGroupRoleMapping, type Role } from '../api';

const loading = ref(true);
const saving = ref(false);
const saveError = ref('');

const provider = reactive<{ id: string | null; name: string; directoryId: string; clientId: string; clientSecret: string; hasSecret: boolean; enabled: boolean }>({
  id: null, name: 'Microsoft 365', directoryId: '', clientId: '', clientSecret: '', hasSecret: false, enabled: true,
});

const mappings = ref<SsoGroupRoleMapping[]>([]);
const newMapping = reactive<{ groupId: string; groupName: string; role: Role }>({ groupId: '', groupName: '', role: 'technician' });

onMounted(async () => {
  const providers = await api.sso.providers.list();
  const p = providers[0];
  if (p) {
    provider.id = p.id;
    provider.name = p.name;
    provider.directoryId = p.directoryId;
    provider.clientId = p.clientId;
    provider.hasSecret = p.hasSecret;
    provider.enabled = p.enabled;
    mappings.value = await api.sso.groupMappings.list(p.id);
  }
  loading.value = false;
});

async function saveProvider() {
  saveError.value = '';
  if (!provider.name.trim() || !provider.directoryId.trim() || !provider.clientId.trim()) {
    saveError.value = 'Name, directory ID, and client ID are required.';
    return;
  }
  if (!provider.id && !provider.clientSecret) {
    saveError.value = 'A client secret is required to configure a new provider.';
    return;
  }

  saving.value = true;
  try {
    if (provider.id) {
      await api.sso.providers.update(provider.id, {
        name: provider.name, directoryId: provider.directoryId, clientId: provider.clientId,
        enabled: provider.enabled,
        ...(provider.clientSecret ? { clientSecret: provider.clientSecret } : {}),
      });
    } else {
      const { id } = await api.sso.providers.create({
        name: provider.name, directoryId: provider.directoryId, clientId: provider.clientId, clientSecret: provider.clientSecret,
      });
      provider.id = id;
      provider.hasSecret = true;
    }
    provider.clientSecret = '';
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save provider.';
  } finally {
    saving.value = false;
  }
}

async function addMapping() {
  if (!provider.id || !newMapping.groupId.trim()) return;
  const { id } = await api.sso.groupMappings.create(provider.id, {
    groupId: newMapping.groupId.trim(),
    groupName: newMapping.groupName.trim() || undefined,
    role: newMapping.role,
  });
  mappings.value.push({ id, ssoProviderId: provider.id, groupId: newMapping.groupId.trim(), groupName: newMapping.groupName.trim() || null, role: newMapping.role, createdAt: Math.floor(Date.now() / 1000) });
  newMapping.groupId = '';
  newMapping.groupName = '';
  newMapping.role = 'technician';
}

async function removeMapping(id: string) {
  if (!provider.id) return;
  await api.sso.groupMappings.delete(provider.id, id);
  mappings.value = mappings.value.filter(m => m.id !== id);
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.pf-crumb-current { color: var(--muted-2); }
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-title { font-size: 20px; font-weight: 700; color: var(--text); flex: 1; margin: 0; }
.pf-state { padding: 40px; text-align: center; color: var(--muted); }

.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--text); }
.pf-field-row { display: flex; flex-direction: column; gap: 4px; }
.pf-sublabel { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.pf-row { display: flex; align-items: center; gap: 8px; }
.field-hint { display: block; font-size: 11px; color: var(--muted); margin-top: 4px; }

.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }
.seg-btn.seg-primary.active { background: var(--accent); color: #fff; }

.pf-monitors { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-tbl-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em;
}
.pf-mon-empty { padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--muted); margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--border); }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { font-size: 12px; color: var(--text); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }

.btn-text { background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 500; cursor: pointer; padding: 2px 4px; }
.btn-text:hover { text-decoration: underline; }
.btn-text.danger { color: var(--red); }

.role-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 10px; flex-shrink: 0;
}
.role-admin      { background: rgba(232,86,106,.14); color: var(--red); }
.role-technician { background: rgba(78,126,247,.14); color: var(--accent); }
.role-readonly   { background: var(--surface-2); color: var(--muted-2); }
</style>
