<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/devices" class="pf-crumb-link">Devices</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ device?.hostname ?? (loading ? 'Loading…' : 'Not found') }}</span>
    </nav>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>
    <div v-else-if="!device" class="empty">
      <div class="empty-title">Device not found</div>
      <p class="empty-sub"><RouterLink to="/devices" style="color:var(--accent)">← Back to Devices</RouterLink></p>
    </div>

    <div v-else class="section-card ddev-card">

      <!-- Identity header -->
      <div class="ddev-header">
        <div class="ddev-header-name">
          <span class="ddev-status-dot" :class="isOnline(device) ? 'dot-online' : 'dot-offline'"
            :title="isOnline(device) ? 'Online' : 'Offline'"></span>
          <span class="ddev-hostname mono">{{ device.hostname ?? 'Unknown device' }}</span>
        </div>
        <svg v-if="isWindows(device)" class="ddev-os-icon" width="18" height="18" viewBox="0 0 16 16" fill="currentColor" title="Windows">
          <rect x="0" y="0" width="7" height="7"/><rect x="9" y="0" width="7" height="7"/>
          <rect x="0" y="9" width="7" height="7"/><rect x="9" y="9" width="7" height="7"/>
        </svg>
      </div>

      <!-- Management toolbar -->
      <div class="ddev-toolbar">
        <!-- Left: management actions -->
        <button class="toolbar-btn toolbar-btn-dim" title="Requires RustDesk integration — not yet configured" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
          </svg>
          Remote Session
        </button>
        <div class="toolbar-sep"></div>
        <button class="toolbar-btn" :disabled="device.status !== 'approved'" @click="openQuickJob()"
          :title="device.status !== 'approved' ? 'Device must be approved to receive commands' : ''">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Quick Job
        </button>

        <!-- Right: status actions + kebab -->
        <div style="flex:1"></div>

        <div v-if="jobQueued" class="toolbar-success">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Queued — runs on next check-in
        </div>

        <button v-if="device.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy" @click="approve(device.id)">Approve</button>
        <button v-if="device.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy" @click="revoke(device.id)">Revoke</button>
        <button v-if="device.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy" @click="approve(device.id)">Re-approve</button>

        <!-- Kebab menu -->
        <div class="kebab-wrap">
          <button class="toolbar-btn toolbar-btn-icon" @click="toggleMenu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          <div v-if="menuOpen" class="kebab-dropdown">
            <button class="kebab-item" :disabled="device.status !== 'approved'" @click="scheduleReboot(device)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
              </svg>
              Schedule Reboot
            </button>
            <button class="kebab-item kebab-item-dim" disabled>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Maintenance Window
              <span class="soon-tag">Soon</span>
            </button>
            <div class="kebab-sep"></div>
            <button class="kebab-item kebab-item-danger" @click="remove(device.id)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              Delete Device
            </button>
          </div>
        </div>
      </div>

      <!-- Section nav + content — one continuous page; nav just scrolls -->
      <div class="ddev-body">
        <nav class="ddev-nav">
          <button
            v-for="s in sections" :key="s.value"
            class="ddev-nav-item" :class="{ active: activeSection === s.value }"
            @click="scrollToSection(s.value)"
          >{{ s.label }}</button>
        </nav>

        <div class="ddev-content">

          <!-- ── Summary ── -->
          <section :id="'ddev-sec-summary'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Summary</h2>
            <div class="ddev-grid">
              <div class="ddev-section">
                <div class="ddev-section-title">System</div>
                <div class="ddev-row"><span class="ddev-label">Company</span><span class="text-sm">{{ device.tenantName ?? '—' }}</span></div>
                <div class="ddev-row">
                  <span class="ddev-label">Class</span>
                  <span class="text-sm">
                    {{ effectiveClass(device) ?? '—' }}
                    <span v-if="effectiveClass(device)" class="text-xs text-muted-2">({{ device.overrideClass ? 'manual' : 'auto' }})</span>
                  </span>
                </div>
                <div class="ddev-row"><span class="ddev-label">Enrolled</span><span class="text-sm">{{ absDate(device.createdAt) }}</span></div>
              </div>

              <div class="ddev-section">
                <div class="ddev-section-title">Identifiers</div>
                <div class="ddev-row"><span class="ddev-label">Device ID</span><span class="mono text-xs text-muted-2" style="user-select:all">{{ device.id }}</span></div>
                <div class="ddev-row"><span class="ddev-label">Agent</span><span class="mono text-sm">{{ device.agentVersion ?? '—' }}</span></div>
                <div v-if="avStatusOf(device)" class="ddev-row">
                  <span class="ddev-label">Antivirus</span>
                  <span :class="avBadgeClass(avStatusOf(device)!)">{{ AV_LABELS[avStatusOf(device)!] ?? avStatusOf(device) }}</span>
                </div>
              </div>

              <div class="ddev-section">
                <div class="ddev-section-title">Activity</div>
                <div class="ddev-row">
                  <span class="ddev-label">Last seen</span>
                  <span class="text-sm">{{ lastSeenLabel(device.lastSeen) }}<span v-if="device.lastSeen" class="text-xs text-muted-2"> · {{ absDate(device.lastSeen) }}</span></span>
                </div>
                <div v-if="lastRebootTs(device)" class="ddev-row">
                  <span class="ddev-label">Last Reboot</span><span class="text-sm">{{ absDate(lastRebootTs(device)!) }}</span>
                </div>
                <div v-if="auditData" class="ddev-row">
                  <span class="ddev-label">Last Audit</span><span class="text-sm">{{ absDate(auditData.createdAt) }}</span>
                </div>
                <template v-if="inventoryOf(device)">
                  <div class="ddev-row"><span class="ddev-label">Uptime</span><span class="text-sm">{{ formatUptime(inventoryOf(device)!.uptime_seconds) }}</span></div>
                </template>
              </div>
            </div>
          </section>

          <!-- ── System (OS + chassis identity — no metrics/network/storage here) ── -->
          <section :id="'ddev-sec-system'" class="ddev-page-section">
            <h2 class="ddev-section-heading">System</h2>
            <div v-if="auditLoading" class="inv-empty">Loading system info…</div>
            <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
              <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
            </div>
            <div v-else class="ddev-grid">
              <div class="ddev-section">
                <div class="ddev-section-title">System</div>
                <div class="ddev-row"><span class="ddev-label">OS</span><span class="text-sm">{{ osShortLabel(device) || '—' }}</span></div>
                <div v-if="osBuildLabel(device)" class="ddev-row"><span class="ddev-label">Version</span><span class="mono text-sm">{{ osBuildLabel(device) }}</span></div>
                <div v-if="auditData.hardware?.windows_display_version" class="ddev-row">
                  <span class="ddev-label">Display Ver.</span><span class="mono text-sm">{{ auditData.hardware.windows_display_version }}</span>
                </div>
                <div v-if="auditData.hardware?.windows_installation_type" class="ddev-row">
                  <span class="ddev-label">Install Type</span><span class="text-sm">{{ auditData.hardware.windows_installation_type }}</span>
                </div>
                <div v-if="auditData.hardware?.architecture" class="ddev-row">
                  <span class="ddev-label">Architecture</span><span class="text-sm">{{ archLabel(auditData.hardware.architecture) }}</span>
                </div>
                <div v-if="auditData.hardware?.virtualization" class="ddev-row">
                  <span class="ddev-label">Virtualization</span><span class="text-sm">{{ auditData.hardware.virtualization }}</span>
                </div>
                <div v-if="auditData.hardware?.domain" class="ddev-row">
                  <span class="ddev-label">Domain</span><span class="text-sm">{{ auditData.hardware.domain }}</span>
                </div>
                <div v-if="auditData.hardware?.last_logged_in_user" class="ddev-row">
                  <span class="ddev-label">Last User</span><span class="mono text-sm">{{ auditData.hardware.last_logged_in_user }}</span>
                </div>
                <div v-if="inventoryOf(device)?.av_product" class="ddev-row">
                  <span class="ddev-label">AV Product</span><span class="text-sm">{{ inventoryOf(device)!.av_product }}</span>
                </div>
                <div v-if="auditData.security" class="ddev-row">
                  <span class="ddev-label">Firewall</span><span class="text-sm">{{ auditData.security.firewall_enabled ? 'Yes' : 'No' }}</span>
                </div>
                <div class="ddev-row">
                  <span class="ddev-label">Warranty</span>
                  <input
                    type="date"
                    class="mono text-sm ddev-date-input"
                    :value="warrantyDateInput"
                    :disabled="warrantySaving"
                    @change="onWarrantyChange"
                  />
                  <span v-if="warrantySaving" class="text-xs text-muted-2">Saving…</span>
                </div>
                <div v-if="auditData.services" class="ddev-row">
                  <span class="ddev-label">Services</span>
                  <a class="text-sm" style="color:var(--accent);cursor:pointer" @click="scrollToSection('services')">{{ auditData.services.length }}</a>
                </div>
              </div>

              <div class="ddev-section">
                <div class="ddev-section-title">Hardware</div>
                <div v-if="auditData.hardware?.system?.manufacturer" class="ddev-row">
                  <span class="ddev-label">Manufacturer</span><span class="text-sm">{{ auditData.hardware.system.manufacturer }}</span>
                </div>
                <div v-if="auditData.hardware?.system?.model" class="ddev-row">
                  <span class="ddev-label">Model</span><span class="text-sm">{{ auditData.hardware.system.model }}</span>
                </div>
                <div v-if="auditData.hardware?.system?.motherboard_vendor || auditData.hardware?.system?.motherboard_model" class="ddev-row">
                  <span class="ddev-label">Motherboard</span>
                  <span class="text-sm">{{ [auditData.hardware.system?.motherboard_vendor, auditData.hardware.system?.motherboard_model].filter(Boolean).join(' ') }}</span>
                </div>
                <div v-if="auditData.hardware?.bios?.serial_number" class="ddev-row">
                  <span class="ddev-label">Serial</span><span class="mono text-sm" style="user-select:all">{{ auditData.hardware.bios.serial_number }}</span>
                </div>
                <div v-if="processorSummary()" class="ddev-row"><span class="ddev-label">Processor</span><span class="text-sm">{{ processorSummary() }}</span></div>
                <div v-if="totalCores()" class="ddev-row"><span class="ddev-label">Cores</span><span class="text-sm">{{ totalCores() }}</span></div>
                <div v-if="auditData.hardware?.bios" class="ddev-row">
                  <span class="ddev-label">BIOS</span><span class="text-sm">{{ auditData.hardware.bios.vendor }} {{ auditData.hardware.bios.version }}</span>
                </div>
                <div v-if="auditData.hardware?.bios?.release_date" class="ddev-row">
                  <span class="ddev-label">BIOS Released</span><span class="text-sm">{{ auditData.hardware.bios.release_date }}</span>
                </div>
                <div v-if="auditData.hardware?.display_adapters?.length" class="ddev-row">
                  <span class="ddev-label">Display</span><span class="text-sm">{{ auditData.hardware.display_adapters.join(', ') }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- ── Alerts (device-scoped) ── -->
          <section :id="'ddev-sec-alerts'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Alerts</h2>
            <div class="inv-tab-body">
              <div class="inv-toolbar">
                <span class="text-xs text-muted-2">Last 30 days, open + resolved</span>
                <button
                  class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px"
                  :disabled="!Object.keys(alertsSelected).length || alertsResolving"
                  @click="resolveSelectedAlerts"
                >{{ alertsResolving ? 'Resolving…' : 'Resolve' }}</button>
              </div>
              <div v-if="deviceAlertsLoading" class="inv-empty">Loading alerts…</div>
              <div v-else-if="deviceAlerts.length === 0" class="inv-empty">No alerts recorded for this device in the last 30 days.</div>
              <table v-else class="alert-mini-table">
                <thead>
                  <tr>
                    <th class="col-check"><input type="checkbox" :checked="alertsAllSelected" @change="toggleAlertSelectAll" /></th>
                    <th>Created</th>
                    <th>Priority</th>
                    <th>Category</th>
                    <th>Message</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="a in deviceAlerts" :key="a.id" @click="toggleAlertSelect(a.id)">
                    <td class="col-check" @click.stop><input type="checkbox" :checked="!!alertsSelected[a.id]" @change="toggleAlertSelect(a.id)" /></td>
                    <td class="mono text-xs text-muted-2">{{ absDate(a.alerted_at ?? a.updated_at) }}</td>
                    <td><span class="pri-badge" :class="`pri-${a.priority}`">{{ capitalize(a.priority) }}</span></td>
                    <td class="text-sm">{{ categoryLabel(a.check_type) }}</td>
                    <td class="text-sm">{{ alertMessage(a) }}</td>
                    <td>
                      <span class="status-pill" :class="a.is_alerting === 1 ? 'status-open' : 'status-resolved'">
                        {{ a.is_alerting === 1 ? 'Open' : 'Resolved' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- ── Policies (effective monitors) ── -->
          <section :id="'ddev-sec-policies'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Policies</h2>
            <div class="inv-tab-body">
              <div v-if="effectiveMonitorsLoading" class="inv-empty">Loading policies…</div>
              <div v-else-if="policyGroups.length === 0" class="inv-empty">No policies currently apply to this device.</div>
              <table v-else class="monitor-table" style="margin:12px 20px;width:calc(100% - 40px)">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Scope</th>
                    <th>Monitors</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="group in policyGroups" :key="group.policy.id" class="monitor-row"
                    style="cursor:pointer"
                    @click="router.push(`/global/policies/${group.policy.id}`)"
                  >
                    <td class="text-sm">{{ group.policy.name }}</td>
                    <td><span class="scope-badge" :class="'scope-' + group.policy.scope">{{ capitalize(group.policy.scope) }}</span></td>
                    <td class="tab-nums">{{ group.monitors.length }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- ── Software (audit) ── -->
          <section :id="'ddev-sec-software'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Software</h2>
            <div class="inv-tab-body">
              <div v-if="auditLoading" class="inv-empty">Loading inventory…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <template v-else-if="auditData.software?.length">
                <div class="inv-section">
                  <div class="inv-section-title">
                    Software
                    <span class="text-xs text-muted-2 normal-weight" style="margin-left:6px">{{ auditData.software.length }} installed</span>
                  </div>
                  <div style="padding:0 20px 8px">
                    <input v-model="softwareSearch" class="inv-search" placeholder="Search software…" />
                  </div>
                  <div class="sw-list">
                    <div v-for="sw in pagedSoftware" :key="sw.name" class="sw-row">
                      <span class="sw-name text-sm">{{ sw.name }}</span>
                      <span class="sw-ver mono text-xs text-muted-2">{{ sw.version || '—' }}</span>
                      <span v-if="sw.publisher" class="sw-pub text-xs text-muted-2">{{ sw.publisher }}</span>
                    </div>
                    <div v-if="filteredSoftware.length === 0" class="inv-empty-row">No matches</div>
                  </div>
                  <div class="inv-pagination">
                    <select v-model="swPageSize" class="pag-size-select">
                      <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }} per page</option>
                    </select>
                    <template v-if="softwarePageCount > 1">
                      <button class="pag-btn" :disabled="softwarePage === 0" @click="softwarePage--">‹</button>
                      <span class="pag-info text-xs text-muted-2">{{ softwarePage + 1 }} / {{ softwarePageCount }}</span>
                      <button class="pag-btn" :disabled="softwarePage >= softwarePageCount - 1" @click="softwarePage++">›</button>
                    </template>
                  </div>
                </div>
              </template>
              <div v-else class="inv-empty">No software data in the last audit.</div>
            </div>
          </section>

          <!-- ── Services (audit) ── -->
          <section :id="'ddev-sec-services'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Services</h2>
            <div class="inv-tab-body">
              <div v-if="auditLoading" class="inv-empty">Loading inventory…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <template v-else-if="auditData.services?.length">
                <div class="inv-section">
                  <div class="inv-section-title">
                    Services
                    <span class="text-xs text-muted-2 normal-weight" style="margin-left:6px">{{ auditData.services.length }} total</span>
                  </div>
                  <div class="svc-list">
                    <div v-for="svc in pagedServices" :key="svc.name" class="svc-row">
                      <span :class="['svc-dot', svc.status === 'running' ? 'svc-dot-run' : 'svc-dot-stop']"></span>
                      <span class="svc-name text-sm">{{ svc.display_name || svc.name }}</span>
                      <span v-if="svc.start_type" class="svc-start text-xs text-muted-2">{{ svc.start_type }}</span>
                    </div>
                  </div>
                  <div class="inv-pagination">
                    <select v-model="svcPageSize" class="pag-size-select">
                      <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }} per page</option>
                    </select>
                    <template v-if="servicesPageCount > 1">
                      <button class="pag-btn" :disabled="servicesPage === 0" @click="servicesPage--">‹</button>
                      <span class="pag-info text-xs text-muted-2">{{ servicesPage + 1 }} / {{ servicesPageCount }}</span>
                      <button class="pag-btn" :disabled="servicesPage >= servicesPageCount - 1" @click="servicesPage++">›</button>
                    </template>
                  </div>
                </div>
              </template>
              <div v-else class="inv-empty">No services data in the last audit.</div>
            </div>
          </section>

          <!-- ── Memory ── -->
          <section :id="'ddev-sec-memory'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Memory</h2>
            <div class="inv-tab-body">
              <div v-if="auditLoading" class="inv-empty">Loading memory info…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <div v-else-if="auditData.hardware?.ram" class="inv-section" style="padding:14px 20px">
                <div class="ddev-row"><span class="ddev-label">Usable</span><span class="text-sm">{{ formatBytes(auditData.hardware.ram.total_bytes) }}</span></div>
                <div v-if="auditData.hardware.ram.installed_bytes" class="ddev-row">
                  <span class="ddev-label">Installed</span><span class="text-sm">{{ formatBytes(auditData.hardware.ram.installed_bytes) }}</span>
                </div>
              </div>
              <div v-else class="inv-empty">No memory data in the last audit.</div>
            </div>
          </section>

          <!-- ── Storage ── -->
          <section :id="'ddev-sec-storage'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Storage</h2>
            <div class="inv-tab-body">
              <div v-if="auditLoading" class="inv-empty">Loading storage info…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <div v-else-if="auditData.hardware?.disks?.length" class="inv-section">
                <div v-for="disk in auditData.hardware.disks" :key="disk.device" class="inv-disk-row">
                  <span class="inv-disk-label mono text-xs">{{ disk.label }}</span>
                  <div class="inv-disk-bar-wrap">
                    <div class="inv-disk-bar" :style="{ width: ((disk.total_bytes - disk.free_bytes) / disk.total_bytes * 100).toFixed(1) + '%' }"></div>
                  </div>
                  <span class="inv-disk-stat text-xs text-muted-2">{{ formatBytes(disk.free_bytes) }} free / {{ formatBytes(disk.total_bytes) }}</span>
                </div>
              </div>
              <div v-else class="inv-empty">No storage data in the last audit.</div>
            </div>
          </section>

          <!-- ── Network ── -->
          <section :id="'ddev-sec-network'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Network</h2>
            <div class="inv-tab-body">
              <div class="inv-section" style="padding:14px 20px">
                <div class="ddev-row"><span class="ddev-label">External IP</span><span class="mono text-sm">{{ device.externalIp ?? '—' }}</span></div>
              </div>
              <div v-if="auditLoading" class="inv-empty">Loading network info…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <div v-else-if="auditData.hardware?.network?.length" class="inv-section">
                <div v-for="nic in auditData.hardware.network" :key="nic.hardware_addr" class="ddev-row" style="padding:8px 20px">
                  <span class="ddev-label">{{ nic.name }}</span>
                  <span class="mono text-xs text-muted-2">{{ nic.hardware_addr }}</span>
                  <span class="text-xs text-muted-2" style="margin-left:8px">{{ nic.addrs?.join(', ') }}</span>
                </div>
              </div>
              <div v-else class="inv-empty">No network data in the last audit.</div>
            </div>
          </section>

          <!-- ── Security (audit) ── -->
          <section :id="'ddev-sec-security'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Security</h2>
            <div class="inv-tab-body">
              <div v-if="auditLoading" class="inv-empty">Loading inventory…</div>
              <div v-else-if="!auditData" class="inv-empty" style="padding:12px 20px">
                <button class="btn btn-primary btn-sm" :disabled="device.status !== 'approved'" @click="runAuditNow(device.id)">Run Audit Now</button>
              </div>
              <template v-else-if="auditData.security">
                <div class="inv-section">
                  <div class="ddev-row" style="padding:12px 20px 8px">
                    <span class="ddev-label">Firewall</span>
                    <span :class="auditData.security.firewall_enabled ? 'inv-badge-ok' : 'inv-badge-warn'">
                      {{ auditData.security.firewall_enabled ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>
                  <div v-if="auditData.security.antivirus?.length" style="padding:0 20px 8px">
                    <div class="inv-sub-title">Antivirus</div>
                    <div v-for="av in auditData.security.antivirus" :key="av.name" class="inv-av-row">
                      <span class="text-sm">{{ av.name }}</span>
                      <span :class="av.enabled ? 'inv-badge-ok' : 'inv-badge-warn'" style="margin-left:8px">{{ av.enabled ? 'Active' : 'Inactive' }}</span>
                      <span :class="av.up_to_date ? 'inv-badge-ok' : 'inv-badge-warn'" style="margin-left:4px">{{ av.up_to_date ? 'Up to date' : 'Outdated' }}</span>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="inv-empty">No security data in the last audit.</div>
            </div>
          </section>

          <!-- ── Change Log ── -->
          <section :id="'ddev-sec-changelog'" class="ddev-page-section">
            <h2 class="ddev-section-heading">Change Log</h2>
            <div class="inv-tab-body">
              <div v-if="changesLoading" class="inv-empty">Loading change log…</div>
              <div v-else-if="changeGroups.length === 0" class="inv-empty">No changes recorded yet. Changes appear after two or more audits.</div>
              <div v-else>
                <div v-for="group in changeGroups" :key="group.auditId" class="chg-group">
                  <div class="chg-group-head">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Audit — {{ absDate(group.detectedAt) }}
                    <span class="chg-count">{{ group.changes.length }} change{{ group.changes.length !== 1 ? 's' : '' }}</span>
                  </div>
                  <div v-for="ch in group.changes" :key="ch.id" class="chg-row">
                    <span :class="['chg-badge', `chg-badge-${ch.category}`]">{{ ch.category }}</span>
                    <span :class="['chg-type', `chg-type-${ch.changeType}`]">{{ ch.changeType }}</span>
                    <span class="chg-name text-sm">{{ ch.itemName }}</span>
                    <template v-if="ch.field && (ch.oldValue || ch.newValue)">
                      <span class="text-xs text-muted-2 chg-field">{{ ch.field }}:</span>
                      <span class="chg-diff mono text-xs">
                        <span v-if="ch.oldValue" class="chg-old">{{ ch.oldValue }}</span>
                        <span v-if="ch.oldValue && ch.newValue" class="chg-arrow">→</span>
                        <span v-if="ch.newValue" class="chg-new">{{ ch.newValue }}</span>
                      </span>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>

    </div>

    <!-- Quick Job modal -->
    <div v-if="quickJobOpen" class="modal-backdrop" @click.self="quickJobOpen = false">
      <div class="modal modal-xl">
        <div class="modal-head">
          <div>
            <div class="modal-title">Quick Job</div>
            <div class="text-xs text-muted-2" style="margin-top:2px">
              <span class="mono">{{ device?.hostname }}</span> · runs on next check-in
            </div>
          </div>
          <!-- Tab switcher -->
          <div class="qj-tabs">
            <button class="qj-tab" :class="{ active: quickJobTab === 'library' }" @click="quickJobTab = 'library'">
              From Library
            </button>
            <button class="qj-tab" :class="{ active: quickJobTab === 'script'  }" @click="quickJobTab = 'script'">
              Write Script
            </button>
          </div>
        </div>

        <!-- Library tab -->
        <div v-if="quickJobTab === 'library'" class="modal-body qj-library-body">
          <div v-if="libraryLoading" class="qj-lib-empty">Loading component library…</div>
          <div v-else-if="libraryComponents.length === 0" class="qj-lib-empty">
            No components in library yet —
            <router-link to="/components" @click="quickJobOpen = false" style="color:var(--accent)">create some</router-link>
            or use Write Script.
          </div>
          <div v-else class="qj-lib-layout">
            <!-- Component list -->
            <div class="qj-lib-list">
              <input v-model="libSearch" class="qj-lib-search" placeholder="Search components…" />
              <div
                v-for="comp in filteredLib" :key="comp.id"
                class="qj-lib-item"
                :class="{ selected: selectedComponent?.id === comp.id }"
                @click="selectedComponent = comp"
              >
                <div class="qj-lib-name">{{ comp.name }}</div>
                <div class="qj-lib-meta">
                  <span v-if="comp.category" class="qj-lib-cat">{{ comp.category }}</span>
                  <span class="qj-lib-shell">{{ shellLabel(comp.shell) }}</span>
                </div>
              </div>
            </div>
            <!-- Preview -->
            <div class="qj-lib-preview">
              <div v-if="!selectedComponent" class="qj-lib-empty" style="padding:20px">
                Select a component to preview
              </div>
              <div v-else class="qj-lib-preview-inner">
                <div class="qj-preview-head">
                  <div class="qj-preview-name">{{ selectedComponent.name }}</div>
                  <div v-if="selectedComponent.description" class="text-xs text-muted-2">{{ selectedComponent.description }}</div>
                </div>
                <pre class="qj-preview-script">{{ selectedComponent.script }}</pre>
                <div v-if="selectedComponent.variables.length" class="qj-preview-vars">
                  <ComponentVariablePrompt
                    ref="quickJobVarPrompt"
                    :variables="selectedComponent.variables"
                    :values="quickJobVariableValues"
                    @update:values="v => { quickJobVariableValues = v }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Write Script tab -->
        <div v-else class="modal-body">
          <div class="field">
            <label>Shell</label>
            <select v-model="quickJobForm.shell">
              <option value="auto">Auto — PowerShell on Windows, Bash on Linux / macOS</option>
              <option value="powershell">PowerShell (Windows)</option>
              <option value="bash">Bash (Linux / macOS)</option>
              <option value="sh">sh (POSIX)</option>
            </select>
          </div>
          <div class="field" style="margin-top:12px">
            <label>Script <span class="required">*</span></label>
            <textarea
              v-model="quickJobForm.script"
              placeholder="# Your script here…"
              rows="9"
              class="code-area"
            ></textarea>
          </div>
          <div style="display:flex;align-items:center;gap:16px;margin-top:12px">
            <div class="field" style="flex:0 0 auto">
              <label>Timeout (seconds)</label>
              <input v-model="quickJobForm.timeout" type="number" min="1" placeholder="300" style="max-width:120px" />
            </div>
            <div class="field" style="flex:1;align-self:flex-end;padding-bottom:2px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" v-model="quickJobForm.saveToLibrary" />
                Save to Component Library
              </label>
              <div v-if="quickJobForm.saveToLibrary" style="margin-top:8px">
                <input v-model="quickJobForm.libraryName" type="text" placeholder="Component name…" />
              </div>
            </div>
          </div>
        </div>

        <div v-if="quickJobError" class="error-banner" style="margin:0 20px 12px">{{ quickJobError }}</div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="quickJobOpen = false">Cancel</button>
          <button class="btn btn-primary" :disabled="quickJobBusy" @click="submitQuickJob">
            {{ quickJobBusy ? 'Queuing…' : 'Queue Job' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Device, type Component, type DeviceAudit, type AuditChange, type AlertState, type EffectiveMonitor } from '../api';
import ComponentVariablePrompt from '../components/ComponentVariablePrompt.vue';

interface DiskInfo {
  device: string;
  label: string;
  fs_type: string;
  total_bytes: number;
  free_bytes: number;
}

interface Inventory {
  hostname: string;
  os_type: string;
  os_version: string;
  uptime_seconds: number;
  disk_free_bytes: number;
  disks?: DiskInfo[];
  detected_class: string;
  av_status?: string;
  av_product?: string;
}

const route  = useRoute();
const router = useRouter();

const device  = ref<Device | null>(null);
const loading = ref(true);
const error   = ref('');
const busy    = ref(false);
const now     = ref(Math.floor(Date.now() / 1000));

// Section nav — driven by ?section= so it's linkable, matching the same
// query-param-as-view-state idiom used by DevicesPage/GlobalAlertsPage.
const sections = [
  { value: 'summary',   label: 'Summary' },
  { value: 'system',    label: 'System' },
  { value: 'alerts',    label: 'Alerts' },
  { value: 'policies',  label: 'Policies' },
  { value: 'software',  label: 'Software' },
  { value: 'services',  label: 'Services' },
  { value: 'memory',    label: 'Memory' },
  { value: 'storage',   label: 'Storage' },
  { value: 'network',   label: 'Network' },
  { value: 'security',  label: 'Security' },
  { value: 'changelog', label: 'Change Log' },
];
// This is one continuous page, not tabs — activeSection only tracks which
// nav item to highlight, it never hides/shows content. Clicking a nav item
// scrolls to that section and updates ?section= (via replace, not push, so
// scrolling around doesn't spam browser history) purely so the URL stays
// linkable/shareable to a specific spot on the page.
const activeSection = ref((route.query.section as string | undefined) ?? 'summary');

function scrollNow(s: string, smooth = true) {
  document.getElementById('ddev-sec-' + s)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

function scrollToSection(s: string) {
  activeSection.value = s;
  router.replace({ query: { ...route.query, section: s } });
  scrollNow(s);
}

// Covers ?section= changing without a device switch (e.g. a pasted/edited
// URL while this device's page is already mounted) — scrollToSection above
// already handles the click case directly and updates activeSection first,
// so this no-ops for clicks (guard prevents a redundant duplicate scroll).
watch(() => route.query.section as string | undefined, (s) => {
  const target = s ?? 'summary';
  if (activeSection.value === target) return;
  activeSection.value = target;
  requestAnimationFrame(() => scrollNow(target));
});

// Device detail tab state
const auditData       = ref<DeviceAudit | null>(null);
const auditLoading    = ref(false);
const auditChanges    = ref<AuditChange[]>([]);
const changesLoading  = ref(false);
const softwareSearch  = ref('');
const softwarePage    = ref(0);
const servicesPage    = ref(0);

// Alerts section (device-scoped)
const deviceAlerts        = ref<AlertState[]>([]);
const deviceAlertsLoading = ref(false);
const alertsSelected      = reactive<Record<string, boolean>>({});
const alertsResolving     = ref(false);

// Policies section (effective monitors for this device)
const effectiveMonitors        = ref<EffectiveMonitor[]>([]);
const effectiveMonitorsLoading = ref(false);
const swPageSize      = ref(20);
const svcPageSize     = ref(20);
const PAGE_SIZES      = [20, 50, 100];

// Toolbar state
const menuOpen  = ref(false);
const jobQueued = ref(false);

// Quick Job modal
const quickJobOpen  = ref(false);
const quickJobTab   = ref<'library' | 'script'>('library');
const quickJobForm  = ref({ shell: 'auto', script: '', timeout: '', saveToLibrary: false, libraryName: '' });
const quickJobError = ref('');
const quickJobBusy  = ref(false);
const quickJobVariableValues = ref<Record<string, string>>({});
const quickJobVarPrompt = ref<{ validate: () => string | null } | null>(null);

// Component library (loaded once per page visit)
const libraryComponents = ref<Component[]>([]);
const libraryLoading    = ref(false);
const selectedComponent = ref<Component | null>(null);
const libSearch         = ref('');

watch(selectedComponent, () => { quickJobVariableValues.value = {}; });

// Just refreshes the device row itself (used by the 30s poll) — does not
// touch tab/audit/changelog state, so it doesn't disturb whatever the user
// is currently looking at.
async function loadDevice(id: string) {
  try {
    device.value = await api.devices.get(id);
  } catch {
    device.value = null;
  }
}

async function loadChangeLog() {
  if (!device.value) return;
  changesLoading.value = true;
  try { auditChanges.value = await api.devices.audit.changes(device.value.id); }
  finally { changesLoading.value = false; }
}

async function loadDeviceAlerts() {
  if (!device.value) return;
  deviceAlertsLoading.value = true;
  try { deviceAlerts.value = await api.alerts.list('all', '', '', device.value.id); }
  catch { deviceAlerts.value = []; }
  finally { deviceAlertsLoading.value = false; }
}

async function loadEffectiveMonitors() {
  if (!device.value) return;
  effectiveMonitorsLoading.value = true;
  try { effectiveMonitors.value = await api.devices.effectiveMonitors(device.value.id); }
  catch { effectiveMonitors.value = []; }
  finally { effectiveMonitorsLoading.value = false; }
}

// Runs whenever the route's :id actually changes (including the initial
// load) — resets audit/changelog/alerts/policies/pagination state and
// eagerly fetches everything, since this is one continuous scrollable page
// now (no per-section lazy-loading — every section is visible at once, so
// there's no "activation" moment to hang a lazy fetch off of).
async function onIdChange(id: string | undefined) {
  if (!id) return;
  loading.value = true;
  error.value = '';
  now.value = Math.floor(Date.now() / 1000);
  auditData.value = null;
  auditChanges.value = [];
  deviceAlerts.value = [];
  effectiveMonitors.value = [];
  softwareSearch.value = '';
  softwarePage.value = 0;
  servicesPage.value = 0;

  await loadDevice(id);
  loading.value = false;
  if (!device.value) return;

  auditLoading.value = true;
  const auditPromise = api.devices.audit.latest(device.value.id)
    .then(data => { auditData.value = data; })
    .catch(() => { /* leave null — "Run Audit Now" empty state covers this */ })
    .finally(() => { auditLoading.value = false; });

  await Promise.all([auditPromise, loadChangeLog(), loadDeviceAlerts(), loadEffectiveMonitors()]);

  // Deep-link support: jump to whatever ?section= names (or Summary/top for
  // a plain device switch that doesn't carry one), now that everything's
  // rendered. A rAF is a safe, dependency-free way to wait one paint before
  // measuring scrollIntoView's target.
  const target = (route.query.section as string | undefined) ?? 'summary';
  activeSection.value = target;
  requestAnimationFrame(() => scrollNow(target, false));

  // Section elements persist across a device switch (same v-if, same static
  // template — Vue patches in place rather than recreating them), so the
  // observer only needs to be wired up once, the first time they exist.
  if (!scrollSpy) requestAnimationFrame(setupScrollSpy);
}

// watch (not onMounted) since Vue Router reuses this component instance
// across param-only navigations (e.g. clicking from one device's page to
// another via a hostname link elsewhere) — onMounted alone wouldn't refire.
watch(() => route.params.id as string | undefined, onIdChange, { immediate: true });

// Scroll-spy: highlights whichever section is currently in view as the user
// scrolls manually, on top of the explicit click-to-scroll navigation above.
// Deliberately doesn't touch the URL/?section= here — only clicking a nav
// item does that — so casually scrolling through the page doesn't spam
// history or rewrite the address bar underneath the user.
let scrollSpy: IntersectionObserver | null = null;
let scrollSpyRoot: HTMLElement | null = null;
let onScrollSpyScroll: (() => void) | null = null;

function setupScrollSpy() {
  const root = document.querySelector('.page') as HTMLElement | null;
  const targets = sections
    .map(s => document.getElementById('ddev-sec-' + s.value))
    .filter((el): el is HTMLElement => el !== null);
  if (!root || targets.length === 0) return;

  // Bottom-of-scroll special case: trailing sections (e.g. Change Log) are
  // often shorter than the detection band below, so a taller earlier section
  // can still win the "topmost" tie-break even once you've scrolled all the
  // way down — same edge case Bootstrap's own scrollspy special-cases.
  // Applied as the last step of every recomputation so it always has final
  // say over the plain topmost-wins logic once you're at the scroll floor.
  const atBottom = () => root.scrollTop + root.clientHeight >= root.scrollHeight - 2;

  scrollSpy = new IntersectionObserver(
    (entries) => {
      if (atBottom()) { activeSection.value = sections[sections.length - 1].value; return; }
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length === 0) return;
      // Topmost visible section — the one whose heading is closest to (or
      // just past) the top of the viewport counts as "where you are."
      const topMost = visible.reduce((a, b) =>
        a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
      );
      activeSection.value = topMost.target.id.replace('ddev-sec-', '');
    },
    { root, rootMargin: '-16px 0px -70% 0px', threshold: 0 }
  );
  targets.forEach(el => scrollSpy!.observe(el));

  // A scroll increment landing exactly on the floor doesn't always change
  // any target's isIntersecting state, so the IO callback above may not
  // fire for it at all — a plain 'scroll' listener catches that remaining
  // case. Deferred one macrotask so it runs after any IO callback the same
  // scroll *did* trigger, rather than racing it. `.page` is the app-wide
  // persistent scroll container (outlives this page component across
  // navigations), so the listener is torn down explicitly on unmount.
  scrollSpyRoot = root;
  onScrollSpyScroll = () => {
    setTimeout(() => { if (atBottom()) activeSection.value = sections[sections.length - 1].value; }, 0);
  };
  root.addEventListener('scroll', onScrollSpyScroll, { passive: true });
}

let timer: ReturnType<typeof setInterval>;
timer = setInterval(() => {
  now.value = Math.floor(Date.now() / 1000);
  const id = route.params.id as string | undefined;
  if (id) loadDevice(id);
}, 30_000);
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener('click', closeMenuOnce);
  scrollSpy?.disconnect();
  if (scrollSpyRoot && onScrollSpyScroll) scrollSpyRoot.removeEventListener('scroll', onScrollSpyScroll);
});

function toggleAlertSelect(id: string) {
  if (alertsSelected[id]) delete alertsSelected[id];
  else alertsSelected[id] = true;
}

const alertsAllSelected = computed(() =>
  deviceAlerts.value.length > 0 && deviceAlerts.value.every(a => alertsSelected[a.id])
);

function toggleAlertSelectAll() {
  if (alertsAllSelected.value) deviceAlerts.value.forEach(a => delete alertsSelected[a.id]);
  else deviceAlerts.value.forEach(a => { alertsSelected[a.id] = true; });
}

async function resolveSelectedAlerts() {
  const ids = Object.keys(alertsSelected);
  if (!ids.length) return;
  alertsResolving.value = true;
  try {
    await Promise.all(ids.map(id => api.alerts.resolve(id)));
    ids.forEach(id => delete alertsSelected[id]);
    await loadDeviceAlerts();
  } finally {
    alertsResolving.value = false;
  }
}

interface PolicyGroup { policy: EffectiveMonitor['policy']; monitors: EffectiveMonitor[] }
const policyGroups = computed((): PolicyGroup[] => {
  const map = new Map<string, PolicyGroup>();
  for (const m of effectiveMonitors.value) {
    let g = map.get(m.policy.id);
    if (!g) { g = { policy: m.policy, monitors: [] }; map.set(m.policy.id, g); }
    g.monitors.push(m);
  }
  return [...map.values()];
});

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Duplicated from GlobalAlertsPage.vue per this codebase's established
// per-component duplication convention ──
function categoryLabel(ct: string): string {
  switch (ct) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Online Status';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    case 'av_status':    return 'Antivirus';
    case 'file_size':    return 'File/Folder Size';
    case 'ping':         return 'Ping';
    case 'process':      return 'Process';
    case 'service':      return 'Service';
    case 'software':     return 'Software';
    default:             return ct;
  }
}

function alertMessage(a: AlertState): string {
  try {
    const cfg = JSON.parse(a.config) as Record<string, unknown>;
    switch (a.check_type) {
      case 'offline': {
        const direction = (cfg.direction as string) ?? 'offline';
        return direction === 'online' ? 'Device came online' : 'Device went offline';
      }
      case 'disk_space': {
        const drive = (cfg.drive as string) === 'any' ? 'A drive' : (cfg.drive as string);
        const type  = (cfg.threshold_type as string) ?? 'gb_free';
        const value = cfg.threshold_value as number;
        const unit  = type === 'percent_used' ? '%' : ' GB';
        const label = type === 'gb_free' ? 'free space' : type === 'percent_used' ? 'used' : 'used space';
        const cmp   = type === 'gb_free' ? 'below' : 'above';
        return `${drive} ${label} ${cmp} ${value}${unit}`;
      }
      case 'cpu_usage':    return `CPU usage above ${cfg.percent_max}%`;
      case 'memory_usage': return `Memory usage above ${cfg.percent_max}%`;
      case 'av_status': {
        const state = cfg.av_state as string;
        if (state === 'not_detected')          return 'AV not detected';
        if (state === 'not_running')            return 'AV not running';
        if (state === 'running_not_up_to_date') return 'AV out of date';
        return 'Antivirus issue';
      }
      case 'file_size': {
        const cmp = (cfg.mode as string) === 'over' ? 'above' : 'below';
        return `${cfg.path} ${cmp} ${cfg.threshold_mb} MB`;
      }
      case 'ping': return `${cfg.target} failing ping conditions`;
      case 'process': {
        const mode = cfg.mode as string;
        if (mode === 'running' || mode === 'stopped') return `${cfg.process_name} is ${mode}`;
        return `${cfg.process_name} ${mode} above ${cfg.threshold_pct}%`;
      }
      case 'service': {
        const mode = cfg.mode as string;
        if (mode === 'running' || mode === 'stopped') return `${cfg.service_name} is ${mode}`;
        return `${cfg.service_name} ${mode} above ${cfg.threshold_pct}%`;
      }
      case 'software': {
        const mode = cfg.mode as string;
        const verb = mode === 'installed' ? 'was installed' : mode === 'uninstalled' ? 'was uninstalled' : 'changed version';
        return `${cfg.name_pattern} ${verb}`;
      }
      default: return a.check_type;
    }
  } catch {
    return a.check_type;
  }
}

function toggleMenu() {
  if (menuOpen.value) {
    menuOpen.value = false;
  } else {
    menuOpen.value = true;
    setTimeout(() => document.addEventListener('click', closeMenuOnce, { once: true }), 0);
  }
}
function closeMenuOnce() { menuOpen.value = false; }

// ── Duplicated from DevicesPage.vue (also needed there for the list row) ──
function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}
function effectiveClass(d: Device) { return d.overrideClass ?? d.detectedClass; }
function isWindows(d: Device) { return (d.osType ?? '').toLowerCase() === 'windows'; }

// Same vocabulary/labels as OverviewPage.vue's antivirus-status widget —
// duplicated per this codebase's established per-component convention.
const AV_LABELS: Record<string, string> = {
  running_up_to_date:     'Up to date',
  running_not_up_to_date: 'Out of date',
  not_running:            'Not running',
  not_detected:            'Not detected',
  unknown:                'Unknown',
};
function avStatusOf(d: Device): string | null {
  return inventoryOf(d)?.av_status ?? null;
}
function avBadgeClass(status: string): string {
  if (status === 'running_up_to_date') return 'inv-badge-ok';
  if (status === 'running_not_up_to_date') return 'inv-badge-warn';
  if (status === 'unknown') return 'inv-badge-muted';
  return 'inv-badge-danger';
}
// There's no dedicated boot-time field — derived from the most recent
// check-in's uptime sample, which is as fresh as lastSeen itself.
function lastRebootTs(d: Device): number | null {
  const uptime = inventoryOf(d)?.uptime_seconds;
  if (!d.lastSeen || uptime == null) return null;
  return d.lastSeen - uptime;
}
function osShortLabel(d: Device) {
  if (!d.osType) return '—';
  const raw = d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
  const m = raw.match(/Windows\s+\d+\s+\w+/i);
  if (m) return m[0];
  const linuxM = raw.match(/^linux\s+(.+?)(?:\s+\d+\.\d+\.\d+-.*)?$/i);
  if (linuxM) return linuxM[1];
  return raw;
}
function lastSeenLabel(ts: number | null) {
  if (!ts) return 'Never';
  const diff = now.value - ts;
  if (diff < 90)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Detail-only helpers ──
function inventoryOf(d: Device): Inventory | null {
  if (!d.inventory) return null;
  try { return JSON.parse(d.inventory) as Inventory; }
  catch { return null; }
}
function osBuildLabel(d: Device) {
  if (!d.osVersion) return null;
  const m = d.osVersion.match(/(\d+\.\d+(?:\.\d+)+)/g);
  return m ? m[m.length - 1] : null;
}
function processorSummary(): string | null {
  const cpus = auditData.value?.hardware?.cpu;
  if (!cpus?.length) return null;
  return cpus.map(c => c.model).join(', ');
}
function totalCores(): number | null {
  const cpus = auditData.value?.hardware?.cpu;
  if (!cpus?.length) return null;
  return cpus.reduce((sum, c) => sum + (c.cores ?? 0), 0);
}
function archLabel(arch: string): string {
  if (arch === 'amd64' || arch === 'arm64') return '64-bit';
  if (arch === '386') return '32-bit';
  return arch;
}

// Warranty expiration — manually entered, no agent collector (see
// migrations/0019). <input type="date"> works in local (unzoned) calendar
// days, so store/compare at UTC midnight to avoid off-by-one-day drift.
const warrantySaving = ref(false);
const warrantyDateInput = computed(() => {
  const ts = device.value?.warrantyExpiresAt;
  if (!ts) return '';
  return new Date(ts * 1000).toISOString().slice(0, 10);
});
async function onWarrantyChange(e: Event) {
  if (!device.value) return;
  const val = (e.target as HTMLInputElement).value;
  const ts = val ? Math.floor(new Date(`${val}T00:00:00Z`).getTime() / 1000) : null;
  warrantySaving.value = true;
  try {
    await api.devices.update(device.value.id, { warranty_expires_at: ts });
    device.value.warrantyExpiresAt = ts;
  } finally {
    warrantySaving.value = false;
  }
}
function absDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}

const filteredSoftware = computed(() => {
  const list = auditData.value?.software ?? [];
  const q = softwareSearch.value.toLowerCase().trim();
  return q ? list.filter(s => s.name.toLowerCase().includes(q) || s.version.toLowerCase().includes(q)) : list;
});
const softwarePageCount = computed(() => Math.ceil(filteredSoftware.value.length / swPageSize.value));
const pagedSoftware     = computed(() => filteredSoftware.value.slice(softwarePage.value * swPageSize.value, (softwarePage.value + 1) * swPageSize.value));
const servicesPageCount = computed(() => Math.ceil((auditData.value?.services?.length ?? 0) / svcPageSize.value));
const pagedServices     = computed(() => (auditData.value?.services ?? []).slice(servicesPage.value * svcPageSize.value, (servicesPage.value + 1) * svcPageSize.value));

watch(softwareSearch, () => { softwarePage.value = 0; });
watch(swPageSize,     () => { softwarePage.value = 0; });
watch(svcPageSize,    () => { servicesPage.value = 0; });

interface ChangeGroup { auditId: string; detectedAt: number; changes: AuditChange[] }
const changeGroups = computed((): ChangeGroup[] => {
  const map = new Map<string, ChangeGroup>();
  for (const ch of auditChanges.value) {
    let g = map.get(ch.auditId);
    if (!g) { g = { auditId: ch.auditId, detectedAt: ch.detectedAt, changes: [] }; map.set(ch.auditId, g); }
    g.changes.push(ch);
  }
  return [...map.values()].sort((a, b) => b.detectedAt - a.detectedAt);
});

async function runAuditNow(deviceId: string) {
  try {
    await api.devices.commands.create(deviceId, { type: 'run_audit' });
    showJobQueued();
  } catch (e: any) { error.value = e.message; }
}

// Sidebar's pendingCount badge lives in App.vue (polled every 30s) —
// dispatch this so it refreshes immediately after an action taken here.
function notifyPendingChanged() {
  window.dispatchEvent(new Event('beacon:pending-changed'));
}

async function approve(id: string) {
  busy.value = true;
  try {
    await api.devices.approve(id);
    if (device.value) { device.value.status = 'approved'; device.value.approvedAt = now.value; }
    notifyPendingChanged();
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = false; }
}

async function revoke(id: string) {
  busy.value = true;
  try {
    await api.devices.revoke(id);
    if (device.value) device.value.status = 'revoked';
    notifyPendingChanged();
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = false; }
}

async function remove(id: string) {
  menuOpen.value = false;
  busy.value = true;
  try {
    await api.devices.delete(id);
    notifyPendingChanged();
    router.push('/devices');
  } catch (e: any) { error.value = e.message; busy.value = false; }
}

async function scheduleReboot(d: Device) {
  menuOpen.value = false;
  try {
    await api.devices.commands.create(d.id, { type: 'reboot' });
    showJobQueued();
  } catch (e: any) {
    error.value = e.message;
  }
}

function showJobQueued() {
  jobQueued.value = true;
  setTimeout(() => { jobQueued.value = false; }, 4000);
}

const filteredLib = computed(() => {
  if (!libSearch.value.trim()) return libraryComponents.value;
  const q = libSearch.value.toLowerCase();
  return libraryComponents.value.filter(c =>
    c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)
  );
});

async function openQuickJob() {
  quickJobOpen.value = true;
  quickJobTab.value = 'library';
  quickJobForm.value = { shell: 'auto', script: '', timeout: '', saveToLibrary: false, libraryName: '' };
  quickJobError.value = '';
  selectedComponent.value = null;
  libSearch.value = '';
  if (libraryComponents.value.length === 0) {
    libraryLoading.value = true;
    try { libraryComponents.value = await api.components.list(device.value?.tenantId); }
    finally { libraryLoading.value = false; }
  }
}

async function submitQuickJob() {
  if (!device.value) return;
  quickJobBusy.value = true;
  quickJobError.value = '';
  const dev = device.value;

  try {
    let componentRef: import('../api').ComponentRef;
    let jobName: string;

    if (quickJobTab.value === 'library') {
      if (!selectedComponent.value) { quickJobError.value = 'Select a component'; return; }
      const varErr = quickJobVarPrompt.value?.validate();
      if (varErr) { quickJobError.value = varErr; return; }
      componentRef = {
        type: 'library', component_id: selectedComponent.value.id, order: 1,
        variable_values: quickJobVariableValues.value,
      };
      jobName = `Quick Job — ${selectedComponent.value.name}`;
    } else {
      const script = quickJobForm.value.script.trim();
      if (!script) { quickJobError.value = 'Script is required'; return; }

      if (quickJobForm.value.saveToLibrary) {
        const libName = quickJobForm.value.libraryName.trim() || script.split('\n')[0].slice(0, 40);
        const saved = await api.components.create({
          name:   libName,
          shell:  quickJobForm.value.shell,
          script,
          timeout_seconds: parseInt(quickJobForm.value.timeout) || 300,
        });
        libraryComponents.value = [saved, ...libraryComponents.value];
        componentRef = { type: 'library', component_id: saved.id, order: 1 };
        jobName = `Quick Job — ${saved.name}`;
      } else {
        componentRef = {
          type: 'inline',
          shell: quickJobForm.value.shell,
          script,
          timeout_seconds: parseInt(quickJobForm.value.timeout) || 300,
          order: 1,
        };
        const firstLine = script.split('\n')[0].trim();
        jobName = `Quick Job — ${firstLine.length > 50 ? firstLine.slice(0, 50) + '…' : firstLine}`;
      }
    }

    await api.jobs.create({
      name:        jobName,
      type:        'quick',
      components:  [componentRef],
      target_type: 'devices',
      target_ids:  [dev.id],
    });

    quickJobOpen.value = false;
    showJobQueued();
  } catch (e: any) {
    quickJobError.value = e.message;
  } finally {
    quickJobBusy.value = false;
  }
}

function shellLabel(shell: string): string {
  return { auto: 'Auto', powershell: 'PowerShell', bash: 'Bash', sh: 'sh', cmd: 'CMD' }[shell] ?? shell;
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* ── Breadcrumb (copied from PolicyFormPage.vue) ── */
.pf-crumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted); margin-bottom: 14px;
}
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* ── Identity header ── */
.ddev-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ddev-header-name { display: flex; align-items: center; gap: 10px; }
.ddev-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dot-online  { background: var(--teal); box-shadow: 0 0 0 3px rgba(45,207,160,.15); }
.dot-offline { background: var(--muted); }
.ddev-hostname { font-size: 22px; font-weight: 700; color: var(--text); }
.ddev-os-icon { color: var(--muted-2); flex-shrink: 0; }

/* ── Management toolbar ── */
.ddev-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--r-btn);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font);
  cursor: pointer;
  transition: background .1s, border-color .1s, color .1s;
  white-space: nowrap;
}
.toolbar-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border-2); }
.toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.toolbar-btn-dim { opacity: .45; }
.toolbar-btn-dim:hover { opacity: .45; background: none; border-color: transparent; }
.toolbar-btn-icon { padding: 5px 8px; }
.toolbar-sep {
  width: 1px; height: 20px; background: var(--border-2);
  margin: 0 4px; flex-shrink: 0;
}
.toolbar-success {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--teal);
  font-weight: 500;
  padding: 0 8px;
}

/* ── Kebab menu ── */
.kebab-wrap { position: relative; }
.kebab-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
  min-width: 200px;
  z-index: 50;
  overflow: hidden;
  padding: 4px 0;
}
.kebab-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 14px;
  background: none;
  border: none;
  color: var(--text);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
  transition: background .1s;
}
.kebab-item:hover:not(:disabled) { background: var(--surface-2); }
.kebab-item:disabled { cursor: default; }
.kebab-item-dim { opacity: .45; }
.kebab-item-danger { color: var(--red); }
.kebab-item-danger:hover:not(:disabled) { background: rgba(232,86,106,.08); }
.kebab-sep { height: 1px; background: var(--border); margin: 4px 0; }
.soon-tag {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  background: var(--surface-2);
  color: var(--muted);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Detail grid ── */
.ddev-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.ddev-section { padding: 14px 20px; border-right: 1px solid var(--border); }
.ddev-section:last-child { border-right: none; }
.ddev-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 10px;
}
.ddev-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; }
.ddev-label { font-size: 12px; color: var(--muted); min-width: 76px; flex-shrink: 0; }
.ddev-date-input {
  background: var(--bg); border: 1px solid var(--border-2); border-radius: 4px;
  padding: 3px 6px; color: var(--text); font-family: var(--font);
}
.ddev-date-input:focus { outline: none; border-color: var(--accent); }

/* Bumped up from the app's global .text-sm/.text-xs (12px/11px) — scoped to
   just this page since Vue scoped styles auto-namespace class selectors,
   not a global change; this page reads text-dense enough to warrant it. */
.text-sm { font-size: 13px; }
.text-xs { font-size: 12px; }

/* ── Quick Job modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border-2); border-radius: 10px;
  width: 440px; box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden;
  max-height: 90vh; display: flex; flex-direction: column;
}
.modal-xl  { width: 860px; }
.modal-head {
  padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }
.required { color: var(--red); }

/* ── Quick Job tab switcher ── */
.qj-tabs { display: flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; flex-shrink: 0; }
.qj-tab { padding: 5px 14px; font-size: 11px; font-weight: 600; border: none; background: none; color: var(--muted); cursor: pointer; font-family: var(--font); transition: background .1s, color .1s; }
.qj-tab.active { background: var(--accent); color: #fff; }

/* ── Library tab layout ── */
.qj-library-body { padding: 0; overflow: hidden; display: flex; flex-direction: column; max-height: 60vh; }
.qj-lib-empty { padding: 24px 20px; font-size: 12px; color: var(--muted); text-align: center; }
.qj-lib-layout { display: grid; grid-template-columns: 260px 1fr; height: 420px; }
.qj-lib-list { border-right: 1px solid var(--border); overflow-y: auto; display: flex; flex-direction: column; }
.qj-lib-search {
  margin: 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--bg); color: var(--text); font-size: 12px; font-family: var(--font); outline: none; flex-shrink: 0;
}
.qj-lib-search:focus { border-color: var(--accent); }
.qj-lib-item { padding: 9px 14px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background .1s; }
.qj-lib-item:hover { background: var(--surface-2); }
.qj-lib-item.selected { background: rgba(78,126,247,.1); border-left: 2px solid var(--accent); }
.qj-lib-name { font-size: 12px; font-weight: 500; color: var(--text); }
.qj-lib-meta { display: flex; gap: 6px; margin-top: 3px; }
.qj-lib-cat { font-size: 10px; color: var(--accent); }
.qj-lib-shell { font-size: 10px; color: var(--muted); font-family: var(--mono); }
.qj-lib-preview { overflow-y: auto; display: flex; flex-direction: column; }
.qj-lib-preview-inner { display: flex; flex-direction: column; height: 100%; }
.qj-preview-head { padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.qj-preview-name { font-size: 13px; font-weight: 600; color: var(--text); }
.qj-preview-script {
  flex: 1; margin: 0; padding: 12px 16px;
  font-family: var(--mono); font-size: 12px; line-height: 1.6;
  color: #c8d0e8; background: #080a11; white-space: pre-wrap; word-break: break-all; overflow-y: auto;
}
.qj-preview-vars { flex-shrink: 0; padding: 12px 16px; border-top: 1px solid var(--border); }

.code-area {
  width: 100%;
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 10px 12px; color: var(--text); font-size: 12px; font-family: var(--mono);
  resize: vertical; outline: none; transition: border-color .12s; line-height: 1.6;
}
.code-area:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }

/* ── Section left-nav ── */
/* Overrides .section-card's global overflow:hidden (style.css) — required
   for .ddev-nav's position:sticky below to work at all; a clipping
   ancestor between a sticky element and its scroll container breaks it. */
.section-card.ddev-card { overflow: visible; }

.ddev-body { display: flex; align-items: stretch; min-height: 0; }
.ddev-nav {
  width: 170px; flex-shrink: 0; border-right: 1px solid var(--border);
  padding: 10px 0; background: var(--surface);
  position: sticky; top: 12px; align-self: flex-start;
}
.ddev-nav-item {
  display: block; width: 100%; text-align: left; padding: 7px 16px;
  font-size: 12px; color: var(--muted); background: none; border: none;
  border-left: 2px solid transparent; cursor: pointer; font-family: var(--font);
  transition: background .1s, color .1s, border-color .1s;
}
.ddev-nav-item:hover { background: var(--surface-2); color: var(--text); }
.ddev-nav-item.active { background: rgba(78,126,247,.1); color: var(--accent); border-left-color: var(--accent); font-weight: 500; }
.ddev-content { flex: 1; min-width: 0; }

/* ── Page sections (one continuous scroll, nav just scrolls to these) ──
   Each section gets a distinct title bar (same visual weight as the app's
   established .section-card-head pattern) so sections read as clearly
   separate chunks instead of one long run-on block. */
.ddev-page-section { border-bottom: 6px solid var(--bg); scroll-margin-top: 16px; }
.ddev-page-section:last-child { border-bottom: none; }
.ddev-section-heading {
  display: flex; align-items: center;
  font-size: 14px; font-weight: 700; color: var(--text);
  padding: 13px 20px; margin: 0;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  letter-spacing: .01em;
}

/* ── Alerts section (device-scoped) — duplicated per-component convention ── */
.alert-mini-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.alert-mini-table th {
  padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.alert-mini-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.alert-mini-table tr:last-child td { border-bottom: none; }
.alert-mini-table tr { cursor: pointer; transition: background .08s; }
.alert-mini-table tr:hover td { background: var(--surface-2); }
.alert-mini-table .col-check { width: 32px; }
.status-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.status-open     { color: var(--text); }
.status-resolved { color: var(--muted-2); }
.pri-badge {
  display: inline-block; padding: 1px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 700; white-space: nowrap;
}
.pri-critical { background: var(--red);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--amber); color: #1a1200; }
.pri-low      { background: var(--muted); color: var(--surface); }

/* ── Policies section — duplicated per-component convention ── */
.scope-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.scope-global  { background: rgba(78,126,247,.14);  color: var(--accent); }
.scope-company { background: rgba(45,207,160,.14);  color: var(--teal); }
.monitor-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
  border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
}
.monitor-table th {
  padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.monitor-row td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: middle; }
.monitor-row:last-child td { border-bottom: none; }
.monitor-row:hover td { background: rgba(255,255,255,.02); }
.tab-nums { font-variant-numeric: tabular-nums; color: var(--muted); }

/* ── Inventory tab ── */
.inv-tab-body {}
.inv-empty { padding: 20px; font-size: 12px; color: var(--muted); text-align: center; }
.inv-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--surface);
}
.inv-section { border-bottom: 1px solid var(--border); padding: 12px 0 4px; }
.inv-section-title {
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); padding: 0 20px 8px; display: flex; align-items: center;
}
.normal-weight { font-weight: 400; letter-spacing: 0; text-transform: none; }
.inv-subsection { padding: 0 0 8px; }
.inv-sub-title {
  font-size: 10px; font-weight: 600; color: var(--muted); padding: 0 20px 4px;
  text-transform: uppercase; letter-spacing: .05em;
}
.inv-badge-ok     { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(45,207,160,.12); color: var(--teal); }
.inv-badge-warn   { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(240,168,64,.12);  color: var(--amber); }
.inv-badge-danger { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(232,86,106,.12);  color: #e8566a; }
.inv-badge-muted  { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(97,100,128,.15);  color: var(--muted); }
.inv-av-row { display: flex; align-items: center; margin-bottom: 6px; }
.inv-disk-row { display: flex; align-items: center; gap: 8px; padding: 2px 20px 4px; }
.inv-disk-label { min-width: 90px; flex-shrink: 0; }
.inv-disk-bar-wrap { flex: 1; height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.inv-disk-bar { height: 100%; background: var(--accent); border-radius: 2px; transition: width .3s; }
.inv-disk-stat { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.inv-search {
  width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--bg); color: var(--text); font-size: 12px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.inv-search:focus { border-color: var(--accent); }
.sw-list { border-top: 1px solid var(--border); }
.inv-pagination { display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-top: 1px solid var(--border); }
.pag-btn { background: none; border: 1px solid var(--border-2); border-radius: 4px; color: var(--text); cursor: pointer; padding: 2px 8px; font-size: 14px; line-height: 1.4; transition: border-color .12s; }
.pag-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pag-btn:disabled { opacity: .35; cursor: default; }
.pag-info { min-width: 48px; text-align: center; }
.pag-size-select { background: var(--surface); border: 1px solid var(--border-2); border-radius: 4px; color: var(--text); font-size: 11px; padding: 2px 6px; cursor: pointer; margin-right: auto; }
.pag-size-select:focus { outline: none; border-color: var(--accent); }
.sw-row { display: flex; align-items: baseline; gap: 10px; padding: 5px 20px; border-bottom: 1px solid rgba(255,255,255,.03); }
.sw-row:last-child { border-bottom: none; }
.sw-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.sw-ver  { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.sw-pub  { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inv-empty-row { padding: 10px 20px; font-size: 12px; color: var(--muted); }
.svc-list { border-top: 1px solid var(--border); }
.svc-row { display: flex; align-items: center; gap: 8px; padding: 5px 20px; border-bottom: 1px solid rgba(255,255,255,.03); }
.svc-row:last-child { border-bottom: none; }
.svc-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.svc-dot-run  { background: var(--teal); }
.svc-dot-stop { background: var(--border-2); }
.svc-name  { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc-start { flex-shrink: 0; }

/* ── Change log tab ── */
.chg-group { border-bottom: 1px solid var(--border); }
.chg-group-head {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 20px; font-size: 11px; font-weight: 600; color: var(--muted);
  background: var(--surface);
}
.chg-count {
  margin-left: auto; font-size: 10px; font-weight: 600; padding: 1px 6px;
  border-radius: 10px; background: var(--border-2); color: var(--muted);
}
.chg-row { display: flex; align-items: center; gap: 8px; padding: 6px 20px; border-top: 1px solid rgba(255,255,255,.03); }
.chg-badge {
  font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
}
.chg-badge-software { background: rgba(78,126,247,.12); color: var(--accent); }
.chg-badge-hardware { background: rgba(160,78,247,.12); color: #a04ef7; }
.chg-badge-services { background: rgba(240,168,64,.12);  color: var(--amber); }
.chg-badge-security { background: rgba(232,86,106,.12);  color: var(--red); }
.chg-type {
  font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.chg-type-added   { color: var(--teal); }
.chg-type-removed { color: var(--red); }
.chg-type-changed { color: var(--muted); }
.chg-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chg-field { flex-shrink: 0; }
.chg-diff { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.chg-old   { color: var(--red); text-decoration: line-through; }
.chg-arrow { color: var(--muted); }
.chg-new   { color: var(--teal); }
</style>
