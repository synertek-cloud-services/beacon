<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Tenant list -->
    <div class="section-card" style="margin-bottom:16px">
      <div class="section-card-head">
        <span class="section-card-title">Tenants</span>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ New Tenant</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="tenants.length === 0" class="empty">
        <div class="empty-title">No tenants yet</div>
        <p class="empty-sub">Create a tenant to start enrolling devices.</p>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Company</th>
            <th>Primary Contact</th>
            <th>Status</th>
            <th>Devices</th>
            <th>Auto-approve</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tenants" :key="t.id" @click="toggleExpanded(t.id)" style="cursor:pointer">
            <td>
              <div style="font-weight:500;font-size:13px">{{ t.name }}</div>
              <div v-if="t.website" class="text-xs text-muted-2">{{ t.website }}</div>
            </td>
            <td>
              <div class="text-sm">{{ t.contactName ?? '—' }}</div>
              <div v-if="t.contactEmail" class="text-xs text-muted-2">{{ t.contactEmail }}</div>
            </td>
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
                <button class="btn btn-ghost btn-sm" @click="openEdit(t)">Edit</button>
                <button v-if="t.status === 'active'"    class="btn btn-danger btn-sm" @click="setStatus(t, 'suspended')">Suspend</button>
                <button v-if="t.status === 'suspended'" class="btn btn-primary btn-sm" @click="setStatus(t, 'active')">Activate</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Expanded: enrollment tokens -->
    <div v-if="expandedId" class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Enrollment Tokens — {{ expandedTenant?.name }}</span>
        <button class="btn btn-primary btn-sm" @click="showTokenForm = true">+ New Token</button>
      </div>
      <div v-if="tokensLoading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="tokens.length === 0" class="empty">
        <div class="empty-title">No tokens</div>
        <p class="empty-sub">Create a token and pass it to the device installer via <code>--enroll-token</code>.</p>
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
            <td class="text-sm text-muted-2">{{ tok.autoApprove === null ? 'Tenant default' : tok.autoApprove ? 'Yes' : 'No' }}</td>
            <td class="mono text-sm">{{ tok.useCount }}{{ tok.maxUses != null ? ` / ${tok.maxUses}` : '' }}</td>
            <td class="text-sm text-muted-2">{{ tok.expiresAt ? dateLabel(tok.expiresAt) : 'Never' }}</td>
            <td>
              <span v-if="tok.revokedAt" class="badge badge-revoked">Revoked</span>
              <span v-else-if="tok.expiresAt && tok.expiresAt < nowSec" class="badge badge-revoked">Expired</span>
              <span v-else class="badge badge-approved">Active</span>
            </td>
            <td>
              <button v-if="!tok.revokedAt" class="btn btn-danger btn-sm" @click="revokeToken(tok.id)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Create / Edit tenant modal ── -->
    <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
      <div class="modal modal-lg">
        <div class="modal-head">
          <span class="modal-title">{{ editingId ? 'Edit Tenant' : 'New Tenant' }}</span>
        </div>
        <div class="modal-body">
          <!-- Company -->
          <div class="form-section-label">Company</div>
          <div class="form-row-2">
            <div class="field">
              <label>Company Name <span class="required">*</span></label>
              <input v-model="form.name" placeholder="Acme Corp" autofocus />
            </div>
            <div class="field">
              <label>Website</label>
              <input v-model="form.website" placeholder="https://acme.com" />
            </div>
          </div>
          <div class="field">
            <label>Notes</label>
            <textarea v-model="form.notes" placeholder="Internal notes about this tenant…" rows="2"></textarea>
          </div>

          <!-- Contact -->
          <div class="form-section-label" style="margin-top:16px">Primary Contact</div>
          <div class="form-row-3">
            <div class="field">
              <label>Name</label>
              <input v-model="form.contactName" placeholder="Jane Smith" />
            </div>
            <div class="field">
              <label>Email</label>
              <input v-model="form.contactEmail" type="email" placeholder="jane@acme.com" />
            </div>
            <div class="field">
              <label>Phone</label>
              <input
                v-model="form.contactPhone"
                type="tel"
                placeholder="Phone number"
                @blur="form.contactPhone = formatPhone(form.contactPhone)"
              />
              <span v-if="form.contactPhone && !phoneValid" class="field-hint field-hint-warn">
                Enter a valid phone number including country code (e.g. +1 512 555 0100)
              </span>
            </div>
          </div>

          <!-- Address -->
          <div class="form-section-label" style="margin-top:16px">Address</div>
          <AddressForm v-model="form.address" />

          <!-- Settings -->
          <div class="form-section-label" style="margin-top:16px">Settings</div>
          <div class="toggle-group">
            <label class="toggle-row">
              <input type="checkbox" v-model="form.autoApprove" />
              <span>
                <span class="text-sm" style="font-weight:500">Auto-approve devices</span>
                <span class="text-xs text-muted-2" style="display:block">New enrollments are automatically approved without manual review</span>
              </span>
            </label>
            <label class="toggle-row" style="margin-top:10px">
              <input type="checkbox" v-model="form.privacyMode" />
              <span>
                <span class="text-sm" style="font-weight:500">Privacy mode default</span>
                <span class="text-xs text-muted-2" style="display:block">Limits inventory collection to basic device info only</span>
              </span>
            </label>
          </div>

          <div v-if="formError" class="error-banner" style="margin-top:14px">{{ formError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showForm = false">Cancel</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">
            {{ submitting ? (editingId ? 'Saving…' : 'Creating…') : (editingId ? 'Save Changes' : 'Create Tenant') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Raw token reveal -->
    <div v-if="newRawToken" class="modal-backdrop" @click.self="newRawToken = null">
      <div class="modal">
        <div class="modal-head"><span class="modal-title">Enrollment Token Created</span></div>
        <div class="modal-body">
          <p class="text-sm text-muted-2" style="margin-bottom:12px">
            Copy this token now — it will <strong>never be shown again</strong>.
            Pass it to the installer as <code>--enroll-token</code>.
          </p>
          <div class="token-reveal" @click="copyToken">
            <span class="mono text-xs">{{ newRawToken }}</span>
            <span class="copy-hint">{{ copied ? 'Copied!' : 'Click to copy' }}</span>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" @click="newRawToken = null">Done</button>
        </div>
      </div>
    </div>

    <!-- Create token modal -->
    <div v-if="showTokenForm" class="modal-backdrop" @click.self="showTokenForm = false">
      <div class="modal">
        <div class="modal-head"><span class="modal-title">New Enrollment Token</span></div>
        <div class="modal-body">
          <div class="form-row-2">
            <div class="field">
              <label>Max uses (blank = unlimited)</label>
              <input v-model.number="tokenForm.maxUses" type="number" min="1" placeholder="Unlimited" />
            </div>
            <div class="field">
              <label>Expires in days (blank = never)</label>
              <input v-model.number="tokenForm.expiresInDays" type="number" min="1" placeholder="Never" />
            </div>
          </div>
          <label class="toggle-row">
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
import { api, type Tenant, type EnrollmentToken, type Address } from '../api';
import AddressForm from '../components/AddressForm.vue';

// ── State ────────────────────────────────────────────────────
const tenants = ref<Tenant[]>([]);
const loading = ref(true);
const error   = ref('');
const nowSec  = Math.floor(Date.now() / 1000);

// Expanded token section
const expandedId     = ref<string | null>(null);
const tokens         = ref<EnrollmentToken[]>([]);
const tokensLoading  = ref(false);
const expandedTenant = computed(() => tenants.value.find(t => t.id === expandedId.value));

// Create/edit form
const showForm   = ref(false);
const editingId  = ref<string | null>(null);
const submitting = ref(false);
const formError  = ref('');

const blankForm = () => ({
  name: '', website: '', notes: '',
  contactName: '', contactEmail: '', contactPhone: '',
  address: { street: '', city: '', state: '', zip: '', country: '' } as Address,
  autoApprove: true, privacyMode: false,
});
const form = ref(blankForm());

// Create token
const showTokenForm  = ref(false);
const creatingToken  = ref(false);
const tokenError     = ref('');
const tokenForm      = ref({ maxUses: null as number | null, expiresInDays: null as number | null, autoApprove: true });

// Raw token reveal
const newRawToken = ref<string | null>(null);
const copied      = ref(false);

// ── Load ─────────────────────────────────────────────────────
async function load() {
  try {
    tenants.value = await api.tenants.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// ── Tenant actions ────────────────────────────────────────────
async function toggleExpanded(id: string) {
  if (expandedId.value === id) { expandedId.value = null; return; }
  expandedId.value = id;
  tokensLoading.value = true;
  tokens.value = [];
  try { tokens.value = await api.tenants.tokens.list(id); }
  finally { tokensLoading.value = false; }
}

async function setStatus(t: Tenant, status: 'active' | 'suspended') {
  await api.tenants.update(t.id, { status });
  t.status = status;
}

function openCreate() {
  editingId.value = null;
  form.value = blankForm();
  formError.value = '';
  showForm.value = true;
}

function openEdit(t: Tenant) {
  editingId.value = t.id;
  const addr: Address = t.address ? JSON.parse(t.address) : {};
  form.value = {
    name: t.name,
    website: t.website ?? '',
    notes: t.notes ?? '',
    contactName: t.contactName ?? '',
    contactEmail: t.contactEmail ?? '',
    contactPhone: t.contactPhone ?? '',
    address: { street: addr.street ?? '', city: addr.city ?? '', state: addr.state ?? '', zip: addr.zip ?? '', country: addr.country ?? '' },
    autoApprove: t.autoApproveDefault,
    privacyMode: t.privacyModeDefault,
  };
  formError.value = '';
  showForm.value = true;
}

async function submitForm() {
  if (!form.value.name.trim()) { formError.value = 'Company name is required'; return; }
  submitting.value = true;
  formError.value = '';

  const body = {
    name: form.value.name.trim(),
    auto_approve_default: form.value.autoApprove,
    privacy_mode_default: form.value.privacyMode,
    contact_name:  form.value.contactName  || null,
    contact_email: form.value.contactEmail || null,
    contact_phone: form.value.contactPhone || null,
    website: form.value.website || null,
    notes:   form.value.notes   || null,
    address: Object.values(form.value.address).some(v => v)
      ? form.value.address
      : null,
  };

  try {
    if (editingId.value) {
      await api.tenants.update(editingId.value, body);
      const idx = tenants.value.findIndex(t => t.id === editingId.value);
      if (idx !== -1) tenants.value[idx] = { ...tenants.value[idx], ...body,
        autoApproveDefault: body.auto_approve_default,
        privacyModeDefault: body.privacy_mode_default,
        contactName:  body.contact_name,
        contactEmail: body.contact_email,
        contactPhone: body.contact_phone,
        address: body.address ? JSON.stringify(body.address) : null,
      };
    } else {
      const t = await api.tenants.create(body);
      tenants.value.push(t);
    }
    showForm.value = false;
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    submitting.value = false;
  }
}

// ── Token actions ─────────────────────────────────────────────
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

function formatPhone(value: string): string {
  // Strip anything that isn't a digit, space, +, -, (, ), or .
  return value.replace(/[^\d\s+\-().x]/g, '').trim();
}

const phoneValid = computed(() => {
  const digits = (form.value.contactPhone ?? '').replace(/\D/g, '');
  return digits.length >= 7;
});

function dateLabel(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

onMounted(load);
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border-2);
  border-radius: 10px; width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; max-height: 90vh; display: flex; flex-direction: column;
}
.modal-lg { width: 620px; }
.modal-head { padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }

.form-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 14px;
}
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.field textarea {
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 8px 11px; color: var(--text); font-size: 13px; font-family: var(--font);
  width: 100%; resize: vertical; outline: none; transition: border-color .12s;
}
.field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }
.required { color: var(--red); }
.toggle-group { display: flex; flex-direction: column; }
.toggle-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.toggle-row input[type=checkbox] { accent-color: var(--accent); width: 15px; height: 15px; margin-top: 2px; flex-shrink: 0; }
.token-reveal {
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; cursor: pointer; word-break: break-all; transition: border-color .12s;
}
.token-reveal:hover { border-color: var(--accent); }
.copy-hint { font-size: 11px; color: var(--accent); flex-shrink: 0; }
code { font-family: var(--mono); font-size: 11px; background: var(--surface-2); padding: 1px 5px; border-radius: 3px; color: var(--muted-2); }
.field-hint { display: block; font-size: 11px; margin-top: 4px; }
.field-hint-warn { color: var(--amber); }
</style>
