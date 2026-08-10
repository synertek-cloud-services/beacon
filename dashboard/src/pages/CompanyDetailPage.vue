<template>
  <div class="pf-page">

    <nav class="pf-crumb">
      <RouterLink to="/companies" class="pf-crumb-link">Companies</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ company?.name ?? 'Company' }}</span>
    </nav>

    <div class="pf-sticky-bar">
      <div class="pf-topbar">
        <button class="pf-back" @click="router.push('/companies')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 class="pf-title">
          {{ company?.name ?? 'Company' }}
          <span v-if="company" :class="company.status === 'active' ? 'badge badge-approved' : 'badge badge-revoked'" style="margin-left:8px;vertical-align:middle">{{ company.status }}</span>
          <span v-if="company?.patchManagementExcluded" class="badge badge-revoked" style="margin-left:6px;vertical-align:middle" title="Excluded from Patch Policies">No Patch Mgmt</span>
        </h1>
        <div class="pf-topbar-right">
          <button class="btn btn-ghost btn-sm" @click="router.push({ path: '/devices', query: { company: companyId } })">View Devices</button>
          <button v-if="company?.status === 'active'" class="btn btn-danger btn-sm" @click="setStatus('suspended')">Suspend</button>
          <button v-else-if="company" class="btn btn-primary btn-sm" @click="setStatus('active')">Activate</button>
        </div>
      </div>
      <div v-if="error" class="error-banner">{{ error }}</div>
    </div>

    <div v-if="loading" class="pf-state">Loading…</div>

    <template v-else-if="company">
      <!-- Summary strip -->
      <div class="cd-summary">
        <div class="cd-sum-item">
          <span class="cd-sum-label">Website</span>
          <span class="cd-sum-value">{{ company.website || '—' }}</span>
        </div>
        <div class="cd-sum-item">
          <span class="cd-sum-label">Primary Contact</span>
          <span class="cd-sum-value">{{ company.primaryContactName ?? '—' }}<span v-if="company.primaryContactEmail" class="text-xs text-muted-2"> · {{ company.primaryContactEmail }}</span></span>
        </div>
        <div class="cd-sum-item">
          <span class="cd-sum-label">Devices</span>
          <span class="cd-sum-value mono">{{ company.deviceCount }}</span>
        </div>
        <div class="cd-sum-item">
          <span class="cd-sum-label">Auto-approve</span>
          <span class="cd-sum-value">{{ company.autoApproveDefault ? 'Yes' : 'No' }}</span>
        </div>
        <div class="cd-sum-item">
          <span class="cd-sum-label">Privacy mode default</span>
          <span class="cd-sum-value">{{ company.privacyModeDefault ? 'Yes' : 'No' }}</span>
        </div>
        <div class="cd-sum-item">
          <span class="cd-sum-label">Created</span>
          <span class="cd-sum-value">{{ dateLabel(company.createdAt) }}</span>
        </div>
      </div>
      <p v-if="company.notes" class="cd-notes">{{ company.notes }}</p>

      <!-- Tab bar -->
      <div class="expand-head cd-tabs">
        <button :class="['expand-tab', activeTab === 'contacts'  ? 'active' : '']" @click="activeTab = 'contacts'">
          Contacts
          <span class="tab-pill">{{ contacts.length }}</span>
        </button>
        <button :class="['expand-tab', activeTab === 'locations' ? 'active' : '']" @click="activeTab = 'locations'">
          Locations
          <span class="tab-pill">{{ locations.length }}</span>
        </button>
        <button :class="['expand-tab', activeTab === 'tokens'    ? 'active' : '']" @click="activeTab = 'tokens'">
          Tokens
          <span class="tab-pill">{{ tokens.length }}</span>
        </button>
        <button v-if="isAdmin" :class="['expand-tab', activeTab === 'variables' ? 'active' : '']" @click="activeTab = 'variables'">
          Variables
          <span class="tab-pill">{{ variables.length }}</span>
        </button>
        <button :class="['expand-tab', activeTab === 'discovery' ? 'active' : '']" @click="activeTab = 'discovery'">
          Discovery
          <span class="tab-pill">{{ discoveredDevices.length }}</span>
        </button>
        <div style="flex:1"></div>
        <button v-if="activeTab === 'contacts'"  class="btn btn-primary btn-sm" @click="openContactCreate">+ Add Contact</button>
        <button v-if="activeTab === 'locations'" class="btn btn-primary btn-sm" @click="openLocationCreate">+ Add Location</button>
        <button v-if="activeTab === 'tokens'"    class="btn btn-primary btn-sm" @click="showTokenForm = true">+ New Token</button>
        <button v-if="activeTab === 'variables'" class="btn btn-primary btn-sm" @click="openVariableCreate">+ Add Variable</button>
      </div>

      <div class="cd-tab-body">

        <!-- Contacts -->
        <div v-if="activeTab === 'contacts'">
          <div v-if="contacts.length === 0" class="empty">
            <div class="empty-title">No contacts</div>
            <p class="empty-sub">Add a contact to track who to reach for this company.</p>
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

        <!-- Locations -->
        <div v-if="activeTab === 'locations'">
          <div v-if="locations.length === 0" class="empty">
            <div class="empty-title">No locations</div>
            <p class="empty-sub">Add a location for this company.</p>
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

        <!-- Tokens -->
        <div v-if="activeTab === 'tokens'">
          <div v-if="tokens.length === 0" class="empty">
            <div class="empty-title">No tokens</div>
            <p class="empty-sub">Create a token and pass it to the device installer via <code>--enroll-token</code>.</p>
          </div>
          <table v-else class="inner-table">
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
                <td class="text-sm text-muted-2">{{ tok.autoApprove === null ? 'Company default' : tok.autoApprove ? 'Yes' : 'No' }}</td>
                <td class="mono text-sm">{{ tok.useCount }}{{ tok.maxUses != null ? ` / ${tok.maxUses}` : '' }}</td>
                <td class="text-sm text-muted-2">{{ tok.expiresAt ? dateLabel(tok.expiresAt) : 'Never' }}</td>
                <td>
                  <span v-if="tok.revokedAt" class="badge badge-revoked">Revoked</span>
                  <span v-else-if="tok.expiresAt && tok.expiresAt < nowSec" class="badge badge-revoked">Expired</span>
                  <span v-else class="badge badge-approved">Active</span>
                </td>
                <td>
                  <button v-if="!tok.revokedAt" class="btn btn-danger btn-sm" @click="revokeToken(tok.id)">Revoke</button>
                  <button v-else-if="tok.useCount === 0" class="btn btn-danger btn-sm" @click="deleteToken(tok.id)">Delete</button>
                  <span v-else class="text-xs text-muted-2" title="This token is retained because it enrolled one or more devices.">Retained after use</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Variables -->
        <div v-if="activeTab === 'variables'">
          <div v-if="variables.length === 0" class="empty">
            <div class="empty-title">No variables</div>
            <p class="empty-sub">Add a variable or secret to reference from component scripts as <code>CV_&lt;KEY&gt;</code>.</p>
          </div>
          <div v-else class="item-list">
            <div v-for="v in variables" :key="v.id" class="item-card">
              <div class="item-info">
                <div class="item-name">
                  <code>CV_{{ v.key }}</code>
                  <span v-if="v.isSecret" class="badge-accent-sm">Secret</span>
                </div>
                <div class="text-xs text-muted-2">
                  {{ v.isSecret ? (v.hasValue ? '••••••••  (configured)' : 'Not set') : (v.value || '—') }}
                </div>
                <div v-if="v.description" class="text-xs text-muted-2">{{ v.description }}</div>
              </div>
              <div class="item-actions">
                <button class="btn btn-ghost btn-sm" @click="openVariableEdit(v)">Edit</button>
                <button class="btn btn-danger btn-sm" @click="deleteVariable(v.id)">Delete</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Discovery -->
        <div v-if="activeTab === 'discovery'" class="discovery-panel">
          <div class="discovery-config">
            <div class="form-section-label">Scan Configuration</div>
            <div class="form-row-2" style="margin-bottom:12px">
              <div class="field">
                <label>Probe Device <span class="required">*</span></label>
                <select v-model="discoveryForm.probeDeviceId">
                  <option value="">Select a device…</option>
                  <option v-for="d in eligibleProbeDevices" :key="d.id" :value="d.id">{{ d.hostname || d.id.slice(0, 8) }}</option>
                </select>
                <div class="text-xs text-muted-2" style="margin-top:2px">Must be an approved server or always-on workstation — laptops can't be a probe.</div>
              </div>
              <div class="field">
                <label>Scan Interval</label>
                <select v-model.number="discoveryForm.scanIntervalMinutes">
                  <option :value="60">Every 1 hour</option>
                  <option :value="360">Every 6 hours</option>
                  <option :value="720">Every 12 hours</option>
                  <option :value="1440">Every 24 hours</option>
                </select>
              </div>
            </div>
            <div class="field" style="margin-bottom:12px">
              <label>CIDR Ranges <span class="required">*</span></label>
              <div v-for="(_, i) in discoveryForm.cidrRanges" :key="i" class="cidr-row">
                <input v-model="discoveryForm.cidrRanges[i]" placeholder="192.168.1.0/24" />
                <button v-if="discoveryForm.cidrRanges.length > 1" class="btn btn-ghost btn-sm" @click="discoveryForm.cidrRanges.splice(i, 1)">Remove</button>
              </div>
              <button class="btn btn-ghost btn-sm" style="margin-top:6px" @click="discoveryForm.cidrRanges.push('')">+ Add Range</button>
            </div>
            <label class="toggle-row" style="margin-bottom:12px">
              <input type="checkbox" v-model="discoveryForm.enabled" />
              <span class="text-sm">Enabled</span>
            </label>
            <div class="field" style="margin-bottom:12px">
              <label class="toggle-row">
                <input type="checkbox" v-model="discoveryForm.snmpEnabled" />
                <span class="text-sm">Enable SNMP Discovery</span>
              </label>
              <div class="text-xs text-muted-2" style="margin-top:2px">
                Requires a Company Variable named <code>CV_SNMP_COMMUNITY</code> — configure it in the Variables tab.
              </div>
              <label class="toggle-row" style="margin-top:8px">
                <input type="checkbox" v-model="discoveryForm.sshEnabled" />
                <span class="text-sm">Enable SSH Discovery</span>
              </label>
              <div class="text-xs text-muted-2" style="margin-top:2px">
                Requires Company Variables named <code>CV_SSH_USERNAME</code> and <code>CV_SSH_PASSWORD</code> — configure them in the Variables tab.
              </div>
            </div>
            <div v-if="discoveryError" class="error-banner" style="margin-bottom:12px">{{ discoveryError }}</div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn btn-primary btn-sm" :disabled="discoverySubmitting" @click="submitDiscoveryConfig">
                {{ discoverySubmitting ? 'Saving…' : 'Save' }}
              </button>
              <button class="btn btn-ghost btn-sm" :disabled="!discoveryConfig || scanningNow" @click="scanNow">
                {{ scanningNow ? 'Queuing…' : 'Scan Now' }}
              </button>
              <span v-if="discoveryConfig?.lastScannedAt" class="text-xs text-muted-2">
                Last scanned {{ dateLabel(discoveryConfig.lastScannedAt) }}
              </span>
            </div>
          </div>

          <div class="form-section-label" style="margin-top:20px">
            Discovered Devices
            <label class="toggle-row" style="float:right;font-weight:400">
              <input type="checkbox" v-model="hideDismissed" />
              <span class="text-xs">Hide dismissed</span>
            </label>
          </div>
          <div v-if="visibleDiscoveredDevices.length === 0" class="empty">
            <div class="empty-title">No devices discovered yet</div>
            <p class="empty-sub">Devices found by a scan will appear here.</p>
          </div>
          <table v-else class="inner-table">
            <thead>
              <tr>
                <th>IP</th>
                <th>MAC</th>
                <th>Hostname</th>
                <th>Open Ports</th>
                <th>Fingerprint</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th>Times Seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dd in visibleDiscoveredDevices" :key="dd.id" :class="{ 'dd-dismissed': dd.dismissed }">
                <td class="mono text-sm">{{ dd.ipAddress }}</td>
                <td class="mono text-xs text-muted-2">{{ dd.macAddress ?? '—' }}</td>
                <td class="text-sm">{{ dd.hostname ?? '—' }}</td>
                <td class="mono text-xs text-muted-2">{{ dd.openPorts?.length ? dd.openPorts.join(', ') : '—' }}</td>
                <td class="text-xs text-muted-2" style="max-width:220px" :title="fingerprintText(dd)">{{ fingerprintText(dd) ? truncate(fingerprintText(dd), 40) : '—' }}</td>
                <td class="text-sm text-muted-2">{{ dateLabel(dd.firstSeenAt) }}</td>
                <td class="text-sm text-muted-2">{{ dateLabel(dd.lastSeenAt) }}</td>
                <td class="mono text-sm">{{ dd.timesSeen }}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" @click="toggleDismissed(dd)">{{ dd.dismissed ? 'Un-dismiss' : 'Dismiss' }}</button>
                  <button class="btn btn-danger btn-sm" @click="deleteDiscoveredDevice(dd.id)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </template>

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

    <!-- ── Variable modal ── -->
    <div v-if="variableModal.open" class="modal-backdrop" @click.self="variableModal.open = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">{{ variableModal.editing ? 'Edit Variable' : 'Add Variable' }}</span>
        </div>
        <div class="modal-body">
          <div class="form-row-2" style="margin-bottom:4px">
            <div class="field">
              <label>Key <span class="required">*</span></label>
              <input
                v-model="variableForm.key"
                placeholder="AV_LICENSE_KEY"
                autofocus
                :disabled="!!variableModal.editing"
                @input="variableForm.key = variableForm.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')"
              />
              <div class="text-xs text-muted-2" style="margin-top:2px">Referenced in scripts as <code>CV_{{ variableForm.key || 'KEY' }}</code></div>
            </div>
            <div class="field" style="display:flex;align-items:flex-end;padding-bottom:3px">
              <label class="toggle-row">
                <input type="checkbox" v-model="variableForm.isSecret" :disabled="!!variableModal.editing" />
                <span class="text-sm">Secret (encrypted, hidden after saving)</span>
              </label>
            </div>
          </div>
          <div class="field" style="margin-top:12px">
            <label>Value <span v-if="!variableModal.editing" class="required">*</span></label>
            <input
              v-model="variableForm.value"
              :type="variableForm.isSecret ? 'password' : 'text'"
              :placeholder="variableModal.editing ? 'Leave blank to keep the current value' : ''"
            />
          </div>
          <div class="field" style="margin-top:12px">
            <label>Description</label>
            <input v-model="variableForm.description" placeholder="Optional note about what this is used for" />
          </div>
          <div v-if="variableError" class="error-banner" style="margin-top:12px">{{ variableError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="variableModal.open = false">Cancel</button>
          <button class="btn btn-primary" :disabled="variableSubmitting" @click="submitVariable">
            {{ variableSubmitting ? 'Saving…' : (variableModal.editing ? 'Save Changes' : 'Add Variable') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Install modal ── -->
    <div v-if="installModal" class="modal-backdrop">
      <div class="modal modal-install">
        <div class="modal-head">
          <div>
            <div class="modal-title">Install Beacon Agent</div>
            <div class="text-xs text-muted-2" style="margin-top:2px">{{ installModal.companyName }}</div>
          </div>
          <button class="modal-close" @click="installModal = null" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" style="padding:0">

          <!-- Token section -->
          <div class="inst-section">
            <div class="inst-label">Enrollment Token — copy now, shown once</div>
            <div class="token-reveal" @click="copyText(installModal!.token, 'token')">
              <span class="mono text-xs" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ installModal.token }}</span>
              <svg v-if="copiedField !== 'token'" class="copy-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5V3" stroke="currentColor" stroke-width="1.4"/></svg>
              <svg v-else class="copy-icon copy-icon--done" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8l4 4 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
          </div>

          <!-- OS tab bar -->
          <div class="inst-os-tabs">
            <button :class="['inst-os-tab', installOS === 'windows' ? 'active' : '']" @click="installOS = 'windows'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.8"/></svg>
              Windows
            </button>
            <button :class="['inst-os-tab', installOS === 'linux' ? 'active' : '']" @click="installOS = 'linux'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021C7.576.216 3.476 3.05 1.83 7.22c-1.585 4.042-.865 8.626 1.871 12.014L.81 22.8a.498.498 0 0 0 .6.65l3.312-.937C6.3 23.834 9.035 24 11.77 24c3.244 0 6.573-.922 9.302-2.708a.498.498 0 0 0 .099-.77l-1.774-2.015c2.28-2.998 3.12-7.02 2.026-10.752C19.876 3.77 16.407.782 12.504 0z"/></svg>
              Linux
            </button>
            <button :class="['inst-os-tab', installOS === 'darwin' ? 'active' : '']" @click="installOS = 'darwin'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.261-4.62c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.701"/></svg>
              macOS
            </button>
          </div>

          <!-- Arch selector (Linux / macOS only) -->
          <div v-if="installOS !== 'windows'" class="inst-section inst-arch-row">
            <span class="inst-label" style="margin-bottom:0">Architecture</span>
            <div class="arch-toggle">
              <button :class="['arch-btn', installArch === 'amd64' ? 'active' : '']" @click="installArch = 'amd64'">x86-64 (amd64)</button>
              <button :class="['arch-btn', installArch === 'arm64' ? 'active' : '']" @click="installArch = 'arm64'">ARM64</button>
            </div>
          </div>

          <!-- Download + one-liner -->
          <div class="inst-section">
            <div class="inst-label">Download binary</div>
            <a :href="downloadURL" download class="btn btn-ghost btn-sm inst-dl-btn" target="_blank">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download beacon-agent{{ installOS === 'windows' ? '.exe' : '' }}
            </a>
          </div>

          <div class="inst-section" style="padding-bottom:20px">
            <div class="inst-label" style="margin-bottom:6px">
              Install one-liner
              <span class="text-xs text-muted-2" style="font-weight:400;margin-left:4px;text-transform:none;letter-spacing:0">
                — run{{ installOS === 'windows' ? ' in an elevated PowerShell' : ' as root' }}
              </span>
            </div>
            <div class="oneliner-wrap">
              <pre class="oneliner-pre">{{ oneLiner }}</pre>
              <button class="oneliner-copy" @click="copyText(oneLiner, 'oneliner')">
                <svg v-if="copiedField !== 'oneliner'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </div>

        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" @click="installModal = null">Done</button>
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
              <label>Max uses</label>
              <input v-model.number="tokenForm.maxUses" type="number" min="1" placeholder="Unlimited" />
              <span class="field-hint text-muted-2">Leave blank for unlimited</span>
            </div>
            <div class="field">
              <label>Expires in days</label>
              <input v-model.number="tokenForm.expiresInDays" type="number" min="1" placeholder="Never" />
              <span class="field-hint text-muted-2">Leave blank to never expire</span>
            </div>
          </div>
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
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Company, type CompanyContact, type CompanyLocation, type CompanyVariable, type EnrollmentToken, type Address, type Device, type NetworkDiscoveryConfig, type DiscoveredDevice } from '../api';
import { hasRole } from '../auth';
import AddressForm from '../components/AddressForm.vue';

const route  = useRoute();
const router = useRouter();
const companyId = computed(() => route.params.id as string);

const company = ref<Company | null>(null);
const loading = ref(true);
const error   = ref('');
const nowSec  = Math.floor(Date.now() / 1000);
const isAdmin = computed(() => hasRole('admin'));

const activeTab = ref<'contacts' | 'locations' | 'tokens' | 'variables' | 'discovery'>('contacts');
const contacts        = ref<CompanyContact[]>([]);
const locations       = ref<CompanyLocation[]>([]);
const tokens          = ref<EnrollmentToken[]>([]);
const variables       = ref<CompanyVariable[]>([]);
const discoveryConfig   = ref<NetworkDiscoveryConfig | null>(null);
const discoveredDevices = ref<DiscoveredDevice[]>([]);
const companyDevices    = ref<Device[]>([]);

const eligibleProbeDevices = computed(() => companyDevices.value.filter(d =>
  d.status === 'approved' && (d.overrideClass ?? d.detectedClass) !== 'laptop'));

const hideDismissed = ref(true);
const visibleDiscoveredDevices = computed(() =>
  hideDismissed.value ? discoveredDevices.value.filter(d => !d.dismissed) : discoveredDevices.value);

// Contact modal
const contactModal      = ref({ open: false, editing: null as CompanyContact | null });
const contactForm       = ref({ name: '', title: '', email: '', phone: '', isPrimary: false });
const contactError      = ref('');
const contactSubmitting = ref(false);

// Location modal
const locationModal      = ref({ open: false, editing: null as CompanyLocation | null });
const locationForm       = ref({ name: '', isPrimary: false, address: { street: '', city: '', state: '', zip: '', country: '' } as Address });
const locationError      = ref('');
const locationSubmitting = ref(false);

// Variable modal
const variableModal      = ref({ open: false, editing: null as CompanyVariable | null });
const variableForm       = ref({ key: '', isSecret: false, value: '', description: '' });
const variableError      = ref('');
const variableSubmitting = ref(false);

// Discovery config form
const discoveryForm       = ref({ probeDeviceId: '', cidrRanges: [''], scanIntervalMinutes: 360, enabled: true, snmpEnabled: false, sshEnabled: false });
const discoveryError      = ref('');
const discoverySubmitting = ref(false);
const scanningNow         = ref(false);

// Token create
const showTokenForm = ref(false);
const creatingToken = ref(false);
const tokenError    = ref('');
const tokenForm     = ref({ maxUses: null as number | null, expiresInDays: null as number | null });

// Install modal
interface InstallCtx { token: string; companyName: string }
const installModal = ref<InstallCtx | null>(null);
const installOS    = ref<'windows' | 'linux' | 'darwin'>('windows');
const installArch  = ref<'amd64' | 'arm64'>('amd64');
const copiedField  = ref('');

const workerBase = computed(() => {
  const env = (import.meta.env.VITE_API_URL as string) ?? '';
  return env || window.location.origin;
});

const downloadURL = computed(() => {
  const os   = installOS.value === 'windows' ? 'windows' : installOS.value;
  const arch = installOS.value === 'windows' ? 'amd64' : installArch.value;
  return `${workerBase.value}/v1/agent/download?os=${os}&arch=${arch}`;
});

const oneLiner = computed(() => {
  if (!installModal.value) return '';
  const u = workerBase.value;
  const tok = installModal.value.token;
  const dl = downloadURL.value;
  if (installOS.value === 'windows') {
    return `$u="${u}"; $t=[IO.Path]::Combine([IO.Path]::GetTempPath(),'beacon-agent.exe'); (New-Object Net.WebClient).DownloadFile("${dl}",$t); & "$t" install --server-url $u --enroll-token ${tok}`;
  }
  return `sudo sh -c 'curl -fsSL "${dl}" -o /tmp/beacon-agent && chmod +x /tmp/beacon-agent && /tmp/beacon-agent install --server-url "${u}" --enroll-token "${tok}"'`;
});

// ── Load ─────────────────────────────────────────────────────
// No GET /v1/admin/companies/:id endpoint exists — the list endpoint is
// cheap at self-hosted scale (same reasoning CompaniesPage.vue's own list
// already relies on), so this page just filters the full list rather than
// adding a single-company backend route for one new page.
async function onIdChange() {
  loading.value = true;
  error.value = '';
  activeTab.value = 'contacts';
  contacts.value = [];
  locations.value = [];
  tokens.value = [];
  variables.value = [];
  discoveryConfig.value = null;
  discoveredDevices.value = [];
  companyDevices.value = [];
  try {
    const [all, c, l, t, v, dc, dd, allDevices] = await Promise.all([
      api.companies.list(),
      api.companies.contacts.list(companyId.value),
      api.companies.locations.list(companyId.value),
      api.companies.tokens.list(companyId.value),
      isAdmin.value ? api.companies.variables.list(companyId.value) : Promise.resolve([]),
      api.companies.discovery.get(companyId.value),
      api.companies.discoveredDevices.list(companyId.value),
      api.devices.list('approved'),
    ]);
    company.value = all.find(t => t.id === companyId.value) ?? null;
    if (!company.value) error.value = 'Company not found';
    contacts.value = c;
    locations.value = l;
    tokens.value = t;
    variables.value = v;
    discoveryConfig.value = dc;
    discoveredDevices.value = dd;
    companyDevices.value = allDevices.filter(d => d.companyId === companyId.value);
    resetDiscoveryForm();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// ── Status ──────────────────────────────────────────────────
async function setStatus(status: 'active' | 'suspended') {
  if (!company.value) return;
  await api.companies.update(company.value.id, { status });
  company.value.status = status;
}

// ── Contact CRUD ──────────────────────────────────────────────
function openContactCreate() {
  contactModal.value = { open: true, editing: null };
  contactForm.value  = { name: '', title: '', email: '', phone: '', isPrimary: contacts.value.length === 0 };
  contactError.value = '';
}

function openContactEdit(ct: CompanyContact) {
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
      await api.companies.contacts.update(companyId.value, contactModal.value.editing.id, body);
    } else {
      await api.companies.contacts.create(companyId.value, body);
    }
    contacts.value = await api.companies.contacts.list(companyId.value);
    syncPrimaryContact();
    contactModal.value.open = false;
  } catch (e: any) {
    contactError.value = e.message;
  } finally {
    contactSubmitting.value = false;
  }
}

async function deleteContact(contactId: string) {
  await api.companies.contacts.delete(companyId.value, contactId);
  contacts.value = contacts.value.filter(c => c.id !== contactId);
  syncPrimaryContact();
}

function syncPrimaryContact() {
  if (!company.value) return;
  const primary = contacts.value.find(c => c.isPrimary);
  company.value.primaryContactName  = primary?.name  ?? null;
  company.value.primaryContactEmail = primary?.email ?? null;
}

// ── Location CRUD ─────────────────────────────────────────────
function openLocationCreate() {
  locationModal.value = { open: true, editing: null };
  locationForm.value  = { name: '', isPrimary: locations.value.length === 0, address: { street: '', city: '', state: '', zip: '', country: 'United States' } };
  locationError.value = '';
}

function openLocationEdit(loc: CompanyLocation) {
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
      await api.companies.locations.update(companyId.value, locationModal.value.editing.id, body);
    } else {
      await api.companies.locations.create(companyId.value, body);
    }
    locations.value = await api.companies.locations.list(companyId.value);
    locationModal.value.open = false;
  } catch (e: any) {
    locationError.value = e.message;
  } finally {
    locationSubmitting.value = false;
  }
}

async function deleteLocation(locationId: string) {
  await api.companies.locations.delete(companyId.value, locationId);
  locations.value = locations.value.filter(l => l.id !== locationId);
}

// ── Variable CRUD ─────────────────────────────────────────────
function openVariableCreate() {
  variableModal.value = { open: true, editing: null };
  variableForm.value  = { key: '', isSecret: false, value: '', description: '' };
  variableError.value = '';
}

function openVariableEdit(v: CompanyVariable) {
  variableModal.value = { open: true, editing: v };
  variableForm.value  = { key: v.key, isSecret: v.isSecret, value: '', description: v.description ?? '' };
  variableError.value = '';
}

async function submitVariable() {
  if (!variableModal.value.editing) {
    if (!variableForm.value.key.trim()) { variableError.value = 'Key is required'; return; }
    if (!variableForm.value.value.trim()) { variableError.value = 'Value is required'; return; }
  }
  variableSubmitting.value = true;
  variableError.value = '';
  try {
    if (variableModal.value.editing) {
      await api.companies.variables.update(companyId.value, variableModal.value.editing.id, {
        value:       variableForm.value.value || undefined,
        description: variableForm.value.description || null,
      });
    } else {
      await api.companies.variables.create(companyId.value, {
        key:         variableForm.value.key.trim(),
        is_secret:   variableForm.value.isSecret,
        value:       variableForm.value.value,
        description: variableForm.value.description || null,
      });
    }
    variables.value = await api.companies.variables.list(companyId.value);
    variableModal.value.open = false;
  } catch (e: any) {
    variableError.value = e.message;
  } finally {
    variableSubmitting.value = false;
  }
}

async function deleteVariable(varId: string) {
  await api.companies.variables.delete(companyId.value, varId);
  variables.value = variables.value.filter(v => v.id !== varId);
}

// ── Network Discovery ─────────────────────────────────────────
function resetDiscoveryForm() {
  const cfg = discoveryConfig.value;
  discoveryForm.value = cfg
    ? { probeDeviceId: cfg.probeDeviceId, cidrRanges: [...cfg.cidrRanges], scanIntervalMinutes: cfg.scanIntervalMinutes, enabled: cfg.enabled, snmpEnabled: cfg.snmpEnabled, sshEnabled: cfg.sshEnabled }
    : { probeDeviceId: '', cidrRanges: [''], scanIntervalMinutes: 360, enabled: true, snmpEnabled: false, sshEnabled: false };
  discoveryError.value = '';
}

async function submitDiscoveryConfig() {
  const ranges = discoveryForm.value.cidrRanges.map(r => r.trim()).filter(Boolean);
  if (!discoveryForm.value.probeDeviceId) { discoveryError.value = 'Select a probe device'; return; }
  if (ranges.length === 0) { discoveryError.value = 'At least one CIDR range is required'; return; }

  discoverySubmitting.value = true;
  discoveryError.value = '';
  try {
    discoveryConfig.value = await api.companies.discovery.save(companyId.value, {
      probe_device_id: discoveryForm.value.probeDeviceId,
      cidr_ranges: ranges,
      scan_interval_minutes: discoveryForm.value.scanIntervalMinutes,
      enabled: discoveryForm.value.enabled,
      snmp_enabled: discoveryForm.value.snmpEnabled,
      ssh_enabled: discoveryForm.value.sshEnabled,
    });
    resetDiscoveryForm();
  } catch (e: any) {
    discoveryError.value = e.message;
  } finally {
    discoverySubmitting.value = false;
  }
}

async function scanNow() {
  if (!discoveryConfig.value) return;
  scanningNow.value = true;
  try {
    await api.companies.discovery.scanNow(companyId.value);
    discoveryConfig.value.lastScannedAt = Math.floor(Date.now() / 1000);
  } finally {
    scanningNow.value = false;
  }
}

async function toggleDismissed(dd: DiscoveredDevice) {
  await api.companies.discoveredDevices.update(companyId.value, dd.id, { dismissed: !dd.dismissed });
  dd.dismissed = !dd.dismissed;
}

async function deleteDiscoveredDevice(deviceId: string) {
  await api.companies.discoveredDevices.delete(companyId.value, deviceId);
  discoveredDevices.value = discoveredDevices.value.filter(d => d.id !== deviceId);
}

// ── Token CRUD ────────────────────────────────────────────────
async function submitToken() {
  creatingToken.value = true;
  tokenError.value = '';
  try {
    const result = await api.companies.tokens.create(companyId.value, {
      max_uses:        tokenForm.value.maxUses || null,
      expires_in_days: tokenForm.value.expiresInDays || null,
    });
    showTokenForm.value = false;
    installModal.value  = { token: result.raw_token, companyName: company.value?.name ?? '' };
    installOS.value     = 'windows';
    installArch.value   = 'amd64';
    copiedField.value   = '';
    tokenForm.value     = { maxUses: null, expiresInDays: null };
    tokens.value        = await api.companies.tokens.list(companyId.value);
  } catch (e: any) {
    tokenError.value = e.message;
  } finally {
    creatingToken.value = false;
  }
}

async function revokeToken(tokenId: string) {
  await api.companies.tokens.revoke(companyId.value, tokenId);
  const tok = tokens.value.find(t => t.id === tokenId);
  if (tok) tok.revokedAt = nowSec;
}

async function deleteToken(tokenId: string) {
  await api.companies.tokens.delete(companyId.value, tokenId);
  tokens.value = tokens.value.filter(t => t.id !== tokenId);
}

async function copyText(text: string, field: string) {
  await navigator.clipboard.writeText(text);
  copiedField.value = field;
  setTimeout(() => { if (copiedField.value === field) copiedField.value = ''; }, 2000);
}

// ── Helpers ───────────────────────────────────────────────────
function formatPhone(value: string): string {
  return value.replace(/[^\d\s+\-().x]/g, '').trim();
}

function addressLine(loc: CompanyLocation): string {
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

// Same reasoning as CompaniesPage.vue's identical helper: SNMP sysDescr and
// SSH os_info are two independent, sparse fields, and a discovered device
// realistically only ever has one populated.
function fingerprintText(dd: DiscoveredDevice): string {
  return dd.snmpSysDescr || dd.sshOsInfo || '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

watch(companyId, onIdChange, { immediate: true });
</script>

<style scoped>
.cd-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  padding: 14px 0 6px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 14px;
}
.cd-sum-item { display: flex; flex-direction: column; gap: 3px; }
.cd-sum-label {
  font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--color-text-muted);
}
.cd-sum-value { font-size: 13px; color: var(--color-text-primary); }
.cd-notes {
  font-size: 12px; color: var(--color-text-muted); margin: 0 0 16px;
  padding: 10px 12px; background: var(--color-surface-raised); border-radius: 6px;
}
.cd-tabs { padding: 0; margin-bottom: 0; }
.cd-tab-body { padding-top: 4px; }

/* ── Tab bar (verbatim from CompaniesPage.vue's expand-tab, not shared) ── */
.expand-head {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  gap: 0;
}
.expand-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color .12s, border-color .12s;
  margin-bottom: -1px;
}
.expand-tab:hover { color: var(--color-text-primary); }
.expand-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.tab-pill {
  font-size: 10px;
  font-weight: 600;
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  border-radius: 8px;
  padding: 1px 6px;
  line-height: 1.4;
}
.expand-tab.active .tab-pill { background: rgba(78,126,247,.12); color: var(--color-primary); }
.inner-table { width: 100%; }

/* ── Item cards (contacts & locations) ── */
.item-list {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--color-canvas);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  gap: 12px;
}
.item-info { flex: 1; min-width: 0; }
.item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
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
  color: var(--color-primary);
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
  background: var(--color-surface); border: 1px solid var(--color-border-strong);
  border-radius: 10px; width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-lg { width: 620px; }
.modal-head { padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; display: flex; align-items: flex-start; justify-content: space-between; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--color-text-subtle); font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; transition: color .12s; }
.modal-close:hover { color: var(--color-text-primary); }
.modal-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }

.form-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--color-text-muted); border-bottom: 1px solid var(--color-border); padding-bottom: 8px; margin-bottom: 14px;
}
.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.required { color: var(--color-danger); }
.toggle-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.toggle-row input[type=checkbox] { accent-color: var(--color-primary); width: 15px; height: 15px; margin-top: 2px; flex-shrink: 0; }

.token-reveal {
  background: var(--color-canvas); border: 1px solid var(--color-border-strong); border-radius: var(--r-btn);
  padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; cursor: pointer; overflow: hidden; transition: border-color .12s;
}
.token-reveal:hover { border-color: var(--color-primary); }
.copy-icon { width: 15px; height: 15px; flex-shrink: 0; color: var(--color-text-subtle); transition: color .12s; }
.token-reveal:hover .copy-icon { color: var(--color-primary); }
.copy-icon--done { color: var(--color-primary); }
code { font-family: var(--mono); font-size: 11px; background: var(--color-surface-raised); padding: 1px 5px; border-radius: 3px; color: var(--color-text-subtle); }
.field-hint { display: block; font-size: 11px; margin-top: 4px; }

/* ── Install modal ── */
.modal-install { width: 540px; }

.inst-section {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--color-border);
}
.inst-section:last-child { border-bottom: none; }

.inst-label {
  font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
  color: var(--color-text-muted); margin-bottom: 8px; display: flex; align-items: center;
}

.inst-os-tabs {
  display: flex; border-bottom: 1px solid var(--color-border); background: var(--color-surface);
}
.inst-os-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 16px; font-size: 12px; font-weight: 500;
  border: none; background: none; color: var(--color-text-muted); cursor: pointer;
  font-family: var(--font); border-bottom: 2px solid transparent;
  transition: color .1s, border-color .1s;
}
.inst-os-tab:hover { color: var(--color-text-primary); }
.inst-os-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

.inst-arch-row { display: flex; align-items: center; gap: 12px; padding: 10px 20px; }
.arch-toggle { display: flex; border: 1px solid var(--color-border-strong); border-radius: 5px; overflow: hidden; }
.arch-btn {
  padding: 4px 12px; font-size: 11px; font-weight: 600; border: none;
  background: none; color: var(--color-text-muted); cursor: pointer; font-family: var(--font);
  transition: background .1s, color .1s;
}
.arch-btn.active { background: var(--color-primary); color: #fff; }

.inst-dl-btn {
  display: inline-flex; align-items: center; gap: 7px;
  text-decoration: none;
}

.oneliner-wrap {
  position: relative;
  background: #080a11;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  overflow: hidden;
}
.oneliner-pre {
  margin: 0; padding: 12px 52px 12px 14px;
  font-family: var(--mono); font-size: 11px; line-height: 1.6;
  color: #c8d0e8; white-space: pre-wrap; word-break: break-all;
}
.oneliner-copy {
  position: absolute; top: 8px; right: 8px;
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.06); color: var(--color-text-muted);
  font-size: 11px; font-weight: 500; font-family: var(--font);
  cursor: pointer; transition: background .1s, color .1s;
}
.oneliner-copy:hover { background: rgba(255,255,255,.12); color: var(--color-text-primary); }

.discovery-panel { padding: 2px 0; }
.discovery-config { max-width: 620px; }
.cidr-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.cidr-row:first-of-type { margin-top: 6px; }
.cidr-row input { flex: 1; }
.dd-dismissed { opacity: .5; }
</style>
