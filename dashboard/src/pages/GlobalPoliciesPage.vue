<template>
  <div class="gp-page">
    <div class="gp-toolbar">
      <button class="btn btn-primary btn-sm" @click="openCreate">+ New Policy</button>
    </div>

    <div v-if="loading" class="gp-empty text-muted">Loading…</div>

    <div v-else-if="!monitors.length" class="gp-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);margin-bottom:8px">
        <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
      </svg>
      <div style="font-weight:500">No monitor policies yet</div>
      <div class="text-muted text-xs" style="margin-top:4px">Create a policy to start alerting on device health.</div>
    </div>

    <div v-else class="gp-table-wrap">
      <table class="gp-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Monitor</th>
            <th>Threshold</th>
            <th>Scope</th>
            <th>Consecutive Failures</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in monitors" :key="m.id">
            <td class="cell-company">{{ m.tenantName ?? m.tenantId }}</td>
            <td>
              <span class="check-chip" :class="`chip-${m.checkType}`">{{ checkLabel(m.checkType) }}</span>
            </td>
            <td class="mono text-xs">{{ formatThreshold(m.checkType, m.threshold) }}</td>
            <td class="text-xs text-muted">
              <span v-if="m.deviceClass">{{ m.deviceClass }}s only</span>
              <span v-else-if="m.deviceId" class="mono">{{ m.deviceId.slice(0, 8) }}…</span>
              <span v-else>All devices</span>
            </td>
            <td class="text-xs text-muted">{{ m.consecutiveFailuresRequired }}</td>
            <td style="text-align:right">
              <button class="btn btn-ghost btn-sm" style="color:var(--danger, #e04040)" @click="remove(m.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create Policy Modal -->
    <div v-if="showModal" class="modal-backdrop" @click.self="closeCreate">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">New Monitor Policy</span>
          <button class="btn-icon" @click="closeCreate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label class="field-label">Company</label>
            <select v-model="form.tenant_id" class="field-input">
              <option value="">Select a company…</option>
              <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Monitor Type</label>
            <select v-model="form.check_type" class="field-input">
              <option value="offline">Offline — device stops checking in</option>
              <option value="disk_space">Disk Space — free space falls below limit</option>
              <option value="cpu_usage">CPU Usage — sustained high CPU</option>
              <option value="memory_usage">Memory Usage — sustained high memory</option>
              <option value="av_status">Antivirus Status — AV not detected, not running, or out of date</option>
            </select>
          </div>

          <!-- Threshold inputs by type -->
          <div v-if="form.check_type === 'offline'" class="field">
            <label class="field-label">Alert after offline for</label>
            <div class="input-row">
              <input v-model.number="form.offline_minutes" type="number" min="1" max="43200" class="field-input" style="max-width:100px" />
              <span class="input-unit">minutes</span>
            </div>
          </div>

          <div v-if="form.check_type === 'disk_space'" class="field">
            <label class="field-label">Alert when free space below</label>
            <div class="input-row">
              <input v-model.number="form.disk_gb" type="number" min="1" max="10000" class="field-input" style="max-width:100px" />
              <span class="input-unit">GB</span>
            </div>
          </div>

          <div v-if="form.check_type === 'cpu_usage'" class="field">
            <label class="field-label">Alert when CPU usage exceeds</label>
            <div class="input-row">
              <input v-model.number="form.cpu_percent" type="number" min="1" max="100" class="field-input" style="max-width:100px" />
              <span class="input-unit">%</span>
            </div>
          </div>

          <div v-if="form.check_type === 'memory_usage'" class="field">
            <label class="field-label">Alert when memory usage exceeds</label>
            <div class="input-row">
              <input v-model.number="form.memory_percent" type="number" min="1" max="100" class="field-input" style="max-width:100px" />
              <span class="input-unit">%</span>
            </div>
          </div>

          <div v-if="form.check_type === 'av_status'" class="field">
            <label class="field-label">Alert when antivirus status is</label>
            <div class="check-group">
              <label class="check-row">
                <input type="checkbox" v-model="form.av_alert_on" value="not_detected" />
                <span>Not Detected — no AV product found</span>
              </label>
              <label class="check-row">
                <input type="checkbox" v-model="form.av_alert_on" value="not_running" />
                <span>Not Running — AV installed but disabled or stopped</span>
              </label>
              <label class="check-row">
                <input type="checkbox" v-model="form.av_alert_on" value="running_not_up_to_date" />
                <span>Running but Out of Date — signatures not current</span>
              </label>
            </div>
            <div class="field-hint">Applies to Windows devices. Linux detects ClamAV, ESET, Sophos.</div>
          </div>

          <div class="field">
            <label class="field-label">Apply to</label>
            <select v-model="form.device_class" class="field-input">
              <option value="">All devices</option>
              <option value="server">Servers only</option>
              <option value="workstation">Workstations only</option>
              <option value="laptop">Laptops only</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Priority</label>
            <select v-model="form.priority" class="field-input">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div v-if="form.check_type !== 'offline'" class="field">
            <label class="field-label">Consecutive failures before alerting</label>
            <input v-model.number="form.consecutive_failures" type="number" min="1" max="20" class="field-input" style="max-width:80px" />
          </div>

          <div v-if="createError" class="error-msg">{{ createError }}</div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" @click="closeCreate">Cancel</button>
          <button class="btn btn-primary btn-sm" :disabled="creating" @click="create">
            {{ creating ? 'Saving…' : 'Create Policy' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, type AlertDefinition, type CheckType, type Tenant } from '../api';

const monitors = ref<AlertDefinition[]>([]);
const tenants  = ref<Tenant[]>([]);
const loading  = ref(true);
const showModal = ref(false);
const creating  = ref(false);
const createError = ref('');

const form = ref({
  tenant_id:            '',
  check_type:           'offline' as CheckType,
  device_class:         '' as '' | 'server' | 'workstation' | 'laptop',
  offline_minutes:      30,
  disk_gb:              10,
  cpu_percent:          90,
  memory_percent:       90,
  consecutive_failures: 3,
  priority:             'high' as 'critical' | 'high' | 'moderate' | 'low',
  av_alert_on:          ['not_detected', 'not_running'] as string[],
});

async function load() {
  loading.value = true;
  try {
    const [defs, tenantList] = await Promise.all([
      api.monitors.list(),
      api.tenants.list(),
    ]);
    monitors.value = defs as AlertDefinition[];
    tenants.value  = tenantList;
  } catch {
    monitors.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openCreate() {
  createError.value = '';
  showModal.value   = true;
}

function closeCreate() {
  showModal.value = false;
}

async function create() {
  if (!form.value.tenant_id) {
    createError.value = 'Select a company.';
    return;
  }
  creating.value    = true;
  createError.value = '';

  const threshold = buildThreshold();

  try {
    await api.monitors.create({
      tenant_id:                    form.value.tenant_id,
      check_type:                   form.value.check_type,
      threshold,
      device_class:                 form.value.device_class || undefined,
      consecutive_failures_required: form.value.check_type === 'offline' ? 1 : form.value.consecutive_failures,
      priority:                     form.value.priority,
    });
    showModal.value = false;
    await load();
  } catch (e: unknown) {
    createError.value = e instanceof Error ? e.message : 'Failed to create policy.';
  } finally {
    creating.value = false;
  }
}

function buildThreshold(): Record<string, unknown> {
  switch (form.value.check_type) {
    case 'offline':
      return { offline_after_seconds: form.value.offline_minutes * 60 };
    case 'disk_space':
      return { bytes_free_min: form.value.disk_gb * 1073741824 };
    case 'cpu_usage':
      return { percent_max: form.value.cpu_percent };
    case 'memory_usage':
      return { percent_max: form.value.memory_percent };
    case 'av_status':
      return { alert_on: form.value.av_alert_on };
    default:
      return {};
  }
}

async function remove(id: string) {
  if (!confirm('Delete this monitor policy?')) return;
  try {
    await api.monitors.delete(id);
    await load();
  } catch {}
}

function checkLabel(ct: CheckType): string {
  switch (ct) {
    case 'disk_space':   return 'Disk Space';
    case 'offline':      return 'Offline';
    case 'cpu_usage':    return 'CPU';
    case 'memory_usage': return 'Memory';
    case 'av_status':    return 'Antivirus';
    default:             return ct;
  }
}

function formatThreshold(ct: CheckType, raw: string): string {
  try {
    const t = JSON.parse(raw) as Record<string, unknown>;
    switch (ct) {
      case 'disk_space':   return `< ${((t.bytes_free_min as number) / 1073741824).toFixed(0)} GB free`;
      case 'offline':      return `> ${Math.round((t.offline_after_seconds as number) / 60)} min offline`;
      case 'cpu_usage':    return `> ${t.percent_max}% CPU`;
      case 'memory_usage': return `> ${t.percent_max}% memory`;
      case 'av_status': {
        const states = (t.alert_on as string[]).map(s => s.replace(/_/g, ' '));
        return states.join(', ');
      }
      default: return raw;
    }
  } catch {
    return raw;
  }
}
</script>

<style scoped>
.gp-page { display: flex; flex-direction: column; height: 100%; }

.gp-toolbar {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
  flex-shrink: 0;
}

.gp-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
}

.gp-table-wrap { flex: 1; overflow: auto; }
.gp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gp-table th {
  text-align: left; padding: 6px 12px; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--muted);
  border-bottom: 1px solid var(--border); position: sticky; top: 0;
  background: var(--surface);
}
.gp-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: middle;
}
.gp-table tr:last-child td { border-bottom: none; }
.gp-table tr:hover td { background: var(--surface-2); }

.cell-company { font-weight: 500; }

.check-chip {
  display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; font-weight: 600;
}
.chip-disk_space   { background: rgba(130,80,240,.14); color: #8050f0; }
.chip-offline      { background: rgba(240,168,64,.16); color: var(--amber); }
.chip-cpu_usage    { background: rgba(240,80,60,.12); color: #e04040; }
.chip-memory_usage { background: rgba(78,126,247,.14); color: var(--accent); }
.chip-av_status    { background: rgba(45,207,160,.14); color: var(--teal); }

.mono { font-family: var(--font-mono, monospace); }

/* AV checkbox group */
.check-group { display: flex; flex-direction: column; gap: 8px; }
.check-row {
  display: flex; align-items: flex-start; gap: 8px; cursor: pointer;
  font-size: 12px; color: var(--text);
}
.check-row input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; accent-color: var(--accent); }
.field-hint { font-size: 11px; color: var(--muted); margin-top: 4px; }

/* ── Modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  width: 420px; max-width: 95vw; box-shadow: 0 12px 40px rgba(0,0,0,.25);
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);
}
.modal-title { flex: 1; font-weight: 600; font-size: 14px; }
.btn-icon {
  background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px;
  transition: background .1s, color .1s;
}
.btn-icon:hover { background: var(--surface-2); color: var(--text); }

.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px 16px; border-top: 1px solid var(--border);
}

.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.field-input {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2); color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; width: 100%; box-sizing: border-box;
}
.field-input:focus { border-color: var(--accent); }
.field-input option { background: var(--surface); }

.input-row { display: flex; align-items: center; gap: 8px; }
.input-unit { font-size: 13px; color: var(--muted); white-space: nowrap; }

.error-msg { color: #e04040; font-size: 12px; }
</style>
