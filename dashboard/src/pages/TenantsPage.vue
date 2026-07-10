<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Tenant list -->
    <div class="section-card" style="margin-bottom:0;border-bottom:none;border-radius:8px 8px 0 0">
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
          <tr
            v-for="t in tenants" :key="t.id"
            :class="['tenant-row', expandedId === t.id ? 'tenant-row-active' : '']"
            @click="toggleExpanded(t.id)"
            style="cursor:pointer"
          >
            <td>
              <div style="font-weight:500;font-size:13px">{{ t.name }}</div>
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
                <button class="btn btn-ghost btn-sm" @click="openEdit(t)">Edit</button>
                <button v-if="t.status === 'active'"    class="btn btn-danger btn-sm" @click="setStatus(t, 'suspended')">Suspend</button>
                <button v-if="t.status === 'suspended'" class="btn btn-primary btn-sm" @click="setStatus(t, 'active')">Activate</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Expanded panel -->
    <div v-if="expandedId" class="section-card expand-panel">
      <!-- Tab bar -->
      <div class="expand-head">
        <span class="expand-tenant-label">{{ expandedTenant?.name }}</span>
        <div class="expand-tabs">
          <button :class="['expand-tab', expandedTab === 'contacts'  ? 'active' : '']" @click="expandedTab = 'contacts'">
            Contacts
            <span v-if="!expandedLoading" class="tab-pill">{{ contacts.length }}</span>
          </button>
          <button :class="['expand-tab', expandedTab === 'locations' ? 'active' : '']" @click="expandedTab = 'locations'">
            Locations
            <span v-if="!expandedLoading" class="tab-pill">{{ locations.length }}</span>
          </button>
          <button :class="['expand-tab', expandedTab === 'tokens'    ? 'active' : '']" @click="expandedTab = 'tokens'">
            Tokens
            <span v-if="!expandedLoading" class="tab-pill">{{ tokens.length }}</span>
          </button>
        </div>
        <div style="flex:1"></div>
        <button v-if="expandedTab === 'contacts'"  class="btn btn-primary btn-sm" @click="openContactCreate">+ Add Contact</button>
        <button v-if="expandedTab === 'locations'" class="btn btn-primary btn-sm" @click="openLocationCreate">+ Add Location</button>
        <button v-if="expandedTab === 'tokens'"    class="btn btn-primary btn-sm" @click="showTokenForm = true">+ New Token</button>
      </div>

      <div v-if="expandedLoading" class="empty"><p class="empty-sub">Loading…</p></div>
      <template v-else>

        <!-- ── Contacts tab ── -->
        <div v-if="expandedTab === 'contacts'">
          <div v-if="contacts.length === 0" class="empty">
            <div class="empty-title">No contacts</div>
            <p class="empty-sub">Add a contact to track who to reach for this tenant.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="ct in contacts" :key="ct.id" class="item-card">
              <div class="item-info">
                <div class="item-name">
                  {{ ct.name }}
                  <span v-if="ct.isPrimary" class="badge-accent-sm">Primary</span>
                </div>
                <div v-if="ct.title" class="text-xs text-muted-2">{{ ct.title }}</div>
                <div class="text-xs text-muted-2">
                  {{ [ct.email, ct.phone].filter(Boolean).join(' · ') || 'No contact info' }}
                </div>
              </div>
              <div class="item-actions">
                <button class="btn btn-ghost btn-sm" @click="openContactEdit(ct)">Edit</button>
                <button class="btn btn-danger btn-sm" @click="deleteContact(ct.id)">Delete</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Locations tab ── -->
        <div v-if="expandedTab === 'locations'">
          <div v-if="locations.length === 0" class="empty">
            <div class="empty-title">No locations</div>
            <p class="empty-sub">Add an office or site location for this tenant.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="loc in locations" :key="loc.id" class="item-card">
              <div class="item-info">
                <div class="item-name">
                  {{ loc.name }}
                  <span v-if="loc.isPrimary" class="badge-accent-sm">Primary</span>
                </div>
                <div class="text-xs text-muted-2">{{ addressLine(loc) }}</div>
              </div>
              <div class="item-actions">
                <button class="btn btn-ghost btn-sm" @click="openLocationEdit(loc)">Edit</button>
                <button class="btn btn-danger btn-sm" @click="deleteLocation(loc.id)">Delete</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Tokens tab ── -->
        <div v-if="expandedTab === 'tokens'">
          <div v-if="tokens.length === 0" class="empty">
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

      </template>
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

          <!-- Primary Contact — only shown on create -->
          <template v-if="!editingId">
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
          </template>

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

    <!-- ── Contact modal ── -->
    <div v-if="contactModal.open" class="modal-backdrop" @click.self="contactModal.open = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">{{ contactModal.editing ? 'Edit Contact' : 'Add Contact' }}</span>
        </div>
        <div class="modal-body">
          <div class="form-row-2">
            <div class="field">
              <label>Name <span class="required">*</span></label>
              <input v-model="contactForm.name" placeholder="Jane Smith" autofocus />
            </div>
            <div class="field">
              <label>Title / Role</label>
              <input v-model="contactForm.title" placeholder="IT Manager" />
            </div>
          </div>
          <div class="form-row-2">
            <div class="field">
              <label>Email</label>
              <input v-model="contactForm.email" type="email" placeholder="jane@acme.com" />
            </div>
            <div class="field">
              <label>Phone</label>
              <input
                v-model="contactForm.phone"
                type="tel"
                placeholder="Phone number"
                @blur="contactForm.phone = formatPhone(contactForm.phone)"
              />
            </div>
          </div>
          <label class="toggle-row" style="margin-top:14px">
            <input type="checkbox" v-model="contactForm.isPrimary" />
            <span class="text-sm">Mark as primary contact</span>
          </label>
          <div v-if="contactError" class="error-banner" style="margin-top:12px">{{ contactError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="contactModal.open = false">Cancel</button>
          <button class="btn btn-primary" :disabled="contactSubmitting" @click="submitContact">
            {{ contactSubmitting ? 'Saving…' : (contactModal.editing ? 'Save Changes' : 'Add Contact') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Location modal ── -->
    <div v-if="locationModal.open" class="modal-backdrop" @click.self="locationModal.open = false">
      <div class="modal modal-lg">
        <div class="modal-head">
          <span class="modal-title">{{ locationModal.editing ? 'Edit Location' : 'Add Location' }}</span>
        </div>
        <div class="modal-body">
          <div class="form-row-2" style="margin-bottom:4px">
            <div class="field">
              <label>Location Name <span class="required">*</span></label>
              <input v-model="locationForm.name" placeholder="Headquarters" autofocus />
            </div>
            <div class="field" style="display:flex;align-items:flex-end;padding-bottom:3px">
              <label class="toggle-row">
                <input type="checkbox" v-model="locationForm.isPrimary" />
                <span class="text-sm">Primary location</span>
              </label>
            </div>
          </div>
          <div class="form-section-label" style="margin-top:16px">Address</div>
          <AddressForm v-model="locationForm.address" />
          <div v-if="locationError" class="error-banner" style="margin-top:12px">{{ locationError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="locationModal.open = false">Cancel</button>
          <button class="btn btn-primary" :disabled="locationSubmitting" @click="submitLocation">
            {{ locationSubmitting ? 'Saving…' : (locationModal.editing ? 'Save Changes' : 'Add Location') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Raw token reveal ── -->
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

    <!-- ── Create token modal ── -->
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
import { api, type Tenant, type TenantContact, type TenantLocation, type EnrollmentToken, type Address } from '../api';
import AddressForm from '../components/AddressForm.vue';

// ── State ────────────────────────────────────────────────────
const tenants = ref<Tenant[]>([]);
const loading = ref(true);
const error   = ref('');
const nowSec  = Math.floor(Date.now() / 1000);

// Expanded panel
const expandedId      = ref<string | null>(null);
const expandedTab     = ref<'contacts' | 'locations' | 'tokens'>('contacts');
const expandedLoading = ref(false);
const contacts        = ref<TenantContact[]>([]);
const locations       = ref<TenantLocation[]>([]);
const tokens          = ref<EnrollmentToken[]>([]);
const expandedTenant  = computed(() => tenants.value.find(t => t.id === expandedId.value));

// Tenant create/edit form
const showForm   = ref(false);
const editingId  = ref<string | null>(null);
const submitting = ref(false);
const formError  = ref('');

const blankForm = () => ({
  name: '', website: '', notes: '',
  contactName: '', contactEmail: '', contactPhone: '',
  autoApprove: true, privacyMode: false,
});
const form = ref(blankForm());

// Contact modal
const contactModal      = ref({ open: false, editing: null as TenantContact | null });
const contactForm       = ref({ name: '', title: '', email: '', phone: '', isPrimary: false });
const contactError      = ref('');
const contactSubmitting = ref(false);

// Location modal
const locationModal      = ref({ open: false, editing: null as TenantLocation | null });
const locationForm       = ref({ name: '', isPrimary: false, address: { street: '', city: '', state: '', zip: '', country: '' } as Address });
const locationError      = ref('');
const locationSubmitting = ref(false);

// Token create
const showTokenForm = ref(false);
const creatingToken = ref(false);
const tokenError    = ref('');
const tokenForm     = ref({ maxUses: null as number | null, expiresInDays: null as number | null, autoApprove: true });

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

// ── Expanded panel ────────────────────────────────────────────
async function toggleExpanded(id: string) {
  if (expandedId.value === id) { expandedId.value = null; return; }
  expandedId.value = id;
  expandedTab.value = 'contacts';
  expandedLoading.value = true;
  contacts.value = [];
  locations.value = [];
  tokens.value = [];
  try {
    const [c, l, t] = await Promise.all([
      api.tenants.contacts.list(id),
      api.tenants.locations.list(id),
      api.tenants.tokens.list(id),
    ]);
    contacts.value = c;
    locations.value = l;
    tokens.value = t;
  } finally {
    expandedLoading.value = false;
  }
}

// ── Tenant CRUD ───────────────────────────────────────────────
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
  form.value = {
    name: t.name,
    website: t.website ?? '',
    notes: t.notes ?? '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
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

  try {
    if (editingId.value) {
      await api.tenants.update(editingId.value, {
        name: form.value.name.trim(),
        auto_approve_default: form.value.autoApprove,
        privacy_mode_default: form.value.privacyMode,
        website: form.value.website || null,
        notes:   form.value.notes   || null,
      });
      const idx = tenants.value.findIndex(t => t.id === editingId.value);
      if (idx !== -1) {
        tenants.value[idx] = {
          ...tenants.value[idx],
          name: form.value.name.trim(),
          autoApproveDefault: form.value.autoApprove,
          privacyModeDefault: form.value.privacyMode,
          website: form.value.website || null,
          notes:   form.value.notes   || null,
        };
      }
    } else {
      const t = await api.tenants.create({
        name: form.value.name.trim(),
        auto_approve_default: form.value.autoApprove,
        privacy_mode_default: form.value.privacyMode,
        website: form.value.website || null,
        notes:   form.value.notes   || null,
        contact_name:  form.value.contactName  || null,
        contact_email: form.value.contactEmail || null,
        contact_phone: form.value.contactPhone || null,
      });
      tenants.value.push(t);
    }
    showForm.value = false;
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    submitting.value = false;
  }
}

// ── Contact CRUD ──────────────────────────────────────────────
function openContactCreate() {
  contactModal.value = { open: true, editing: null };
  contactForm.value  = { name: '', title: '', email: '', phone: '', isPrimary: contacts.value.length === 0 };
  contactError.value = '';
}

function openContactEdit(ct: TenantContact) {
  contactModal.value = { open: true, editing: ct };
  contactForm.value  = { name: ct.name, title: ct.title ?? '', email: ct.email ?? '', phone: ct.phone ?? '', isPrimary: ct.isPrimary };
  contactError.value = '';
}

async function submitContact() {
  if (!contactForm.value.name.trim()) { contactError.value = 'Name is required'; return; }
  contactSubmitting.value = true;
  contactError.value = '';
  try {
    const body = {
      name:       contactForm.value.name.trim(),
      title:      contactForm.value.title || null,
      email:      contactForm.value.email || null,
      phone:      contactForm.value.phone || null,
      is_primary: contactForm.value.isPrimary,
    };
    if (contactModal.value.editing) {
      await api.tenants.contacts.update(expandedId.value!, contactModal.value.editing.id, body);
    } else {
      await api.tenants.contacts.create(expandedId.value!, body);
    }
    contacts.value = await api.tenants.contacts.list(expandedId.value!);
    syncPrimaryContact();
    contactModal.value.open = false;
  } catch (e: any) {
    contactError.value = e.message;
  } finally {
    contactSubmitting.value = false;
  }
}

async function deleteContact(contactId: string) {
  if (!expandedId.value) return;
  await api.tenants.contacts.delete(expandedId.value, contactId);
  contacts.value = contacts.value.filter(c => c.id !== contactId);
  syncPrimaryContact();
}

function syncPrimaryContact() {
  const tenant = tenants.value.find(t => t.id === expandedId.value);
  if (!tenant) return;
  const primary = contacts.value.find(c => c.isPrimary);
  tenant.primaryContactName  = primary?.name  ?? null;
  tenant.primaryContactEmail = primary?.email ?? null;
}

// ── Location CRUD ─────────────────────────────────────────────
function openLocationCreate() {
  locationModal.value = { open: true, editing: null };
  locationForm.value  = { name: '', isPrimary: locations.value.length === 0, address: { street: '', city: '', state: '', zip: '', country: '' } };
  locationError.value = '';
}

function openLocationEdit(loc: TenantLocation) {
  locationModal.value = { open: true, editing: loc };
  locationForm.value  = {
    name: loc.name,
    isPrimary: loc.isPrimary,
    address: { street: loc.street ?? '', city: loc.city ?? '', state: loc.state ?? '', zip: loc.zip ?? '', country: loc.country ?? '' },
  };
  locationError.value = '';
}

async function submitLocation() {
  if (!locationForm.value.name.trim()) { locationError.value = 'Location name is required'; return; }
  locationSubmitting.value = true;
  locationError.value = '';
  try {
    const body = {
      name:       locationForm.value.name.trim(),
      is_primary: locationForm.value.isPrimary,
      street:     locationForm.value.address.street  || null,
      city:       locationForm.value.address.city    || null,
      state:      locationForm.value.address.state   || null,
      zip:        locationForm.value.address.zip     || null,
      country:    locationForm.value.address.country || null,
    };
    if (locationModal.value.editing) {
      await api.tenants.locations.update(expandedId.value!, locationModal.value.editing.id, body);
    } else {
      await api.tenants.locations.create(expandedId.value!, body);
    }
    locations.value = await api.tenants.locations.list(expandedId.value!);
    locationModal.value.open = false;
  } catch (e: any) {
    locationError.value = e.message;
  } finally {
    locationSubmitting.value = false;
  }
}

async function deleteLocation(locationId: string) {
  if (!expandedId.value) return;
  await api.tenants.locations.delete(expandedId.value, locationId);
  locations.value = locations.value.filter(l => l.id !== locationId);
}

// ── Token CRUD ────────────────────────────────────────────────
async function submitToken() {
  if (!expandedId.value) return;
  creatingToken.value = true;
  tokenError.value = '';
  try {
    const result = await api.tenants.tokens.create(expandedId.value, {
      auto_approve:    tokenForm.value.autoApprove,
      max_uses:        tokenForm.value.maxUses || null,
      expires_in_days: tokenForm.value.expiresInDays || null,
    });
    showTokenForm.value = false;
    newRawToken.value   = result.raw_token;
    tokenForm.value     = { maxUses: null, expiresInDays: null, autoApprove: true };
    tokens.value        = await api.tenants.tokens.list(expandedId.value);
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

// ── Helpers ───────────────────────────────────────────────────
function formatPhone(value: string): string {
  return value.replace(/[^\d\s+\-().x]/g, '').trim();
}

const phoneValid = computed(() => {
  const digits = (form.value.contactPhone ?? '').replace(/\D/g, '');
  return digits.length >= 7;
});

function addressLine(loc: TenantLocation): string {
  const parts = [
    loc.street,
    loc.city,
    [loc.state, loc.zip].filter(Boolean).join(' '),
    loc.country,
  ].filter(Boolean);
  return parts.join(', ') || 'No address on file';
}

function dateLabel(ts: number) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

onMounted(load);
</script>

<style scoped>
/* ── Expanded panel ── */
.tenant-row-active td { background: rgba(78,126,247,.04); }
.expand-panel {
  border-radius: 0 0 8px 8px;
  border-top: 1px solid var(--border);
}
.expand-head {
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  gap: 0;
}
.expand-tenant-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .05em;
  padding-right: 16px;
  border-right: 1px solid var(--border);
  margin-right: 4px;
  white-space: nowrap;
}
.expand-tabs { display: flex; }
.expand-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 11px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color .12s, border-color .12s;
  margin-bottom: -1px;
}
.expand-tab:hover { color: var(--text); }
.expand-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-pill {
  font-size: 10px;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--muted);
  border-radius: 8px;
  padding: 1px 6px;
  line-height: 1.4;
}
.expand-tab.active .tab-pill { background: rgba(78,126,247,.12); color: var(--accent); }

/* ── Item cards (contacts & locations) ── */
.item-list {
  padding: 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  gap: 12px;
}
.item-info { flex: 1; min-width: 0; }
.item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.item-actions { display: flex; gap: 6px; flex-shrink: 0; }

.badge-accent-sm {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  background: rgba(78,126,247,.12);
  color: var(--accent);
  border: 1px solid rgba(78,126,247,.2);
  padding: 1px 7px;
  border-radius: 3px;
}

/* ── Modals ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border-2);
  border-radius: 10px; width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; max-height: 90vh;
  display: flex; flex-direction: column;
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
