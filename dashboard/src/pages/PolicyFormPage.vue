<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/global/policies" class="pf-crumb-link">Policies</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-link">Monitoring</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Create Policy' : 'Edit Policy' }}</span>
    </nav>

    <!-- Top bar -->
    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/global/policies')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">{{ isNew ? 'Create Policy' : (form.name || 'Edit Policy') }}</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/global/policies')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : (isNew ? 'Create Policy' : 'Save Changes') }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="error-banner" style="margin:0 0 16px">{{ loadError }}</div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">

      <!-- Name -->
      <div class="pf-group">
        <label class="pf-label">Name</label>
        <input v-model="form.name" class="pf-input" placeholder="Enter a name" />
        <span v-if="fieldErr.name" class="pf-err">{{ fieldErr.name }}</span>
      </div>

      <!-- Description -->
      <div class="pf-group">
        <label class="pf-label">Description</label>
        <textarea v-model="form.description" class="pf-input pf-textarea" rows="3" placeholder="Enter a description" />
      </div>

      <!-- Monitors -->
      <div class="pf-group">
        <label class="pf-label">Monitors</label>
        <div class="pf-monitors">
          <div class="pf-tbl-head">
            <span class="pf-th-type">Type</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>Description</span>
          </div>
          <div v-if="!monitors.length" class="pf-mon-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="color:var(--muted);flex-shrink:0">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            <p>Add Monitors to keep track of attributes, processes and events on devices that have been targeted.</p>
            <button class="btn btn-primary btn-sm" @click="openAddMonitor">Add Monitor</button>
          </div>
          <template v-else>
            <div v-for="(m, idx) in monitors" :key="m._key" class="pf-mon-row">
              <span :class="['check-chip', 'chip-' + m.checkType]">{{ checkLabel(m.checkType) }}</span>
              <span class="pf-mon-desc">{{ monitorSummaryLocal(m) }}</span>
              <div class="pf-mon-actions">
                <button class="btn-text" @click="openEditMonitor(idx)">Edit</button>
                <button class="btn-text danger" @click="doDeleteMonitor(idx)">Delete</button>
              </div>
            </div>
            <div class="pf-mon-add">
              <button class="btn btn-ghost btn-sm" @click="openAddMonitor">+ Add Monitor</button>
            </div>
          </template>
        </div>
      </div>

      <!-- OS & Class -->
      <div class="pf-group">
        <label class="pf-label">OS &amp; Class</label>
        <div class="pf-targets">
          <div class="pf-tbl-head"><span>Name</span></div>
          <div class="pf-target-body">
            <div class="pf-target-sec">
              <span class="pf-target-label">Operating System</span>
              <div class="pill-group">
                <label v-for="os in osOptions" :key="os.value" :class="['pill-opt', { active: form.targetOs.includes(os.value) }]">
                  <input type="checkbox" :value="os.value" v-model="form.targetOs" class="pill-cb" />
                  {{ os.label }}
                </label>
              </div>
            </div>
            <div class="pf-target-sec">
              <span class="pf-target-label">Device Class</span>
              <div class="pill-group">
                <label v-for="cls in classOptions" :key="cls.value" :class="['pill-opt', { active: form.targetClass.includes(cls.value) }]">
                  <input type="checkbox" :value="cls.value" v-model="form.targetClass" class="pill-cb" />
                  {{ cls.label }}
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Targets -->
      <div class="pf-group">
        <label class="pf-label">Targets</label>
        <p class="field-hint" style="margin-top:-4px">
          Add Sites, Devices, or Device Groups to restrict this policy — a device qualifies if it matches
          ANY target below (not all of them). Leave empty to target every device matching OS &amp; Class above.
        </p>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-primary btn-sm" @click="openTargetFlyout">Add Target</button>
          <button class="btn btn-ghost btn-sm" :disabled="targetItems.length === 0" @click="removeAllTargets">Remove all</button>
        </div>
        <div class="pf-monitors" style="margin-top:8px">
          <div v-if="targetItems.length === 0" class="pf-mon-empty">
            <p>No targets selected — this policy targets all devices matching OS &amp; Class above.</p>
          </div>
          <div v-else v-for="(t, i) in targetItems" :key="i" class="pf-mon-row">
            <span class="pf-mon-desc">{{ targetLabel(t) }}</span>
            <span class="jf-kind-tag">{{ t.kind === 'site' ? 'Site' : t.kind === 'device' ? 'Device' : 'Device Group' }}</span>
            <div class="pf-mon-actions">
              <button class="btn-text danger" @click="removeTargetItem(i)">Remove</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Target flyout -->
      <Teleport to="body">
        <div v-if="targetFlyoutOpen" class="tf-overlay" @click.self="targetFlyoutOpen = false">
          <div class="tf-panel">
            <div class="tf-head">
              <h2 class="tf-title">Targets</h2>
              <button class="tf-close" @click="targetFlyoutOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="tf-cat">
              <select v-model="flyoutCategory" class="pf-input" style="max-width:none">
                <option value="sites">Sites</option>
                <option value="devices">Devices</option>
                <option value="groups">Device Groups</option>
              </select>
            </div>
            <div class="tf-search">
              <input v-model="flyoutSearch" class="pf-input"
                :placeholder="flyoutCategory === 'sites' ? 'Search sites…' : flyoutCategory === 'groups' ? 'Search groups…' : 'Search devices…'"
                style="max-width:none" />
            </div>
            <div class="tf-list">
              <template v-if="flyoutCategory === 'sites'">
                <div v-for="t in flyoutSiteMatches" :key="t.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('site', t.id) }">
                  <div class="tf-row-info" style="flex:1"><span>{{ t.name }}</span></div>
                  <button v-if="!isTargeted('site', t.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'site',id:t.id,name:t.name})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'site',id:t.id,name:t.name})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutSiteMatches.length" class="tf-empty-msg">No sites found.</div>
              </template>
              <template v-else-if="flyoutCategory === 'devices'">
                <div v-for="d in flyoutDeviceMatches" :key="d.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('device', d.id) }">
                  <div class="tf-row-info" style="flex:1">
                    <span>{{ d.hostname ?? d.id.slice(0,8) }}</span>
                    <span class="tf-row-sub">{{ d.tenantName }}</span>
                  </div>
                  <button v-if="!isTargeted('device', d.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'device',id:d.id,hostname:d.hostname??d.id.slice(0,8)})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'device',id:d.id,hostname:d.hostname??d.id.slice(0,8)})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutDeviceMatches.length" class="tf-empty-msg">No matching devices.</div>
              </template>
              <template v-else>
                <div v-for="g in flyoutGroupMatches" :key="g.id" class="tf-row" :class="{ 'tf-row-selected': isTargeted('group', g.id) }">
                  <div class="tf-row-info" style="flex:1">
                    <span>{{ g.name }}</span>
                    <span class="tf-row-sub">{{ g.memberCount }} device{{ g.memberCount === 1 ? '' : 's' }}</span>
                  </div>
                  <button v-if="!isTargeted('group', g.id)" class="btn btn-ghost btn-sm tf-act-btn" @click="toggleTarget({kind:'group',id:g.id,name:g.name})">Add</button>
                  <span v-else class="tf-check" @click="toggleTarget({kind:'group',id:g.id,name:g.name})" title="Click to remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                </div>
                <div v-if="!flyoutGroupMatches.length" class="tf-empty-msg">No matching groups.</div>
              </template>
            </div>
            <div class="tf-footer">
              <button class="btn btn-primary btn-sm" @click="targetFlyoutOpen = false">Done</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Enabled -->
      <div class="pf-group">
        <label class="pf-label">Enabled</label>
        <div class="seg-bar">
          <button :class="['seg-btn', 'seg-primary', { active: form.enabled }]" @click="form.enabled = true">Enabled</button>
          <button :class="['seg-btn', { active: !form.enabled }]" @click="form.enabled = false">Disabled</button>
        </div>
      </div>

      <div v-if="saveError" class="error-banner">{{ saveError }}</div>

    </div><!-- /pf-body -->

    <!-- ── Add / Edit Monitor Overlay ── -->
    <Teleport to="body">
    <div v-if="monPanel.open" class="mo-overlay">
      <div class="mo-inner">

        <div class="mo-head">
          <h2 class="mo-head-title">{{ monPanel.editIndex != null ? 'Edit Monitor' : 'Add Monitor' }}</h2>
          <button class="btn-icon" @click="monPanel.open = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="mo-body">

          <!-- ● Monitor Type -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot active"></span>
              <strong>Monitor Type</strong>
            </div>
            <div class="mo-type-grid">
              <button v-for="ct in checkTypeOptions" :key="ct.value"
                :class="['mo-type-card', { selected: monPanel.form.checkType === ct.value }]"
                @click="selectCheckType(ct.value as CheckType)">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" v-html="ct.iconPaths"></svg>
                <span>{{ ct.label }}</span>
              </button>
            </div>
          </div>

          <div class="mo-div"></div>

          <!-- ● Alert -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot" :class="{ active: !!monPanel.form.checkType }"></span>
              <strong>Alert</strong>
            </div>
            <p class="mo-sec-sub">Configure the Monitor alert criteria</p>

            <div v-if="monPanel.form.checkType === 'offline'" class="mf-field">
              <label class="mf-label">Alert when device</label>
              <div class="seg-bar">
                <button :class="['seg-btn', { active: monPanel.form.offlineDirection === 'offline' }]" @click="monPanel.form.offlineDirection = 'offline'">Goes Offline</button>
                <button :class="['seg-btn', { active: monPanel.form.offlineDirection === 'online' }]" @click="monPanel.form.offlineDirection = 'online'">Comes Online</button>
              </div>
              <template v-if="monPanel.form.offlineDirection === 'offline'">
                <label class="mf-label" style="margin-top:12px">Alert after offline for</label>
                <div class="mf-row">
                  <input v-model.number="monPanel.form.offlineMinutes" type="number" min="1" max="43200" class="mf-input" style="max-width:90px"/>
                  <span class="mf-unit">minutes</span>
                </div>
              </template>
              <p v-else class="field-hint">Duration is set by "For a period of" below.</p>
            </div>

            <div v-if="monPanel.form.checkType === 'disk_space'" class="mf-field">
              <label class="mf-label">Drive</label>
              <div class="seg-bar">
                <button :class="['seg-btn', { active: monPanel.form.diskDrive === 'any' }]" @click="monPanel.form.diskDrive = 'any'">Any Drive</button>
                <button :class="['seg-btn', { active: monPanel.form.diskDrive !== 'any' }]" @click="monPanel.form.diskDrive = (monPanel.form.diskDrive === 'any' ? '' : monPanel.form.diskDrive)">Specific Drive</button>
              </div>
              <input v-if="monPanel.form.diskDrive !== 'any'" v-model="monPanel.form.diskDrive" type="text"
                placeholder="e.g. C:\ or /data" class="mf-input" style="margin-top:8px"/>

              <label class="mf-label" style="margin-top:12px">Alert when</label>
              <div class="mf-row">
                <select v-model="monPanel.form.diskThresholdType" class="mf-input mf-select" style="max-width:150px">
                  <option value="gb_free">Free space below</option>
                  <option value="gb_used">Used space above</option>
                  <option value="percent_used">% used above</option>
                </select>
                <input v-model.number="monPanel.form.diskThresholdValue" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">{{ monPanel.form.diskThresholdType === 'percent_used' ? '%' : 'GB' }}</span>
              </div>

              <label v-if="monPanel.form.diskDrive === 'any'" class="mf-check-row" style="margin-top:10px">
                <input type="checkbox" :checked="monPanel.form.diskMinGb !== null"
                  @change="monPanel.form.diskMinGb = ($event.target as HTMLInputElement).checked ? 50 : null" style="accent-color:var(--accent)" />
                <span>Only apply to disks larger than</span>
              </label>
              <div v-if="monPanel.form.diskMinGb !== null" class="mf-row" style="margin-top:6px">
                <input v-model.number="monPanel.form.diskMinGb" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">GB</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'cpu_usage'" class="mf-field">
              <label class="mf-label">CPU usage has reached</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.cpuPercent" type="number" min="1" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>
              <p v-if="monPanel.form.cpuPercent >= 95" class="mf-warn">
                Monitoring at ≥95% alone may not alert reliably — a device at 100% CPU can fail to report. Consider a lower threshold (e.g. 85%) with a longer period as an early warning.
              </p>
            </div>

            <div v-if="monPanel.form.checkType === 'memory_usage'" class="mf-field">
              <label class="mf-label">Memory usage has reached</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.memPercent" type="number" min="1" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'av_status'" class="mf-field">
              <label class="mf-label">Alert when AV state is</label>
              <select v-model="monPanel.form.avState" class="mf-input mf-select">
                <option value="not_detected">Not Detected — no AV product found</option>
                <option value="not_running">Not Running — AV installed but disabled</option>
                <option value="running_not_up_to_date">Out of Date — definitions stale</option>
              </select>
            </div>

            <div v-if="monPanel.form.checkType === 'file_size'" class="mf-field">
              <label class="mf-label">Full path to file/folder</label>
              <input v-model="monPanel.form.fileSizePath" type="text" placeholder="e.g. C:\Logs or /var/log/app.log" class="mf-input"/>

              <label class="mf-label" style="margin-top:12px">Size is</label>
              <div class="mf-row">
                <div class="seg-bar">
                  <button :class="['seg-btn', { active: monPanel.form.fileSizeMode === 'below' }]" @click="monPanel.form.fileSizeMode = 'below'">Below</button>
                  <button :class="['seg-btn', { active: monPanel.form.fileSizeMode === 'over' }]" @click="monPanel.form.fileSizeMode = 'over'">Over</button>
                </div>
                <input v-model.number="monPanel.form.fileSizeThresholdMb" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">MB</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'ping'" class="mf-field">
              <label class="mf-label">IP address / hostname</label>
              <input v-model="monPanel.form.pingTarget" type="text" placeholder="e.g. 8.8.8.8 or gateway.local" class="mf-input"/>

              <label class="mf-label" style="margin-top:12px">Send ping packets</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.pingCount" type="number" min="1" max="40" class="mf-input" style="max-width:90px"/>
              </div>

              <label class="mf-check-row" style="margin-top:10px">
                <input type="checkbox" v-model="monPanel.form.pingCheckUnreachable" style="accent-color:var(--accent)" />
                <span>Alert when host is unreachable</span>
              </label>

              <label class="mf-check-row" style="margin-top:8px">
                <input type="checkbox" :checked="monPanel.form.pingPacketLossPct !== null"
                  @change="monPanel.form.pingPacketLossPct = ($event.target as HTMLInputElement).checked ? 20 : null" style="accent-color:var(--accent)" />
                <span>Alert when % packets are lost</span>
              </label>
              <div v-if="monPanel.form.pingPacketLossPct !== null" class="mf-row" style="margin-top:6px">
                <input v-model.number="monPanel.form.pingPacketLossPct" type="number" min="5" max="95" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>

              <label class="mf-check-row" style="margin-top:8px">
                <input type="checkbox" :checked="monPanel.form.pingLatencyMs !== null"
                  @change="monPanel.form.pingLatencyMs = ($event.target as HTMLInputElement).checked ? 200 : null" style="accent-color:var(--accent)" />
                <span>Alert when average roundtrip exceeds</span>
              </label>
              <div v-if="monPanel.form.pingLatencyMs !== null" class="mf-row" style="margin-top:6px">
                <input v-model.number="monPanel.form.pingLatencyMs" type="number" min="1" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">ms</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'process'" class="mf-field">
              <label class="mf-label">The process</label>
              <input v-model="monPanel.form.processName" type="text" placeholder="e.g. bittorrent (without .exe)" class="mf-input"/>

              <label class="mf-label" style="margin-top:12px">Alert when</label>
              <select v-model="monPanel.form.processMode" class="mf-input mf-select">
                <option value="running">Process is running</option>
                <option value="stopped">Process is stopped</option>
                <option value="cpu">CPU usage has reached</option>
                <option value="memory">Memory usage has reached</option>
              </select>
              <div v-if="monPanel.form.processMode === 'cpu' || monPanel.form.processMode === 'memory'" class="mf-row" style="margin-top:8px">
                <input v-model.number="monPanel.form.processThresholdPct" type="number" min="0" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'service'" class="mf-field">
              <label class="mf-label">The service</label>
              <input v-model="monPanel.form.serviceName" type="text" placeholder="e.g. wuauserv" class="mf-input"/>
              <p class="field-hint">Windows only.</p>

              <label class="mf-label" style="margin-top:12px">Alert when</label>
              <select v-model="monPanel.form.serviceMode" class="mf-input mf-select">
                <option value="running">Service is running</option>
                <option value="stopped">Service is stopped</option>
                <option value="cpu">CPU usage has reached</option>
                <option value="memory">Memory usage has reached</option>
              </select>
              <div v-if="monPanel.form.serviceMode === 'cpu' || monPanel.form.serviceMode === 'memory'" class="mf-row" style="margin-top:8px">
                <input v-model.number="monPanel.form.serviceThresholdPct" type="number" min="0" max="100" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">%</span>
              </div>

              <label class="mf-label" style="margin-top:12px">After the machine has booted</label>
              <div class="mf-row">
                <input v-model.number="monPanel.form.serviceBootDelayMinutes" type="number" min="0" max="60" class="mf-input" style="max-width:90px"/>
                <span class="mf-unit">min (0 = immediately)</span>
              </div>
            </div>

            <div v-if="monPanel.form.checkType === 'software'" class="mf-field">
              <label class="mf-label">After a software package matching</label>
              <input v-model="monPanel.form.softwareNamePattern" type="text" placeholder="e.g. %torrent% or exact name" class="mf-input"/>
              <p class="field-hint">Use % as a wildcard. This monitor fires once per change and does not auto-resolve — alerts must be resolved manually.</p>

              <label class="mf-label" style="margin-top:12px">Alert when the package</label>
              <select v-model="monPanel.form.softwareMode" class="mf-input mf-select">
                <option value="installed">Is installed</option>
                <option value="uninstalled">Is uninstalled</option>
                <option value="version_changed">Changes version</option>
              </select>
            </div>

            <div class="mf-pair">
              <template v-if="monPanel.form.checkType !== 'software'">
                <div class="mf-field">
                  <label class="mf-label">For a period of</label>
                  <div class="mf-row">
                    <input v-model.number="monPanel.form.sustainedMinutes" type="number" min="1" max="60" class="mf-input" style="max-width:90px"/>
                    <span class="mf-unit">min</span>
                  </div>
                </div>
                <div class="mf-field">
                  <label class="mf-label">Check interval</label>
                  <div class="mf-row">
                    <input v-model.number="monPanel.form.checkIntervalMinutes" type="number" min="1" :max="monPanel.form.checkType === 'ping' ? 120 : 60" class="mf-input" style="max-width:90px"/>
                    <span class="mf-unit">min</span>
                  </div>
                </div>
              </template>
              <div class="mf-field">
                <label class="mf-label">Alert priority</label>
                <select v-model="monPanel.form.alertPriority" class="mf-input mf-select">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="moderate">Moderate</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            <template v-if="monPanel.form.checkType !== 'software'">
              <label class="mf-check-row">
                <input type="checkbox" v-model="monPanel.form.autoResolve" style="accent-color:var(--accent)" />
                <span>Auto-resolve alert when condition is no longer met</span>
              </label>
              <div v-if="monPanel.form.autoResolve" class="mf-field" style="margin-top:10px">
                <label class="mf-label">Keep alert visible for at least</label>
                <div class="mf-row">
                  <input v-model.number="monPanel.form.autoResolveAfterMinutes" type="number" min="1" class="mf-input" style="max-width:90px"/>
                  <span class="mf-unit">min before resolving</span>
                </div>
              </div>
            </template>
          </div>

          <div class="mo-div"></div>

          <!-- ● Response -->
          <div class="mo-sec">
            <div class="mo-sec-hd">
              <span class="mo-dot"></span>
              <strong>Response</strong>
              <span class="mo-optional">(Optional)</span>
            </div>
            <p class="mo-sec-sub">Configure the system response when the Monitor alert is triggered</p>
            <div class="mf-toggle-row">
              <div class="mf-toggle-text">
                <span class="mf-toggle-title">Send a Webhook</span>
                <span class="mf-toggle-sub">When alert is triggered</span>
              </div>
              <button :class="['mf-tgl', { on: monPanel.form.sendWebhook }]"
                @click="monPanel.form.sendWebhook = !monPanel.form.sendWebhook">
                <span class="mf-tgl-thumb"></span>
              </button>
            </div>
          </div>

          <div v-if="monPanel.error" class="mo-error">{{ monPanel.error }}</div>

        </div><!-- /mo-body -->

        <div class="mo-foot">
          <button class="btn btn-ghost btn-sm" @click="monPanel.open = false">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="monPanel.saving" @click="saveMonitor">
            {{ monPanel.saving ? 'Saving…' : (monPanel.editIndex != null ? 'Save Changes' : 'Add Monitor') }}
          </button>
        </div>

      </div><!-- /mo-inner -->
    </div>
    </Teleport>

  </div><!-- /pf-page -->
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type CheckType, type AlertPriority, type Tenant, type Device, type DeviceGroup } from '../api';

const router = useRouter();
const route  = useRoute();

const policyId = computed(() => route.params.id as string | undefined);
const isNew    = computed(() => !policyId.value);

const loading   = ref(false);
const saving    = ref(false);
const loadError = ref('');
const saveError = ref('');
const tenants   = ref<Tenant[]>([]);
const devices   = ref<Device[]>([]);
const fieldErr  = reactive({ name: '' });

// ── Targets: Sites / Devices / Device Groups (independent lifecycle --
// existing policies hit the API immediately, same as Sites in
// ComponentFormPage.vue; new policies accumulate locally and batch-POST
// after creation). A heterogeneous OR-list, NOT single-kind-exclusive like
// JobFormPage.vue's flyout -- adding a Site does not clear previously added
// Devices/Groups. See deviceMatchesPolicy in worker/src/lib/alerts.ts. ──
type PolicyTargetItem =
  | { kind: 'site';   id: string; name: string }
  | { kind: 'device'; id: string; hostname: string }
  | { kind: 'group';  id: string; name: string };

const targetItems      = ref<PolicyTargetItem[]>([]);
const targetFlyoutOpen = ref(false);
const flyoutCategory   = ref<'sites' | 'devices' | 'groups'>('sites');
const flyoutSearch     = ref('');
const groups           = ref<DeviceGroup[]>([]);

const flyoutSiteMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return tenants.value.filter(t => !q || t.name.toLowerCase().includes(q));
});

const flyoutDeviceMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return devices.value.filter(d =>
    !q ||
    (d.hostname ?? '').toLowerCase().includes(q) ||
    (d.tenantName ?? '').toLowerCase().includes(q)
  );
});

const flyoutGroupMatches = computed(() => {
  const q = flyoutSearch.value.toLowerCase();
  return groups.value.filter(g => !q || g.name.toLowerCase().includes(q));
});

function isTargeted(kind: string, id: string): boolean {
  return targetItems.value.some(t => t.kind === kind && t.id === id);
}

async function toggleTarget(item: PolicyTargetItem) {
  if (isTargeted(item.kind, item.id)) {
    if (!isNew.value && policyId.value) {
      try {
        if (item.kind === 'site')   await api.policies.sites.remove(policyId.value, item.id);
        if (item.kind === 'device') await api.policies.devices.remove(policyId.value, item.id);
        if (item.kind === 'group')  await api.policies.groups.remove(policyId.value, item.id);
      } catch (e: any) { saveError.value = e.message; return; }
    }
    targetItems.value = targetItems.value.filter(t => !(t.kind === item.kind && t.id === item.id));
    return;
  }

  if (!isNew.value && policyId.value) {
    try {
      if (item.kind === 'site')   await api.policies.sites.add(policyId.value, item.id);
      if (item.kind === 'device') await api.policies.devices.add(policyId.value, item.id);
      if (item.kind === 'group')  await api.policies.groups.add(policyId.value, item.id);
    } catch (e: any) { saveError.value = e.message; return; }
  }
  targetItems.value.push(item);
}

function openTargetFlyout() {
  flyoutSearch.value = '';
  targetFlyoutOpen.value = true;
}

async function removeTargetItem(i: number) {
  const item = targetItems.value[i];
  await toggleTarget(item); // toggleTarget removes since it's already targeted
}

async function removeAllTargets() {
  if (!isNew.value && policyId.value) {
    for (const t of targetItems.value) {
      try {
        if (t.kind === 'site')   await api.policies.sites.remove(policyId.value, t.id);
        if (t.kind === 'device') await api.policies.devices.remove(policyId.value, t.id);
        if (t.kind === 'group')  await api.policies.groups.remove(policyId.value, t.id);
      } catch { /* best-effort, continue clearing locally */ }
    }
  }
  targetItems.value = [];
}

function targetLabel(t: PolicyTargetItem): string {
  if (t.kind === 'site')   return t.name;
  if (t.kind === 'device') return t.hostname;
  return t.name;
}

const form = reactive({
  name:        '',
  description: '',
  enabled:     true,
  targetOs:    ['windows', 'linux', 'macos'] as string[],
  targetClass: ['server', 'workstation', 'laptop'] as string[],
});

const osOptions    = [{ value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }, { value: 'macos', label: 'macOS' }];
const classOptions = [{ value: 'server', label: 'Server' }, { value: 'workstation', label: 'Workstation' }, { value: 'laptop', label: 'Laptop' }];

const checkTypeOptions = [
  { value: 'offline',
    label: 'Online Status',
    iconPaths: '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>' },
  { value: 'disk_space',
    label: 'Disk Space',
    iconPaths: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
  { value: 'cpu_usage',
    label: 'CPU Usage',
    iconPaths: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>' },
  { value: 'memory_usage',
    label: 'Memory',
    iconPaths: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 11v2M12 11v2M17 11v2M2 11h1M21 11h1"/>' },
  { value: 'av_status',
    label: 'Antivirus',
    iconPaths: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>' },
  { value: 'file_size',
    label: 'File/Folder Size',
    iconPaths: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
  { value: 'ping',
    label: 'Ping',
    iconPaths: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
  { value: 'process',
    label: 'Process',
    iconPaths: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
  { value: 'service',
    label: 'Service',
    iconPaths: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  { value: 'software',
    label: 'Software',
    iconPaths: '<path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.79 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z"/><polyline points="2.32 6.16 12 11 21.68 6.16"/><line x1="12" y1="22.76" x2="12" y2="11"/>' },
];

// ── Local monitor type ──

interface LocalMonitor {
  _key:                    string;
  id?:                     string;
  checkType:               CheckType;
  alertPriority:           AlertPriority;
  sustainedMinutes:        number;
  checkIntervalMinutes:    number;
  autoResolve:             boolean;
  autoResolveAfterMinutes: number;
  offlineMinutes:          number;
  offlineDirection:        'offline' | 'online';
  diskDrive:               string;
  diskThresholdType:       'gb_free' | 'gb_used' | 'percent_used';
  diskThresholdValue:      number;
  diskMinGb:               number | null;
  cpuPercent:              number;
  memPercent:              number;
  avState:                 string;
  fileSizePath:            string;
  fileSizeMode:            'below' | 'over';
  fileSizeThresholdMb:     number;
  pingTarget:              string;
  pingCount:               number;
  pingCheckUnreachable:    boolean;
  pingPacketLossPct:       number | null;
  pingLatencyMs:           number | null;
  processName:             string;
  processMode:             'running' | 'stopped' | 'cpu' | 'memory';
  processThresholdPct:     number | null;
  serviceName:             string;
  serviceMode:             'running' | 'stopped' | 'cpu' | 'memory';
  serviceThresholdPct:     number | null;
  serviceBootDelayMinutes: number;
  softwareNamePattern:     string;
  softwareMode:            'installed' | 'uninstalled' | 'version_changed';
  sendWebhook:             boolean;
}

let keySeq = 0;
const monitors = ref<LocalMonitor[]>([]);

// ── Monitor panel ──

const monPanel = reactive({
  open:      false,
  editIndex: null as number | null,
  saving:    false,
  error:     '',
  form: {
    checkType:               'offline' as CheckType,
    alertPriority:           'high'    as AlertPriority,
    sustainedMinutes:        5,
    checkIntervalMinutes:    1,
    autoResolve:             true,
    autoResolveAfterMinutes: 60,
    offlineMinutes:          30,
    offlineDirection:        'offline' as 'offline' | 'online',
    diskDrive:               'any',
    diskThresholdType:       'gb_free' as 'gb_free' | 'gb_used' | 'percent_used',
    diskThresholdValue:      10,
    diskMinGb:               null as number | null,
    cpuPercent:              90,
    memPercent:              90,
    avState:                 'not_detected',
    fileSizePath:            '',
    fileSizeMode:            'over' as 'below' | 'over',
    fileSizeThresholdMb:     500,
    pingTarget:              '',
    pingCount:               4,
    pingCheckUnreachable:    true,
    pingPacketLossPct:       null as number | null,
    pingLatencyMs:           null as number | null,
    processName:             '',
    processMode:             'stopped' as 'running' | 'stopped' | 'cpu' | 'memory',
    processThresholdPct:     80 as number | null,
    serviceName:             '',
    serviceMode:             'stopped' as 'running' | 'stopped' | 'cpu' | 'memory',
    serviceThresholdPct:     80 as number | null,
    serviceBootDelayMinutes: 0,
    softwareNamePattern:     '',
    softwareMode:            'installed' as 'installed' | 'uninstalled' | 'version_changed',
    sendWebhook:             false,
  },
});

function selectCheckType(ct: CheckType) {
  monPanel.form.checkType = ct;
  // Software monitors are event-driven (install/uninstall/version-change),
  // not state-driven — no sustained window applies (fire on first detection,
  // see the alerts.ts fire-immediately fix) and Datto's own spec has this
  // type never auto-resolve (alerts must be dismissed manually).
  if (ct === 'software') {
    monPanel.form.sustainedMinutes = 0;
    monPanel.form.autoResolve = false;
  }
}

function openAddMonitor() {
  monPanel.editIndex = null;
  monPanel.error     = '';
  Object.assign(monPanel.form, {
    checkType: 'offline', alertPriority: 'high',
    sustainedMinutes: 5, checkIntervalMinutes: 1, autoResolve: true, autoResolveAfterMinutes: 60,
    offlineMinutes: 30, offlineDirection: 'offline',
    diskDrive: 'any', diskThresholdType: 'gb_free', diskThresholdValue: 10, diskMinGb: null,
    cpuPercent: 90, memPercent: 90,
    avState: 'not_detected',
    fileSizePath: '', fileSizeMode: 'over', fileSizeThresholdMb: 500,
    pingTarget: '', pingCount: 4, pingCheckUnreachable: true, pingPacketLossPct: null, pingLatencyMs: null,
    processName: '', processMode: 'stopped', processThresholdPct: 80,
    serviceName: '', serviceMode: 'stopped', serviceThresholdPct: 80, serviceBootDelayMinutes: 0,
    softwareNamePattern: '', softwareMode: 'installed',
    sendWebhook: false,
  });
  monPanel.open = true;
}

function openEditMonitor(index: number) {
  const m = monitors.value[index];
  monPanel.editIndex = index;
  monPanel.error     = '';
  Object.assign(monPanel.form, {
    checkType:               m.checkType,
    alertPriority:           m.alertPriority,
    sustainedMinutes:        m.sustainedMinutes,
    checkIntervalMinutes:    m.checkIntervalMinutes,
    autoResolve:             m.autoResolve,
    autoResolveAfterMinutes: m.autoResolveAfterMinutes,
    offlineMinutes:          m.offlineMinutes,
    offlineDirection:        m.offlineDirection,
    diskDrive:               m.diskDrive,
    diskThresholdType:       m.diskThresholdType,
    diskThresholdValue:      m.diskThresholdValue,
    diskMinGb:               m.diskMinGb,
    cpuPercent:              m.cpuPercent,
    memPercent:              m.memPercent,
    avState:                 m.avState,
    fileSizePath:            m.fileSizePath,
    fileSizeMode:            m.fileSizeMode,
    fileSizeThresholdMb:     m.fileSizeThresholdMb,
    pingTarget:              m.pingTarget,
    pingCount:               m.pingCount,
    pingCheckUnreachable:    m.pingCheckUnreachable,
    pingPacketLossPct:       m.pingPacketLossPct,
    pingLatencyMs:           m.pingLatencyMs,
    processName:             m.processName,
    processMode:             m.processMode,
    processThresholdPct:     m.processThresholdPct,
    serviceName:             m.serviceName,
    serviceMode:             m.serviceMode,
    serviceThresholdPct:     m.serviceThresholdPct,
    serviceBootDelayMinutes: m.serviceBootDelayMinutes,
    softwareNamePattern:     m.softwareNamePattern,
    softwareMode:            m.softwareMode,
    sendWebhook:             m.sendWebhook,
  });
  monPanel.open = true;
}

function buildConfig(f: typeof monPanel.form): Record<string, unknown> {
  switch (f.checkType) {
    case 'offline':      return { direction: f.offlineDirection, offline_after_seconds: f.offlineMinutes * 60 };
    case 'disk_space':   return {
      drive:           f.diskDrive,
      threshold_type:  f.diskThresholdType,
      threshold_value: f.diskThresholdValue,
      min_disk_gb:     f.diskMinGb,
    };
    case 'cpu_usage':    return { percent_max: f.cpuPercent };
    case 'memory_usage': return { percent_max: f.memPercent };
    case 'av_status':    return { av_state: f.avState };
    case 'file_size':    return {
      path:         f.fileSizePath,
      mode:         f.fileSizeMode,
      threshold_mb: f.fileSizeThresholdMb,
    };
    case 'ping':         return {
      target:            f.pingTarget,
      packet_count:      f.pingCount,
      check_unreachable: f.pingCheckUnreachable,
      packet_loss_pct:   f.pingPacketLossPct,
      latency_ms:        f.pingLatencyMs,
    };
    case 'process':      return {
      process_name:  f.processName,
      mode:          f.processMode,
      threshold_pct: f.processThresholdPct,
    };
    case 'service':      return {
      service_name:       f.serviceName,
      mode:               f.serviceMode,
      threshold_pct:      f.serviceThresholdPct,
      boot_delay_minutes: f.serviceBootDelayMinutes,
    };
    case 'software':     return {
      name_pattern: f.softwareNamePattern,
      mode:         f.softwareMode,
    };
    default:             return {};
  }
}

async function saveMonitor() {
  const f      = monPanel.form;
  const config = buildConfig(f);

  if (!isNew.value && policyId.value) {
    monPanel.saving = true;
    monPanel.error  = '';
    try {
      if (monPanel.editIndex != null) {
        const m = monitors.value[monPanel.editIndex];
        if (m.id) {
          await api.policies.monitors.update(policyId.value, m.id, {
            config,
            alert_priority:             f.alertPriority,
            sustained_minutes:          f.sustainedMinutes,
            check_interval_minutes:    f.checkIntervalMinutes,
            auto_resolve:               f.autoResolve,
            auto_resolve_after_minutes: f.autoResolveAfterMinutes,
          });
        }
        monitors.value[monPanel.editIndex] = { ...m, ...f };
      } else {
        const res = await api.policies.monitors.create(policyId.value, {
          check_type:                 f.checkType,
          config,
          alert_priority:             f.alertPriority,
          sustained_minutes:          f.sustainedMinutes,
          check_interval_minutes:    f.checkIntervalMinutes,
          auto_resolve:               f.autoResolve,
          auto_resolve_after_minutes: f.autoResolveAfterMinutes,
        });
        monitors.value.push({ _key: String(keySeq++), id: res.monitor_id, ...f });
      }
      monPanel.open = false;
    } catch (e) {
      monPanel.error = e instanceof Error ? e.message : 'Failed to save.';
    } finally {
      monPanel.saving = false;
    }
    return;
  }

  // New policy: accumulate locally
  if (monPanel.editIndex != null) {
    monitors.value[monPanel.editIndex] = { ...monitors.value[monPanel.editIndex], ...f };
  } else {
    monitors.value.push({ _key: String(keySeq++), ...f });
  }
  monPanel.open = false;
}

async function doDeleteMonitor(index: number) {
  const m = monitors.value[index];
  if (!isNew.value && policyId.value && m.id) {
    try { await api.policies.monitors.delete(policyId.value, m.id); }
    catch { return; }
  }
  monitors.value.splice(index, 1);
}

// ── Load ──

onMounted(async () => {
  try { tenants.value = await api.tenants.list(); } catch { /* ok */ }
  try { devices.value = await api.devices.list(); } catch { /* ok */ }
  try { groups.value  = await api.groups.list(); } catch { /* ok */ }

  // Arriving from a company's Policies page ("Acme" → Create Policy) --
  // pre-seed a single Site target for that company, once tenants have
  // loaded (name resolution needs the fetched list above).
  if (isNew.value) {
    const companyId = route.query.company_id as string | undefined;
    if (companyId) {
      const t = tenants.value.find(t => t.id === companyId);
      if (t) targetItems.value.push({ kind: 'site', id: t.id, name: t.name });
    }
  }

  if (!isNew.value && policyId.value) {
    loading.value = true;
    try {
      const all    = await api.policies.list();
      const policy = all.find(p => p.id === policyId.value);
      if (!policy) { loadError.value = 'Policy not found.'; return; }

      try {
        const [sites, devs, grps] = await Promise.all([
          api.policies.sites.list(policyId.value),
          api.policies.devices.list(policyId.value),
          api.policies.groups.list(policyId.value),
        ]);
        targetItems.value = [
          ...sites.map(s => ({ kind: 'site' as const, id: s.tenantId, name: s.name })),
          ...devs.map(d => ({ kind: 'device' as const, id: d.deviceId, hostname: d.hostname ?? d.deviceId.slice(0, 8) })),
          ...grps.map(g => ({ kind: 'group' as const, id: g.groupId, name: g.name })),
        ];
      } catch { /* ok */ }

      form.name        = policy.name;
      form.description = policy.description ?? '';
      form.enabled     = policy.enabled;
      form.targetOs    = JSON.parse(policy.targetOs)    as string[];
      form.targetClass = JSON.parse(policy.targetClass) as string[];

      monitors.value = policy.monitors.map(m => {
        const cfg = JSON.parse(m.config) as Record<string, unknown>;
        return {
          _key:                    String(keySeq++),
          id:                      m.id,
          checkType:               m.checkType,
          alertPriority:           m.alertPriority,
          sustainedMinutes:        m.sustainedMinutes,
          checkIntervalMinutes:    m.checkIntervalMinutes,
          autoResolve:             m.autoResolve,
          autoResolveAfterMinutes: m.autoResolveAfterMinutes,
          offlineMinutes:          Math.round(((cfg.offline_after_seconds as number) ?? 1800) / 60),
          offlineDirection:        (cfg.direction as 'offline' | 'online') ?? 'offline',
          diskDrive:               (cfg.drive           as string) ?? 'any',
          diskThresholdType:       (cfg.threshold_type  as 'gb_free' | 'gb_used' | 'percent_used') ?? 'gb_free',
          diskThresholdValue:      (cfg.threshold_value as number) ?? 10,
          diskMinGb:               (cfg.min_disk_gb     as number | null) ?? null,
          cpuPercent:              (cfg.percent_max as number) ?? 90,
          memPercent:              (cfg.percent_max as number) ?? 90,
          avState:                 (cfg.av_state   as string) ?? 'not_detected',
          fileSizePath:            (cfg.path         as string) ?? '',
          fileSizeMode:            (cfg.mode         as 'below' | 'over') ?? 'over',
          fileSizeThresholdMb:     (cfg.threshold_mb as number) ?? 500,
          pingTarget:              (cfg.target            as string) ?? '',
          pingCount:               (cfg.packet_count      as number) ?? 4,
          pingCheckUnreachable:    (cfg.check_unreachable as boolean) ?? true,
          pingPacketLossPct:       (cfg.packet_loss_pct   as number | null) ?? null,
          pingLatencyMs:           (cfg.latency_ms        as number | null) ?? null,
          processName:             (cfg.process_name  as string) ?? '',
          processMode:             (cfg.mode          as 'running' | 'stopped' | 'cpu' | 'memory') ?? 'stopped',
          processThresholdPct:     (cfg.threshold_pct as number | null) ?? 80,
          serviceName:             (cfg.service_name       as string) ?? '',
          serviceMode:             (cfg.mode               as 'running' | 'stopped' | 'cpu' | 'memory') ?? 'stopped',
          serviceThresholdPct:     (cfg.threshold_pct      as number | null) ?? 80,
          serviceBootDelayMinutes: (cfg.boot_delay_minutes as number) ?? 0,
          softwareNamePattern:     (cfg.name_pattern as string) ?? '',
          softwareMode:            (cfg.mode         as 'installed' | 'uninstalled' | 'version_changed') ?? 'installed',
          sendWebhook:             false,
        };
      });
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Failed to load policy.';
    } finally {
      loading.value = false;
    }
  }
});

// ── Save policy ──

async function save() {
  fieldErr.name   = '';
  saveError.value = '';

  if (!form.name.trim()) { fieldErr.name = 'Name is required.'; return; }

  saving.value = true;
  try {
    if (isNew.value) {
      const policy = await api.policies.create({
        name:         form.name,
        description:  form.description || null,
        target_os:    form.targetOs,
        target_class: form.targetClass,
      });
      for (const m of monitors.value) {
        await api.policies.monitors.create(policy.id, {
          check_type:                 m.checkType,
          config:                     buildConfig({ ...monPanel.form, ...m }),
          alert_priority:             m.alertPriority,
          sustained_minutes:          m.sustainedMinutes,
          check_interval_minutes:    m.checkIntervalMinutes,
          auto_resolve:               m.autoResolve,
          auto_resolve_after_minutes: m.autoResolveAfterMinutes,
        });
      }
      for (const t of targetItems.value) {
        if (t.kind === 'site')   await api.policies.sites.add(policy.id, t.id);
        if (t.kind === 'device') await api.policies.devices.add(policy.id, t.id);
        if (t.kind === 'group')  await api.policies.groups.add(policy.id, t.id);
      }
    } else if (policyId.value) {
      await api.policies.update(policyId.value, {
        name:         form.name,
        description:  form.description || null,
        enabled:      form.enabled,
        target_os:    form.targetOs,
        target_class: form.targetClass,
      });
    }
    router.push('/global/policies');
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    saving.value = false;
  }
}

// ── Formatters ──

function checkLabel(ct: CheckType): string {
  const m: Record<CheckType, string> = { disk_space: 'Disk Space', offline: 'Online Status', cpu_usage: 'CPU', memory_usage: 'Memory', av_status: 'Antivirus', file_size: 'File/Folder Size', ping: 'Ping', process: 'Process', service: 'Service', software: 'Software' };
  return m[ct] ?? ct;
}

function diskSummary(m: LocalMonitor): string {
  const drive = m.diskDrive === 'any' ? 'any drive' : m.diskDrive;
  const unit  = m.diskThresholdType === 'percent_used' ? '%' : ' GB';
  const cmp   = m.diskThresholdType === 'gb_free' ? '<' : m.diskThresholdType === 'percent_used' ? '≥' : '>';
  const label = m.diskThresholdType === 'gb_free' ? 'free' : 'used';
  return `alert when ${drive} ${cmp} ${m.diskThresholdValue}${unit} ${label}`;
}

function pingSummary(m: LocalMonitor): string {
  const parts: string[] = [];
  if (m.pingCheckUnreachable) parts.push('unreachable');
  if (m.pingPacketLossPct !== null) parts.push(`>${m.pingPacketLossPct}% loss`);
  if (m.pingLatencyMs !== null) parts.push(`>${m.pingLatencyMs}ms`);
  const target = m.pingTarget || '(target)';
  return parts.length ? `${target}: ${parts.join(', ')}` : `${target}: no conditions set`;
}

function processSummary(m: LocalMonitor): string {
  const name = m.processName || '(process)';
  switch (m.processMode) {
    case 'running': return `alert when ${name} is running`;
    case 'stopped': return `alert when ${name} is stopped`;
    case 'cpu':     return `alert when ${name} CPU ≥ ${m.processThresholdPct ?? '?'}%`;
    case 'memory':  return `alert when ${name} memory ≥ ${m.processThresholdPct ?? '?'}%`;
  }
}

function serviceSummary(m: LocalMonitor): string {
  const name = m.serviceName || '(service)';
  const delay = m.serviceBootDelayMinutes > 0 ? ` (${m.serviceBootDelayMinutes}m after boot)` : '';
  switch (m.serviceMode) {
    case 'running': return `alert when ${name} is running${delay}`;
    case 'stopped': return `alert when ${name} is stopped${delay}`;
    case 'cpu':     return `alert when ${name} CPU ≥ ${m.serviceThresholdPct ?? '?'}%${delay}`;
    case 'memory':  return `alert when ${name} memory ≥ ${m.serviceThresholdPct ?? '?'}%${delay}`;
  }
}

function softwareSummary(m: LocalMonitor): string {
  const name = m.softwareNamePattern || '(pattern)';
  switch (m.softwareMode) {
    case 'installed':        return `alert when ${name} is installed`;
    case 'uninstalled':      return `alert when ${name} is uninstalled`;
    case 'version_changed':  return `alert when ${name} changes version`;
  }
}

function monitorSummaryLocal(m: LocalMonitor): string {
  switch (m.checkType) {
    case 'offline':      return m.offlineDirection === 'online'
      ? `alert once online for ${m.sustainedMinutes}m`
      : `alert after ${m.offlineMinutes}m offline`;
    case 'disk_space':   return diskSummary(m);
    case 'cpu_usage':    return `alert at ≥ ${m.cpuPercent}% CPU`;
    case 'memory_usage': return `alert at ≥ ${m.memPercent}% memory`;
    case 'av_status': {
      const labels: Record<string, string> = { not_detected: 'AV not detected', not_running: 'AV not running', running_not_up_to_date: 'AV out of date' };
      return labels[m.avState] ?? `AV: ${m.avState}`;
    }
    case 'file_size': return `alert when ${m.fileSizePath || '(path)'} ${m.fileSizeMode === 'over' ? '>' : '<'} ${m.fileSizeThresholdMb} MB`;
    case 'ping': return pingSummary(m);
    case 'process': return processSummary(m);
    case 'service': return serviceSummary(m);
    case 'software': return softwareSummary(m);
    default: return m.checkType;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* ── Breadcrumb ── */
.pf-crumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted); margin-bottom: 14px;
}
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* ── Top bar ── */
.pf-topbar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 28px;
}
.pf-back {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--muted-2); cursor: pointer; flex-shrink: 0;
  transition: color .12s, background .12s;
}
.pf-back:hover { color: var(--text); background: var(--border); }
.pf-title { font-size: 20px; font-weight: 700; color: var(--text); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }

.pf-state { padding: 40px; text-align: center; color: var(--muted); }

/* ── Body ── */
.pf-body { display: flex; flex-direction: column; gap: 0; }

/* ── Form group ── */
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label {
  font-size: 15px; font-weight: 600; color: var(--text);
}
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.pf-textarea { resize: vertical; min-height: 80px; }
.pf-err { font-size: 11px; color: var(--red); }

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }
.seg-btn.seg-primary.active { background: var(--accent); color: #fff; }

/* ── Monitors section ── */
.pf-monitors {
  border: 1px solid var(--border); border-radius: 7px; overflow: hidden;
  background: var(--surface);
}
.pf-tbl-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  font-size: 11px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .05em;
}
.pf-th-type { min-width: 80px; }
.pf-mon-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; padding: 32px 24px; text-align: center;
}
.pf-mon-empty p { font-size: 12px; color: var(--muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; border-bottom: 1px solid var(--border);
}
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--muted); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }
.pf-mon-add { padding: 8px 14px; border-top: 1px solid var(--border); }

/* ── Targets section ── */
.pf-targets { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-target-body { padding: 16px 14px; display: flex; flex-direction: column; gap: 16px; }
.pf-target-sec { display: flex; flex-direction: column; gap: 8px; }
.pf-target-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

.pill-group { display: flex; flex-wrap: wrap; gap: 6px; }
.pill-opt {
  display: inline-flex; align-items: center;
  padding: 5px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: var(--surface-2); font-size: 12px; font-weight: 500; color: var(--muted);
  cursor: pointer; user-select: none;
  transition: border-color .12s, background .12s, color .12s;
}
.pill-opt.active { border-color: var(--accent); background: rgba(78,126,247,.12); color: var(--accent); }
.pill-cb { display: none; }

/* ── btn-text ── */
.btn-text {
  background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font);
  color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s;
}
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }

/* ── check chip (reuse from policies page) ── */
.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; white-space: nowrap;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16);  color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12);   color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14);  color: var(--accent); }
.chip-av_status    { background: rgba(45,207,160,.14);  color: var(--teal); }
.chip-file_size    { background: rgba(132,134,168,.16);  color: var(--muted-2); }
.chip-ping         { background: rgba(45,207,160,.14);   color: var(--teal); }
.chip-process      { background: rgba(240,168,64,.16);   color: var(--amber); }
.chip-service      { background: rgba(200,80,180,.14);   color: #c850b4; }
.chip-software     { background: rgba(80,180,120,.14);   color: #50b478; }

/* ── btn-icon ── */
.btn-icon {
  background: none; border: none; cursor: pointer; color: var(--muted);
  padding: 6px; display: flex; align-items: center; border-radius: 4px;
  transition: background .1s, color .1s;
}
.btn-icon:hover { background: var(--surface-2); color: var(--text); }

/* ═══════════════════════════════════════════════════════
   Add / Edit Monitor drawer (right-side panel)
   ═══════════════════════════════════════════════════════ */
.mo-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 500;
  display: flex; align-items: stretch; justify-content: flex-end;
}

.mo-inner {
  display: flex; flex-direction: column;
  width: 620px; max-width: calc(100vw - 160px);
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4);
  overflow: hidden;
}

.mo-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.mo-head-title { font-size: 18px; font-weight: 700; color: var(--text); margin: 0; }

.mo-body { flex: 1; overflow-y: auto; padding: 0 24px; }
.mo-sec  { padding: 24px 0; }
.mo-div  { border-top: 1px solid var(--border); margin: 0; }

.mo-sec-hd {
  display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
}
.mo-sec-hd strong { font-size: 15px; font-weight: 600; color: var(--text); }
.mo-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--border-2); flex-shrink: 0;
}
.mo-dot.active { background: var(--accent); box-shadow: 0 0 0 3px rgba(78,126,247,.2); }
.mo-optional { font-size: 12px; color: var(--muted); margin-left: 2px; }
.mo-sec-sub { font-size: 12px; color: var(--muted); margin: -8px 0 16px 20px; line-height: 1.5; }

/* Type card grid */
.mo-type-grid {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.mo-type-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 20px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--muted-2); font-size: 12px; font-weight: 500; font-family: var(--font);
  transition: border-color .12s, color .12s, background .12s;
  min-width: 100px;
}
.mo-type-card:hover { border-color: var(--border-2); color: var(--text); }
.mo-type-card.selected {
  border-color: var(--accent); background: rgba(78,126,247,.08); color: var(--accent);
}
.mo-type-card svg { flex-shrink: 0; }

/* Monitor fields */
.mf-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.mf-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .04em;
}
.field-hint { display: block; font-size: 11px; color: var(--muted); margin-top: 6px; }
.mf-row   { display: flex; align-items: center; gap: 8px; }
.mf-unit  { font-size: 13px; color: var(--muted); white-space: nowrap; }
.mf-input {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box; width: 100%;
}
.mf-input:focus { border-color: var(--accent); }
.mf-select { max-width: 380px; }
.mf-pair { display: flex; gap: 16px; }
.mf-pair .mf-field { flex: 1; min-width: 0; }
.mf-warn {
  font-size: 11px; color: var(--amber); line-height: 1.5;
  background: rgba(240,168,64,.08); border: 1px solid rgba(240,168,64,.2);
  border-radius: 5px; padding: 7px 10px; margin-top: 4px;
}
.mf-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text); cursor: pointer;
  margin-bottom: 4px;
}

/* Toggle in response section */
.mf-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-top: 1px solid var(--border);
}
.mf-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.mf-toggle-title { font-size: 13px; font-weight: 500; color: var(--text); }
.mf-toggle-sub   { font-size: 11px; color: var(--muted); }
.mf-tgl {
  position: relative; width: 40px; height: 22px; border-radius: 11px;
  background: var(--border); border: none; cursor: pointer;
  transition: background .15s; flex-shrink: 0;
}
.mf-tgl.on { background: var(--accent); }
.mf-tgl-thumb {
  position: absolute; top: 3px; left: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  transition: left .15s;
}
.mf-tgl.on .mf-tgl-thumb { left: 21px; }

.mo-error { color: var(--red); font-size: 12px; padding: 8px 0; }

.mo-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border); flex-shrink: 0;
}

/* ── Target flyout (mirrors JobFormPage.vue's .tf- pattern verbatim, per
   this codebase's per-component CSS duplication convention) ── */
.tf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 500;
  display: flex; align-items: stretch; justify-content: flex-end;
}
.tf-panel {
  display: flex; flex-direction: column;
  width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.tf-head { display: flex; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tf-title { font-size: 15px; font-weight: 600; color: var(--text); flex: 1; margin: 0; }
.tf-close {
  background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s;
}
.tf-close:hover { background: var(--surface-2); color: var(--text); }
.tf-cat { padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tf-act-btn { flex-shrink: 0; }
.tf-search { padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tf-list { flex: 1; overflow-y: auto; }
.tf-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 1px solid var(--border); cursor: pointer; transition: background .08s;
  font-size: 13px; color: var(--text);
}
.tf-row:last-child { border-bottom: none; }
.tf-row:hover { background: var(--surface-2); }
.tf-row-selected { background: rgba(78,126,247,.08); border-left: 2px solid var(--accent); }
.tf-check { width: 22px; display: flex; align-items: center; justify-content: center; color: var(--teal); flex-shrink: 0; cursor: pointer; }
.tf-row-info { display: flex; flex-direction: column; gap: 1px; }
.tf-row-sub { font-size: 11px; color: var(--muted-2); }
.tf-empty-msg { padding: 20px 16px; font-size: 13px; color: var(--muted); text-align: center; }
.tf-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }

/* Target row kind tag (site/device/group) — mirrors JobFormPage.vue's .jf-kind-tag */
.jf-kind-tag { font-size: 10px; font-weight: 700; color: var(--muted-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
</style>
