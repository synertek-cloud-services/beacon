<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="section-card">
      <div class="section-card-head">
        <div class="tabs" style="border:none;margin:0">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="tab"
            :class="{ active: activeTab === tab.value }"
            @click="activeTab = tab.value; expandedId = null"
          >
            {{ tab.label }}
            <span class="tab-count">{{ countFor(tab.value) }}</span>
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visibleDevices.length === 0" class="empty">
        <div class="empty-title">No {{ activeTab === 'all' ? '' : activeTab }} devices</div>
        <p class="empty-sub" v-if="activeTab === 'pending'">Devices appear here after enrolling with a token.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>OS</th>
            <th>Class</th>
            <th>Agent</th>
            <th>Last Seen</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="d in visibleDevices" :key="d.id">
            <tr
              :class="['device-row', expandedId === d.id ? 'device-row-active' : '']"
              style="cursor:pointer"
              @click="toggleExpanded(d.id)"
            >
              <td>
                <span :class="['status-dot', isOnline(d) ? 'dot-online' : d.status === 'pending' ? 'dot-pending' : 'dot-offline']"></span>
                <span class="mono text-sm">{{ d.hostname ?? '—' }}</span>
              </td>
              <td class="text-muted-2 text-sm">{{ osLabel(d) }}</td>
              <td class="text-muted-2 text-sm">{{ effectiveClass(d) ?? '—' }}</td>
              <td class="mono text-xs text-muted-2">{{ d.agentVersion ?? '—' }}</td>
              <td class="text-muted-2 text-sm">{{ lastSeenLabel(d.lastSeen) }}</td>
              <td><span :class="`badge badge-${d.status}`">{{ d.status }}</span></td>
              <td>
                <div class="actions" @click.stop>
                  <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                  <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                  <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>
                </div>
              </td>
            </tr>

            <!-- Inline detail expansion -->
            <tr v-if="expandedId === d.id" class="expand-row">
              <td colspan="7" :class="['expand-cell', isOnline(d) ? 'border-online' : d.status === 'pending' ? 'border-pending' : 'border-offline']">

                <!-- Identity header -->
                <div class="ddev-header">
                  <div>
                    <div class="ddev-hostname mono">{{ d.hostname ?? 'Unknown device' }}</div>
                    <div class="ddev-sub">
                      <span :class="isOnline(d) ? 'pill-online' : 'pill-offline'">
                        {{ isOnline(d) ? '● Online' : '● Offline' }}
                      </span>
                      <span class="ddev-sep">·</span>
                      <span class="text-xs text-muted-2">{{ d.status }}</span>
                      <template v-if="d.osType">
                        <span class="ddev-sep">·</span>
                        <span class="text-xs text-muted-2">{{ osLabel(d) }}</span>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Management toolbar -->
                <div class="ddev-toolbar" @click.stop>
                  <!-- Left: management actions -->
                  <button class="toolbar-btn toolbar-btn-dim" title="Requires RustDesk integration — not yet configured" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
                    </svg>
                    Remote Session
                  </button>
                  <div class="toolbar-sep"></div>
                  <button class="toolbar-btn" :disabled="d.status !== 'approved'" @click="openQuickJob(d)"
                    :title="d.status !== 'approved' ? 'Device must be approved to receive commands' : ''">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    Quick Job
                  </button>

                  <!-- Right: status actions + kebab -->
                  <div style="flex:1"></div>

                  <div v-if="jobQueued === d.id" class="toolbar-success">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Queued — runs on next check-in
                  </div>

                  <button v-if="d.status === 'pending'"  class="btn btn-primary btn-sm" :disabled="busy === d.id" @click="approve(d.id)">Approve</button>
                  <button v-if="d.status === 'approved'" class="btn btn-danger btn-sm"  :disabled="busy === d.id" @click="revoke(d.id)">Revoke</button>
                  <button v-if="d.status === 'revoked'"  class="btn btn-ghost btn-sm"   :disabled="busy === d.id" @click="approve(d.id)">Re-approve</button>

                  <!-- Kebab menu -->
                  <div class="kebab-wrap">
                    <button class="toolbar-btn toolbar-btn-icon" @click="toggleMenu(d.id)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>
                    <div v-if="menuDeviceId === d.id" class="kebab-dropdown">
                      <button class="kebab-item" :disabled="d.status !== 'approved'" @click="scheduleReboot(d)">
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
                      <button class="kebab-item kebab-item-danger" @click="remove(d.id)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                        Delete Device
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Device detail tab bar -->
                <div class="ddev-tabs" @click.stop>
                  <button class="ddev-tab" :class="{ active: activeDeviceTab === 'details' }"   @click="setDeviceTab('details',   d.id)">Details</button>
                  <button class="ddev-tab" :class="{ active: activeDeviceTab === 'inventory' }" @click="setDeviceTab('inventory', d.id)">Inventory</button>
                  <button class="ddev-tab" :class="{ active: activeDeviceTab === 'changelog' }" @click="setDeviceTab('changelog', d.id)">Change Log</button>
                </div>

                <!-- ── Details tab ── -->
                <template v-if="activeDeviceTab === 'details'">

                <!-- Detail grid -->
                <div class="ddev-grid">
                  <div class="ddev-section">
                    <div class="ddev-section-title">System</div>
                    <div class="ddev-row"><span class="ddev-label">Hostname</span><span class="mono text-sm">{{ d.hostname ?? '—' }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">OS</span><span class="text-sm">{{ osLabel(d) || '—' }}</span></div>
                    <div class="ddev-row">
                      <span class="ddev-label">Class</span>
                      <span class="text-sm">
                        {{ effectiveClass(d) ?? '—' }}
                        <span v-if="effectiveClass(d)" class="text-xs text-muted-2">({{ d.overrideClass ? 'manual' : 'auto' }})</span>
                      </span>
                    </div>
                    <div class="ddev-row"><span class="ddev-label">Agent</span><span class="mono text-sm">{{ d.agentVersion ?? '—' }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Device ID</span><span class="mono text-xs text-muted-2" style="user-select:all">{{ d.id }}</span></div>
                  </div>

                  <div class="ddev-section">
                    <div class="ddev-section-title">Activity</div>
                    <div class="ddev-row">
                      <span class="ddev-label">Last seen</span>
                      <span class="text-sm">{{ lastSeenLabel(d.lastSeen) }}<span v-if="d.lastSeen" class="text-xs text-muted-2"> · {{ absDate(d.lastSeen) }}</span></span>
                    </div>
                    <div class="ddev-row"><span class="ddev-label">Enrolled</span><span class="text-sm">{{ absDate(d.createdAt) }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Approved</span><span class="text-sm">{{ d.approvedAt ? absDate(d.approvedAt) : '—' }}</span></div>
                  </div>

                  <div v-if="inventoryOf(d)" class="ddev-section">
                    <div class="ddev-section-title">Hardware</div>
                    <div class="ddev-row"><span class="ddev-label">Uptime</span><span class="text-sm">{{ formatUptime(inventoryOf(d)!.uptime_seconds) }}</span></div>
                    <div class="ddev-row"><span class="ddev-label">Disk free</span><span class="text-sm">{{ formatBytes(inventoryOf(d)!.disk_free_bytes) }}</span></div>
                  </div>
                </div>

                </template><!-- end details tab -->

                <!-- ── Inventory tab ── -->
                <div v-else-if="activeDeviceTab === 'inventory'" class="inv-tab-body" @click.stop>
                  <div v-if="auditLoading" class="inv-empty">Loading inventory…</div>
                  <div v-else-if="!auditData" class="inv-empty">
                    <div style="margin-bottom:10px">No audit recorded yet.</div>
                    <button class="btn btn-primary btn-sm" :disabled="d.status !== 'approved'" @click="runAuditNow(d.id)">Run Audit Now</button>
                  </div>
                  <template v-else>
                    <div class="inv-toolbar">
                      <span class="text-xs text-muted-2">Last audit: {{ absDate(auditData.createdAt) }}</span>
                      <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" :disabled="d.status !== 'approved'" @click="runAuditNow(d.id)">Run Audit Now</button>
                    </div>

                    <!-- Hardware -->
                    <div v-if="auditData.hardware" class="inv-section">
                      <div class="inv-section-title">Hardware</div>
                      <div v-if="auditData.hardware.cpu?.length" class="inv-subsection">
                        <div class="inv-sub-title">CPU</div>
                        <div v-for="c in auditData.hardware.cpu" :key="c.model" class="ddev-row">
                          <span class="ddev-label">Model</span><span class="text-sm">{{ c.model }}</span>
                          <span class="ddev-label" style="margin-left:16px">Cores</span><span class="text-sm">{{ c.cores }}</span>
                          <span class="ddev-label" style="margin-left:16px">Speed</span><span class="text-sm">{{ c.speed_mhz.toFixed(0) }} MHz</span>
                        </div>
                      </div>
                      <div class="ddev-row" style="padding:0 20px 6px">
                        <span class="ddev-label">RAM</span>
                        <span class="text-sm">{{ formatBytes(auditData.hardware.ram.total_bytes) }}</span>
                      </div>
                      <div v-if="auditData.hardware.disks?.length" class="inv-subsection">
                        <div class="inv-sub-title">Disks</div>
                        <div v-for="disk in auditData.hardware.disks" :key="disk.device" class="inv-disk-row">
                          <span class="inv-disk-label mono text-xs">{{ disk.label }}</span>
                          <div class="inv-disk-bar-wrap">
                            <div class="inv-disk-bar" :style="{ width: ((disk.total_bytes - disk.free_bytes) / disk.total_bytes * 100).toFixed(1) + '%' }"></div>
                          </div>
                          <span class="inv-disk-stat text-xs text-muted-2">{{ formatBytes(disk.free_bytes) }} free / {{ formatBytes(disk.total_bytes) }}</span>
                        </div>
                      </div>
                      <div v-if="auditData.hardware.network?.length" class="inv-subsection">
                        <div class="inv-sub-title">Network Adapters</div>
                        <div v-for="nic in auditData.hardware.network" :key="nic.hardware_addr" class="ddev-row" style="padding:0 20px 4px">
                          <span class="ddev-label">{{ nic.name }}</span>
                          <span class="mono text-xs text-muted-2">{{ nic.hardware_addr }}</span>
                          <span class="text-xs text-muted-2" style="margin-left:8px">{{ nic.addrs?.join(', ') }}</span>
                        </div>
                      </div>
                      <div v-if="auditData.hardware.bios" class="ddev-row" style="padding:0 20px 6px">
                        <span class="ddev-label">BIOS</span>
                        <span class="text-sm">{{ auditData.hardware.bios.vendor }} {{ auditData.hardware.bios.version }}</span>
                        <span v-if="auditData.hardware.bios.release_date" class="text-xs text-muted-2" style="margin-left:8px">{{ auditData.hardware.bios.release_date }}</span>
                      </div>
                    </div>

                    <!-- Security -->
                    <div v-if="auditData.security" class="inv-section">
                      <div class="inv-section-title">Security</div>
                      <div class="ddev-row" style="padding:0 20px 8px">
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

                    <!-- Software -->
                    <div v-if="auditData.software?.length" class="inv-section">
                      <div class="inv-section-title">
                        Software
                        <span class="text-xs text-muted-2 normal-weight" style="margin-left:6px">{{ auditData.software.length }} installed</span>
                      </div>
                      <div style="padding:0 20px 8px">
                        <input v-model="softwareSearch" class="inv-search" placeholder="Search software…" />
                      </div>
                      <div class="sw-list">
                        <div v-for="sw in filteredSoftware" :key="sw.name" class="sw-row">
                          <span class="sw-name text-sm">{{ sw.name }}</span>
                          <span class="sw-ver mono text-xs text-muted-2">{{ sw.version || '—' }}</span>
                          <span v-if="sw.publisher" class="sw-pub text-xs text-muted-2">{{ sw.publisher }}</span>
                        </div>
                        <div v-if="filteredSoftware.length === 0" class="inv-empty-row">No matches</div>
                      </div>
                    </div>

                    <!-- Services -->
                    <div v-if="auditData.services?.length" class="inv-section">
                      <div class="inv-section-title">
                        Services
                        <span class="text-xs text-muted-2 normal-weight" style="margin-left:6px">{{ auditData.services.length }} total</span>
                      </div>
                      <div class="svc-list">
                        <div v-for="svc in auditData.services" :key="svc.name" class="svc-row">
                          <span :class="['svc-dot', svc.status === 'running' ? 'svc-dot-run' : 'svc-dot-stop']"></span>
                          <span class="svc-name text-sm">{{ svc.display_name || svc.name }}</span>
                          <span v-if="svc.start_type" class="svc-start text-xs text-muted-2">{{ svc.start_type }}</span>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>

                <!-- ── Change Log tab ── -->
                <div v-else-if="activeDeviceTab === 'changelog'" class="inv-tab-body" @click.stop>
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

              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Quick Job modal -->
    <div v-if="quickJobDevice" class="modal-backdrop" @click.self="quickJobDevice = null">
      <div class="modal modal-xl">
        <div class="modal-head">
          <div>
            <div class="modal-title">Quick Job</div>
            <div class="text-xs text-muted-2" style="margin-top:2px">
              <span class="mono">{{ quickJobDevice.hostname }}</span> · runs on next check-in
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
            <router-link to="/components" @click="quickJobDevice = null" style="color:var(--accent)">create some</router-link>
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
          <button class="btn btn-ghost" @click="quickJobDevice = null">Cancel</button>
          <button class="btn btn-primary" :disabled="quickJobBusy" @click="submitQuickJob">
            {{ quickJobBusy ? 'Queuing…' : 'Queue Job' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type Device, type Component, type DeviceAudit, type AuditChange } from '../api';

interface Inventory {
  hostname: string;
  os_type: string;
  os_version: string;
  uptime_seconds: number;
  disk_free_bytes: number;
  detected_class: string;
}

const devices    = ref<Device[]>([]);
const loading    = ref(true);
const error      = ref('');
const busy       = ref<string | null>(null);
const activeTab  = ref<'all' | 'pending' | 'approved' | 'revoked'>('all');
const expandedId = ref<string | null>(null);

// Device detail tab state
const activeDeviceTab = ref<'details' | 'inventory' | 'changelog'>('details');
const auditData       = ref<DeviceAudit | null>(null);
const auditLoading    = ref(false);
const auditChanges    = ref<AuditChange[]>([]);
const changesLoading  = ref(false);
const softwareSearch  = ref('');

// Toolbar state
const menuDeviceId  = ref<string | null>(null);
const jobQueued     = ref<string | null>(null);


// Quick Job modal
const quickJobDevice  = ref<Device | null>(null);
const quickJobTab     = ref<'library' | 'script'>('library');
const quickJobForm    = ref({ shell: 'auto', script: '', timeout: '', saveToLibrary: false, libraryName: '' });
const quickJobError   = ref('');
const quickJobBusy    = ref(false);

// Component library (loaded once, shared)
const libraryComponents  = ref<Component[]>([]);
const libraryLoading     = ref(false);
const selectedComponent  = ref<Component | null>(null);
const libSearch          = ref('');

const tabs = [
  { label: 'All',      value: 'all'      as const },
  { label: 'Pending',  value: 'pending'  as const },
  { label: 'Approved', value: 'approved' as const },
  { label: 'Revoked',  value: 'revoked'  as const },
];

const now = ref(Math.floor(Date.now() / 1000));

const visibleDevices = computed(() =>
  activeTab.value === 'all' ? devices.value : devices.value.filter(d => d.status === activeTab.value)
);

function countFor(tab: typeof activeTab.value) {
  return tab === 'all' ? devices.value.length : devices.value.filter(d => d.status === tab).length;
}

function toggleExpanded(id: string) {
  menuDeviceId.value = null;
  if (expandedId.value === id) {
    expandedId.value = null;
  } else {
    expandedId.value = id;
    activeDeviceTab.value = 'details';
    auditData.value = null;
    auditChanges.value = [];
    softwareSearch.value = '';
  }
}

async function setDeviceTab(tab: typeof activeDeviceTab.value, deviceId: string) {
  activeDeviceTab.value = tab;
  if (tab === 'inventory' && !auditData.value) {
    auditLoading.value = true;
    try { auditData.value = await api.devices.audit.latest(deviceId); }
    finally { auditLoading.value = false; }
  }
  if (tab === 'changelog' && auditChanges.value.length === 0) {
    changesLoading.value = true;
    try { auditChanges.value = await api.devices.audit.changes(deviceId); }
    finally { changesLoading.value = false; }
  }
}


function toggleMenu(id: string) {
  if (menuDeviceId.value === id) {
    menuDeviceId.value = null;
  } else {
    menuDeviceId.value = id;
    setTimeout(() => document.addEventListener('click', closeMenuOnce, { once: true }), 0);
  }
}

function closeMenuOnce() { menuDeviceId.value = null; }

function isOnline(d: Device) {
  return d.status === 'approved' && d.lastSeen != null && d.lastSeen > now.value - 300;
}

function inventoryOf(d: Device): Inventory | null {
  if (!d.inventory) return null;
  try { return JSON.parse(d.inventory) as Inventory; }
  catch { return null; }
}

async function load() {
  now.value = Math.floor(Date.now() / 1000);
  loading.value = devices.value.length === 0;
  error.value = '';
  try {
    devices.value = await api.devices.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function approve(id: string) {
  busy.value = id;
  try {
    await api.devices.approve(id);
    const d = devices.value.find(x => x.id === id);
    if (d) { d.status = 'approved'; d.approvedAt = now.value; }
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

async function revoke(id: string) {
  busy.value = id;
  try {
    await api.devices.revoke(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'revoked';
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

async function remove(id: string) {
  menuDeviceId.value = null;
  busy.value = id;
  try {
    await api.devices.delete(id);
    devices.value = devices.value.filter(x => x.id !== id);
    if (expandedId.value === id) expandedId.value = null;
  } catch (e: any) { error.value = e.message; }
  finally { busy.value = null; }
}

const filteredLib = computed(() => {
  if (!libSearch.value.trim()) return libraryComponents.value;
  const q = libSearch.value.toLowerCase();
  return libraryComponents.value.filter(c =>
    c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)
  );
});

async function openQuickJob(d: Device) {
  quickJobDevice.value = d;
  quickJobTab.value = 'library';
  quickJobForm.value = { shell: 'auto', script: '', timeout: '', saveToLibrary: false, libraryName: '' };
  quickJobError.value = '';
  selectedComponent.value = null;
  libSearch.value = '';
  // Load library (only if not already loaded)
  if (libraryComponents.value.length === 0) {
    libraryLoading.value = true;
    try { libraryComponents.value = await api.components.list(); }
    finally { libraryLoading.value = false; }
  }
}

async function submitQuickJob() {
  if (!quickJobDevice.value) return;
  quickJobBusy.value = true;
  quickJobError.value = '';
  const device = quickJobDevice.value;

  try {
    let componentRef: import('../api').ComponentRef;
    let jobName: string;

    if (quickJobTab.value === 'library') {
      if (!selectedComponent.value) { quickJobError.value = 'Select a component'; return; }
      componentRef = { type: 'library', component_id: selectedComponent.value.id, order: 1 };
      jobName = `Quick Job — ${selectedComponent.value.name}`;
    } else {
      const script = quickJobForm.value.script.trim();
      if (!script) { quickJobError.value = 'Script is required'; return; }

      // Optionally save to library first
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
      target_ids:  [device.id],
    });

    quickJobDevice.value = null;
    showJobQueued(device.id);
  } catch (e: any) {
    quickJobError.value = e.message;
  } finally {
    quickJobBusy.value = false;
  }
}

function shellLabel(shell: string): string {
  return { auto: 'Auto', powershell: 'PowerShell', bash: 'Bash', sh: 'sh', cmd: 'CMD' }[shell] ?? shell;
}

async function scheduleReboot(d: Device) {
  menuDeviceId.value = null;
  try {
    await api.devices.commands.create(d.id, { type: 'reboot' });
    showJobQueued(d.id);
  } catch (e: any) {
    error.value = e.message;
  }
}

function showJobQueued(deviceId: string) {
  jobQueued.value = deviceId;
  setTimeout(() => { if (jobQueued.value === deviceId) jobQueued.value = null; }, 4000);
}

// ── Helpers ───────────────────────────────────────────────────
function effectiveClass(d: Device) { return d.overrideClass ?? d.detectedClass; }

function osLabel(d: Device) {
  if (!d.osType) return '—';
  return d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
}

function lastSeenLabel(ts: number | null) {
  if (!ts) return 'Never';
  const diff = now.value - ts;
  if (diff < 90)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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
  if (!q) return list;
  return list.filter(s => s.name.toLowerCase().includes(q) || s.version.toLowerCase().includes(q));
});

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
    showJobQueued(deviceId);
  } catch (e: any) { error.value = e.message; }
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => { clearInterval(timer); document.removeEventListener('click', closeMenuOnce); });
</script>

<style scoped>
/* ── Tabs ── */
.tabs { display: flex; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text-muted-2); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }

/* ── Inline expansion ── */
.device-row-active td { background: rgba(78,126,247,.04); border-bottom: none; }
.expand-row td { padding: 0; }
.expand-cell { border-bottom: 1px solid var(--border); background: var(--bg); }
.border-online  { border-left: 3px solid var(--teal); }
.border-pending { border-left: 3px solid var(--amber); }
.border-offline { border-left: 3px solid var(--border-2); }

/* ── Identity header ── */
.ddev-header {
  padding: 12px 20px 10px;
  border-bottom: 1px solid var(--border);
}
.ddev-hostname { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.ddev-sub { display: flex; align-items: center; gap: 6px; }
.ddev-sep { color: var(--border-2); font-size: 12px; }
.pill-online  { font-size: 11px; font-weight: 600; color: var(--teal); }
.pill-offline { font-size: 11px; font-weight: 600; color: var(--muted); }

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
  font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 10px;
}
.ddev-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.ddev-label { font-size: 11px; color: var(--muted); min-width: 72px; flex-shrink: 0; }

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
.modal-lg  { width: 620px; }
.modal-xl  { width: 860px; }
.modal-sm  { width: 360px; }
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


.code-area {
  width: 100%;
  background: var(--bg); border: 1px solid var(--border-2); border-radius: var(--r-btn);
  padding: 10px 12px; color: var(--text); font-size: 12px; font-family: var(--mono);
  resize: vertical; outline: none; transition: border-color .12s; line-height: 1.6;
}
.code-area:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(78,126,247,.15); }

/* ── Device detail tabs ── */
.ddev-tabs {
  display: flex; gap: 0; border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.ddev-tab {
  padding: 8px 16px; font-size: 11px; font-weight: 600; border: none; background: none;
  color: var(--muted); cursor: pointer; font-family: var(--font);
  border-bottom: 2px solid transparent; transition: color .1s, border-color .1s;
}
.ddev-tab:hover { color: var(--text-muted-2); }
.ddev-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── Inventory tab ── */
.inv-tab-body { overflow-y: auto; max-height: 480px; }
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
.inv-badge-ok   { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(45,207,160,.12); color: var(--teal); }
.inv-badge-warn { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(240,168,64,.12);  color: var(--amber); }
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
.sw-list { max-height: 280px; overflow-y: auto; border-top: 1px solid var(--border); }
.sw-row { display: flex; align-items: baseline; gap: 10px; padding: 5px 20px; border-bottom: 1px solid rgba(255,255,255,.03); }
.sw-row:last-child { border-bottom: none; }
.sw-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.sw-ver  { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.sw-pub  { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inv-empty-row { padding: 10px 20px; font-size: 12px; color: var(--muted); }
.svc-list { max-height: 280px; overflow-y: auto; border-top: 1px solid var(--border); }
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
