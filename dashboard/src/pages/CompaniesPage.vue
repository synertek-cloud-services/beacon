<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Company list -->
    <div class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Companies</span>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ New Company</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>
      <div v-else-if="companies.length === 0" class="empty">
        <div class="empty-title">No companies yet</div>
        <p class="empty-sub">Create a company to start enrolling devices.</p>
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
          <tr
            v-for="t in companies"
            :key="t.id"
            class="company-row"
            style="cursor:pointer"
            @click="router.push(`/companies/${t.id}`)"
          >
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-weight:500;font-size:13px">{{ t.name }}</span>
                <span v-if="t.patchManagementExcluded" class="badge badge-revoked" title="Excluded from Patch Policies">No Patch Mgmt</span>
              </div>
              <div v-if="t.website" class="text-xs text-muted-2">{{ t.website }}</div>
            </td>
            <td>
              <div class="text-sm">{{ t.primaryContactName ?? '—' }}</div>
              <div v-if="t.primaryContactEmail" class="text-xs text-muted-2">{{ t.primaryContactEmail }}</div>
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
                <button class="btn btn-ghost btn-sm" @click="router.push({ path: '/devices', query: { company: t.id } })">Devices</button>
                <button v-if="t.status === 'active'"    class="btn btn-danger btn-sm" @click="setStatus(t, 'suspended')">Suspend</button>
                <button v-if="t.status === 'suspended'" class="btn btn-primary btn-sm" @click="setStatus(t, 'active')">Activate</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Create company modal ── -->
    <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
      <div class="modal modal-lg">
        <div class="modal-head">
          <span class="modal-title">New Company</span>
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
            <textarea v-model="form.notes" placeholder="Internal notes about this company…" rows="2"></textarea>
          </div>

          <div class="form-section-label" style="margin-top:16px">
            Primary Contact <span class="text-muted-2" style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0">(optional — more can be added after creating)</span>
          </div>
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
                Enter a valid phone number (e.g. +1 512 555 0100)
              </span>
            </div>
          </div>

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
            <label class="toggle-row" style="margin-top:10px">
              <input type="checkbox" v-model="form.patchManagementExcluded" />
              <span>
                <span class="text-sm" style="font-weight:500">Exclude from Patch Policies</span>
                <span class="text-xs text-muted-2" style="display:block">This company's devices never receive any Patch Policy install or Windows Update Management takeover, even from an unrestricted global policy — for companies managing Windows Update their own way (e.g. WSUS)</span>
              </span>
            </label>
            <label class="toggle-row" style="margin-top:10px">
              <input type="checkbox" v-model="form.remoteAccessConsentRequired" />
              <span>
                <span class="text-sm" style="font-weight:500">Require end-user consent for Web Remote</span>
                <span class="text-xs text-muted-2" style="display:block">Before a Web Remote session connects, the logged-in user must Accept or Decline an on-screen prompt (times out after 30s if nobody responds). Overridable per device on the device's own page.</span>
              </span>
            </label>
            <label class="toggle-row" style="margin-top:10px">
              <input type="checkbox" v-model="form.rustdeskEnabled" />
              <span>
                <span class="text-sm" style="font-weight:500">Enable RustDesk</span>
                <span class="text-xs text-muted-2" style="display:block">Offers RustDesk as an additional remote-access tool for this company's devices, alongside Web Remote and Remote Shell. On-demand agent installation isn't built yet — this only stores the preference for now.</span>
              </span>
            </label>
          </div>

          <div v-if="formError" class="error-banner" style="margin-top:14px">{{ formError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showForm = false">Cancel</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">
            {{ submitting ? 'Creating…' : 'Create Company' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Company } from '../api';

// Contacts/Locations/Tokens/Variables/Discovery management moved to
// CompanyDetailPage.vue (/companies/:id) — this page is list-only now,
// same "row click navigates to detail page" convention as
// ComponentsPage.vue/GroupsPage.vue. Editing an existing company also
// moved there (its own topbar Edit button) -- a row-level Edit button next
// to Devices/Suspend was an awkward spot for it once a real detail page
// existed. Only company create and the quick Suspend/Activate/Devices row
// actions stay here.
const router  = useRouter();
const companies = ref<Company[]>([]);
const loading = ref(true);
const error   = ref('');

// Company create form
const showForm   = ref(false);
const submitting = ref(false);
const formError  = ref('');

const blankForm = () => ({
  name: '', website: '', notes: '',
  contactName: '', contactEmail: '', contactPhone: '',
  autoApprove: true, privacyMode: false, patchManagementExcluded: false, remoteAccessConsentRequired: false, rustdeskEnabled: false,
});
const form = ref(blankForm());

async function load() {
  try {
    companies.value = await api.companies.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function setStatus(t: Company, status: 'active' | 'suspended') {
  await api.companies.update(t.id, { status });
  t.status = status;
}

function openCreate() {
  form.value = blankForm();
  formError.value = '';
  showForm.value = true;
}

async function submitForm() {
  if (!form.value.name.trim()) { formError.value = 'Company name is required'; return; }
  submitting.value = true;
  formError.value = '';

  try {
    const t = await api.companies.create({
      name: form.value.name.trim(),
      auto_approve_default: form.value.autoApprove,
      privacy_mode_default: form.value.privacyMode,
      patch_management_excluded: form.value.patchManagementExcluded,
      remote_access_consent_required: form.value.remoteAccessConsentRequired,
      rustdesk_enabled: form.value.rustdeskEnabled,
      website: form.value.website || null,
      notes:   form.value.notes   || null,
      contact_name:  form.value.contactName  || null,
      contact_email: form.value.contactEmail || null,
      contact_phone: form.value.contactPhone || null,
    });
    companies.value.push(t);
    showForm.value = false;
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    submitting.value = false;
  }
}

function formatPhone(value: string): string {
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
/* ── Create/Edit Company modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--color-surface); border: 1px solid var(--color-border-strong);
  border-radius: 10px; width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-lg { width: 620px; }
.modal-head { padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; display: flex; align-items: flex-start; justify-content: space-between; }
.modal-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }

.form-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 8px; margin-bottom: 14px;
}
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.field textarea {
  background: var(--color-canvas); border: 1px solid var(--color-border-strong); border-radius: var(--r-btn);
  padding: 8px 11px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  width: 100%; resize: vertical; outline: none; transition: border-color .12s;
}
.field textarea:focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }
.required { color: var(--color-danger); }
.toggle-group { display: flex; flex-direction: column; }
.toggle-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.toggle-row input[type=checkbox] { accent-color: var(--color-primary); width: 15px; height: 15px; margin-top: 2px; flex-shrink: 0; }
.field-hint { display: block; font-size: 11px; margin-top: 4px; }
.field-hint-warn { color: var(--color-warning); }
</style>
