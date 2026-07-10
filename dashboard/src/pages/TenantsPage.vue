<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Tenant list -->
    <div class="section-card" style="margin-bottom:16px">
      <div class="section-card-head">
        <span class="section-card-title">Tenants</span>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">+ New Tenant</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="tenants.length === 0" class="empty">
        <div class="empty-title">No tenants yet</div>
        <p class="empty-sub">Create a tenant to start enrolling devices.</p>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Devices</th>
            <th>Auto-approve</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tenants" :key="t.id" @click="toggleExpanded(t.id)" style="cursor:pointer">
            <td><span class="text-sm" style="font-weight:500">{{ t.name }}</span></td>
            <td>
              <span :class="t.status === 'active' ? 'badge badge-approved' : 'badge badge-revoked'">
                {{ t.status }}
              </span>
            </td>
            <td class="mono text-sm">{{ t.deviceCount }}</td>
            <td class="text-sm text-muted-2">{{ t.autoApproveDefault ? 'Yes' : 'No' }}</td>
            <td class="text-sm text-muted-2">{{ dateLabel(t.createdAt) }}</td>
            <td>
              <div class="actions" @click.stop>
                <button
                  class="btn btn-ghost btn-sm"
                  :disabled="t.status === 'suspended'"
                  @click="suspendTenant(t)"
                >Suspend</button>
                <button
                  v-if="t.status === 'suspended'"
                  class="btn btn-primary btn-sm"
                  @click="activateTenant(t)"
                >Activate</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Expanded: enrollment tokens for selected tenant -->
    <div v-if="expandedId" class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Enrollment Tokens — {{ expandedTenant?.name }}</span>
        <button class="btn btn-primary btn-sm" @click="showTokenForm = true">+ New Token</button>
      </div>

      <div v-if="tokensLoading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="tokens.length === 0" class="empty">
        <div class="empty-title">No tokens</div>
        <p class="empty-sub">Create a token and share it with the device installer.</p>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Token ID</th>
            <th>Auto-approve</th>
            <th>Uses</th>
            <th>Expires</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tok in tokens" :key="tok.id">
            <td class="mono text-xs text-muted-2">{{ tok.id.slice(0, 8) }}…</td>
            <td class="text-sm text-muted-2">
              {{ tok.autoApprove === null ? 'Tenant default' : tok.autoApprove ? 'Yes' : 'No' }}
            </td>
            <td class="mono text-sm">{{ tok.useCount }}{{ tok.maxUses != null ? ` / ${tok.maxUses}` : '' }}</td>
            <td class="text-sm text-muted-2">{{ tok.expiresAt ? dateLabel(tok.expiresAt) : 'Never' }}</td>
            <td>
              <span v-if="tok.revokedAt" class="badge badge-revoked">Revoked</span>
              <span v-else-if="tok.expiresAt && tok.expiresAt < nowSec" class="badge badge-revoked">Expired</span>
              <span v-else class="badge badge-approved">Active</span>
            </td>
            <td>
              <button
                v-if="!tok.revokedAt"
                class="btn btn-danger btn-sm"
                @click="revokeToken(tok.id)"
              >Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- New raw token reveal (shown after creation) -->
    <div v-if="newRawToken" class="modal-backdrop" @click.self="newRawToken = null">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">Enrollment Token Created</span>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted-2" style="margin-bottom:12px">
            Copy this token now — it will <strong>never be shown again</strong>. Pass it to the installer as <code>--enroll-token</code>.
          </p>
          <div class="token-reveal" @click="copyToken">
            <span class="mono">{{ newRawToken }}</span>
            <span class="copy-hint">{{ copied ? 'Copied!' : 'Click to copy' }}</span>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" @click="newRawToken = null">Done</button>
        </div>
      </div>
    </div>

    <!-- Create tenant modal -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">New Tenant</span>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Name</label>
            <input v-model="createForm.name" placeholder="Acme Corp" @keyup.enter="submitCreate" autofocus />
          </div>
          <label class="toggle-row">
            <input type="checkbox" v-model="createForm.autoApprove" />
            <span class="text-sm">Auto-approve new device enrollments</span>
          </label>
          <div v-if="createError" class="error-banner" style="margin-top:12px">{{ createError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="submitCreate">
            {{ creating ? 'Creating…' : 'Create Tenant' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create token modal -->
    <div v-if="showTokenForm" class="modal-backdrop" @click.self="showTokenForm = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">New Enrollment Token</span>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Max uses (blank = unlimited)</label>
            <input v-model.number="tokenForm.maxUses" type="number" min="1" placeholder="Unlimited" />
          </div>
          <div class="field">
            <label>Expires in days (blank = never)</label>
            <input v-model.number="tokenForm.expiresInDays" type="number" min="1" placeholder="Never" />
          </div>
          <label class="toggle-row" style="margin-top:4px">
            <input type="checkbox" v-model="tokenForm.autoApprove" />
            <span class="text-sm">Auto-approve devices enrolled with this token</span>
          </label>
          <div v-if="tokenError" class="error-banner" style="margin-top:12px">{{ tokenError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showTokenForm = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creatingToken" @click="submitToken">
            {{ creatingToken ? 'Creating…' : 'Create Token' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, type Tenant, type EnrollmentToken } from '../api';

const tenants = ref<Tenant[]>([]);
const loading = ref(true);
const error = ref('');
const nowSec = Math.floor(Date.now() / 1000);

// Expanded tenant tokens
const expandedId = ref<string | null>(null);
const tokens = ref<EnrollmentToken[]>([]);
const tokensLoading = ref(false);
const expandedTenant = computed(() => tenants.value.find(t => t.id === expandedId.value));

// Create tenant
const showCreate = ref(false);
const creating = ref(false);
const createError = ref('');
const createForm = ref({ name: '', autoApprove: true });

// Create token
const showTokenForm = ref(false);
const creatingToken = ref(false);
const tokenError = ref('');
const tokenForm = ref<{ maxUses: number | null; expiresInDays: number | null; autoApprove: boolean }>({
  maxUses: null, expiresInDays: null, autoApprove: true,
});

// Raw token reveal
const newRawToken = ref<string | null>(null);
const copied = ref(false);

async function load() {
  try {
    tenants.value = await api.tenants.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function toggleExpanded(id: string) {
  if (expandedId.value === id) { expandedId.value = null; return; }
  expandedId.value = id;
  tokensLoading.value = true;
  tokens.value = [];
  try {
    tokens.value = await api.tenants.tokens.list(id);
  } finally {
    tokensLoading.value = false;
  }
}

async function suspendTenant(t: Tenant) {
  await api.tenants.update(t.id, { status: 'suspended' });
  t.status = 'suspended';
}

async function activateTenant(t: Tenant) {
  await api.tenants.update(t.id, { status: 'active' });
  t.status = 'active';
}

async function submitCreate() {
  if (!createForm.value.name.trim()) { createError.value = 'Name is required'; return; }
  creating.value = true;
  createError.value = '';
  try {
    const t = await api.tenants.create({
      name: createForm.value.name,
      auto_approve_default: createForm.value.autoApprove,
    });
    tenants.value.push(t);
    showCreate.value = false;
    createForm.value = { name: '', autoApprove: true };
  } catch (e: any) {
    createError.value = e.message;
  } finally {
    creating.value = false;
  }
}

async function submitToken() {
  if (!expandedId.value) return;
  creatingToken.value = true;
  tokenError.value = '';
  try {
    const result = await api.tenants.tokens.create(expandedId.value, {
      auto_approve: tokenForm.value.autoApprove,
      max_uses: tokenForm.value.maxUses || null,
      expires_in_days: tokenForm.value.expiresInDays || null,
    });
    showTokenForm.value = false;
    newRawToken.value = result.raw_token;
    tokenForm.value = { maxUses: null, expiresInDays: null, autoApprove: true };
    // Refresh token list
    tokens.value = await api.tenants.tokens.list(expandedId.value);
  } catch (e: any) {
    tokenError.value = e.message;
  } finally {
    creatingToken.value = false;
  }
}

async function revokeToken(tokenId: string) {
  if (!expandedId.value) return;
  await api.tenants.tokens.revoke(expandedId.value, tokenId);
  const tok = tokens.value.find(t => t.id === tokenId);
  if (tok) tok.revokedAt = nowSec;
}

async function copyToken() {
  if (!newRawToken.value) return;
  await navigator.clipboard.writeText(newRawToken.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

function dateLabel(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

onMounted(load);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: 10px;
  width: 420px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
  overflow: hidden;
}
.modal-head {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.modal-body { padding: 20px; }
.modal-foot {
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.toggle-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.toggle-row input[type=checkbox] { accent-color: var(--accent); width: 14px; height: 14px; }
.token-reveal {
  background: var(--bg);
  border: 1px solid var(--border-2);
  border-radius: var(--r-btn);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  word-break: break-all;
  transition: border-color .12s;
}
.token-reveal:hover { border-color: var(--accent); }
.copy-hint { font-size: 11px; color: var(--accent); flex-shrink: 0; }
code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 1px 5px; border-radius: 3px; color: var(--muted-2); }
</style>
