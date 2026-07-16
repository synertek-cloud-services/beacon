<template>
  <div v-if="loading" class="jd-loading-full">Loading…</div>
  <div v-else-if="!detail" class="jd-loading-full">Job not found.</div>
  <div v-else class="jd-page">

    <nav class="pf-crumb">
      <RouterLink to="/jobs" class="pf-crumb-link">Jobs</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ detail.name }}</span>
    </nav>

    <div class="jd-topbar">
      <h1 class="jd-title">{{ detail.name }}</h1>
      <div class="jd-topbar-actions">
        <button v-if="detail.status === 'active'" class="btn btn-ghost btn-sm" :disabled="actionBusy" @click="retire">Retire</button>
        <button v-if="isAdmin" class="btn btn-ghost btn-sm btn-danger-ghost" :disabled="actionBusy" @click="purge">Purge</button>
      </div>
    </div>

    <div v-if="actionError" class="error-banner" style="margin-bottom:12px">{{ actionError }}</div>

    <!-- Details -->
    <div class="jd-card">
      <div class="jd-card-title">Details</div>
      <div class="jd-details-grid">
        <div class="jd-details-col">
          <div class="jd-det-row">
            <span class="jd-det-label">Components</span>
            <span class="jd-det-val">{{ componentNames }}</span>
          </div>
          <div class="jd-det-row">
            <span class="jd-det-label">Targets</span>
            <span class="jd-det-val">{{ targetsLabel }}</span>
          </div>
        </div>
        <div class="jd-details-col">
          <div class="jd-det-row">
            <span class="jd-det-label">Schedule</span>
            <span class="jd-det-val">{{ scheduleLabel }}</span>
          </div>
          <div class="jd-det-row">
            <span class="jd-det-label">Expiration</span>
            <span class="jd-det-val">{{ expirationLabel }}</span>
          </div>
          <div class="jd-det-row">
            <span class="jd-det-label">Created</span>
            <span class="jd-det-val">{{ fmtTs(detail.createdAt) }}</span>
          </div>
          <div class="jd-det-row">
            <span class="jd-det-label">Created by</span>
            <span class="jd-det-val jd-accent">{{ detail.createdBy ?? '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Job Summary -->
    <div class="jd-card">
      <div class="jd-card-title">Job Summary · Started {{ startedAgo }}</div>
      <div class="jd-flow-wrap">
        <svg class="jd-flow-svg" viewBox="0 0 680 210" preserveAspectRatio="xMidYMid meet">
          <!-- Connector lines -->
          <!-- Pending → Running -->
          <line x1="148" y1="45" x2="218" y2="45" stroke="var(--border-2)" stroke-width="1.5"/>
          <!-- Running → fork column -->
          <path d="M 368 45 H 400 V 175 M 400 45 H 428 M 400 110 H 428 M 400 175 H 428"
            fill="none" stroke="var(--border-2)" stroke-width="1.5"/>

          <!-- Pending box -->
          <rect x="8" y="18" width="140" height="54" rx="5"
            :fill="flowFill('pending')" :stroke="flowStroke('pending')" stroke-width="1.2"/>
          <text x="78" y="44" text-anchor="middle" font-size="18" font-weight="700" :fill="flowCount('pending')">{{ flowStats.queued }}</text>
          <text x="78" y="61" text-anchor="middle" font-size="11" fill="var(--muted)">Pending</text>

          <!-- Running box -->
          <rect x="218" y="18" width="150" height="54" rx="5"
            :fill="flowFill('running')" :stroke="flowStroke('running')" stroke-width="1.2"/>
          <text x="293" y="44" text-anchor="middle" font-size="18" font-weight="700" :fill="flowCount('running')">{{ flowStats.sent }}</text>
          <text x="293" y="61" text-anchor="middle" font-size="11" fill="var(--muted)">Running</text>

          <!-- Successes box -->
          <rect x="428" y="18" width="150" height="54" rx="5"
            :fill="flowFill('success')" :stroke="flowStroke('success')" stroke-width="1.2"/>
          <text x="503" y="44" text-anchor="middle" font-size="18" font-weight="700" :fill="flowCount('success')">{{ flowStats.successes }}</text>
          <text x="503" y="61" text-anchor="middle" font-size="11" fill="var(--muted)">Successes</text>

          <!-- Warnings box -->
          <rect x="428" y="83" width="150" height="54" rx="5"
            :fill="flowFill('warning')" :stroke="flowStroke('warning')" stroke-width="1.2"/>
          <text x="503" y="109" text-anchor="middle" font-size="18" font-weight="700" :fill="flowCount('warning')">{{ flowStats.warnings }}</text>
          <text x="503" y="126" text-anchor="middle" font-size="11" fill="var(--muted)">Warnings</text>

          <!-- Failures box -->
          <rect x="428" y="148" width="150" height="54" rx="5"
            :fill="flowFill('failure')" :stroke="flowStroke('failure')" stroke-width="1.2"/>
          <text x="503" y="174" text-anchor="middle" font-size="18" font-weight="700" :fill="flowCount('failure')">{{ flowStats.failures }}</text>
          <text x="503" y="191" text-anchor="middle" font-size="11" fill="var(--muted)">Failures</text>
        </svg>
      </div>
    </div>

    <!-- Devices table -->
    <div class="jd-card jd-devices-card">
      <div class="jd-devices-head">
        <span>Devices</span>
        <span class="jd-badge">{{ detail.devices.length }}</span>
      </div>
      <div v-if="detail.devices.length === 0" class="jd-empty-devs">No devices ran this job yet.</div>
      <table v-else class="jd-table">
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Site</th>
            <th>Component results</th>
            <th>Ran On</th>
            <th>Job Status</th>
            <th>StdOut / StdErr</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="dev in detail.devices" :key="dev.deviceId">
            <tr class="jd-dev-row" @click="router.push('/devices/' + dev.deviceId)" style="cursor:pointer">
              <td>
                <RouterLink :to="'/devices/' + dev.deviceId" @click.stop class="jd-link">
                  {{ dev.hostname ?? dev.deviceId.slice(0, 8) }}
                </RouterLink>
              </td>
              <td class="text-muted-2">{{ dev.tenantName }}</td>
              <td class="text-sm">{{ componentResultsLabel(dev) }}</td>
              <td class="text-sm text-muted-2">{{ ranOnLabel(dev) }}</td>
              <td>
                <span :class="['jd-status', deviceStatusClass(dev)]">{{ deviceStatusLabel(dev) }}</span>
              </td>
              <td class="jd-out-cell">
                <template v-for="cmd in dev.commands" :key="cmd.id">
                  <template v-if="parseResult(cmd)">
                    <button v-if="parseResult(cmd)!.stdout" class="jd-out-btn"
                      @click.stop="toggleOutput(dev.deviceId, cmd.id, 'stdout', parseResult(cmd)!.stdout)">
                      StdOut
                    </button>
                    <button v-if="parseResult(cmd)!.stderr" class="jd-out-btn jd-out-err"
                      @click.stop="toggleOutput(dev.deviceId, cmd.id, 'stderr', parseResult(cmd)!.stderr)">
                      StdErr
                    </button>
                  </template>
                </template>
              </td>
            </tr>
            <!-- Output expansion row -->
            <tr v-if="expandedOutput?.devId === dev.deviceId" class="jd-output-row">
              <td colspan="6">
                <div class="jd-output-wrap">
                  <div class="jd-output-label">
                    {{ expandedOutput.type === 'stdout' ? 'Standard Output' : 'Standard Error' }}
                    <button class="jd-output-close" @click="expandedOutput = null">×</button>
                  </div>
                  <pre class="jd-output-pre">{{ expandedOutput.content }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type JobDetail, type JobDevice, type JobDeviceCommand } from '../api';
import { hasRole } from '../auth';

const route  = useRoute();
const router = useRouter();

const detail     = ref<JobDetail | null>(null);
const loading    = ref(true);
const actionBusy = ref(false);
const actionError = ref('');

const isAdmin = computed(() => hasRole('admin'));

interface CmdResult { stdout: string; stderr: string; exit_code: number; }
const resultCache = new WeakMap<JobDeviceCommand, CmdResult | null>();
function parseResult(cmd: JobDeviceCommand): CmdResult | null {
  if (resultCache.has(cmd)) return resultCache.get(cmd)!;
  let r: CmdResult | null = null;
  try { r = cmd.result ? JSON.parse(cmd.result) : null; } catch { r = null; }
  resultCache.set(cmd, r);
  return r;
}

const expandedOutput = ref<{ devId: string; cmdId: string; type: 'stdout'|'stderr'; content: string } | null>(null);
function toggleOutput(devId: string, cmdId: string, type: 'stdout'|'stderr', content: string) {
  if (expandedOutput.value?.cmdId === cmdId && expandedOutput.value.type === type) {
    expandedOutput.value = null;
  } else {
    expandedOutput.value = { devId, cmdId, type, content };
  }
}

// ── Flow stats ────────────────────────────────────────────────────

const flowStats = computed(() => {
  let queued = 0, sent = 0, successes = 0, warnings = 0, failures = 0;
  for (const dev of (detail.value?.devices ?? [])) {
    for (const cmd of dev.commands) {
      if      (cmd.status === 'queued')               queued++;
      else if (cmd.status === 'sent')                 sent++;
      else if (cmd.status === 'failed')               failures++;
      else if (cmd.status === 'completed' && cmd.warning) warnings++;
      else if (cmd.status === 'completed')            successes++;
    }
  }
  return { queued, sent, successes, warnings, failures };
});

type FlowBox = 'pending' | 'running' | 'success' | 'warning' | 'failure';
function flowVal(box: FlowBox): number {
  const s = flowStats.value;
  return box === 'pending' ? s.queued : box === 'running' ? s.sent
    : box === 'success' ? s.successes : box === 'warning' ? s.warnings : s.failures;
}
function flowFill(box: FlowBox): string {
  const n = flowVal(box);
  if (!n) return 'var(--surface-2)';
  if (box === 'success') return 'rgba(52,199,89,.12)';
  if (box === 'warning') return 'rgba(240,168,64,.10)';
  if (box === 'failure') return 'rgba(255,69,58,.10)';
  return 'rgba(78,126,247,.08)';
}
function flowStroke(box: FlowBox): string {
  const n = flowVal(box);
  if (!n) return 'var(--border)';
  if (box === 'success') return 'rgba(52,199,89,.35)';
  if (box === 'warning') return 'rgba(240,168,64,.35)';
  if (box === 'failure') return 'rgba(255,69,58,.30)';
  return 'rgba(78,126,247,.35)';
}
function flowCount(box: FlowBox): string {
  const n = flowVal(box);
  if (!n) return 'var(--muted-2)';
  if (box === 'success') return 'var(--green)';
  if (box === 'warning') return 'var(--amber)';
  if (box === 'failure') return 'var(--red)';
  return 'var(--accent)';
}

// ── Details helpers ────────────────────────────────────────────────

const componentNames = computed(() => {
  const names = new Set<string>();
  for (const dev of (detail.value?.devices ?? [])) {
    for (const cmd of dev.commands) { if (cmd.componentName) names.add(cmd.componentName); }
  }
  if (!names.size) {
    try {
      const refs = JSON.parse(detail.value?.componentIds ?? '[]') as any[];
      return refs.length ? `${refs.length} component${refs.length !== 1 ? 's' : ''}` : '—';
    } catch { return '—'; }
  }
  return [...names].join(', ');
});

const targetsLabel = computed(() => {
  const j = detail.value;
  if (!j) return '—';
  if (j.targetType === 'all') return 'All Devices';
  const ids = (() => { try { return JSON.parse(j.targetIds ?? '[]') as string[]; } catch { return []; } })();
  if (j.targetType === 'tenants') return `${ids.length} site${ids.length !== 1 ? 's' : ''}`;
  return `${j.deviceCount} device${j.deviceCount !== 1 ? 's' : ''}`;
});

const scheduleLabel = computed(() => {
  const j = detail.value;
  if (!j) return '—';
  return j.scheduledAt ? `Scheduled for ${fmtTs(j.scheduledAt)}` : 'Run immediately';
});

const expirationLabel = computed(() => {
  const j = detail.value;
  if (!j) return '—';
  return j.expiresAt ? fmtTs(j.expiresAt) : 'Does not expire';
});

const startedAgo = computed(() => {
  if (!detail.value) return '';
  return relTime(detail.value.createdAt);
});

// ── Device table helpers ──────────────────────────────────────────

function componentResultsLabel(dev: JobDevice): string {
  const parts: string[] = [];
  for (const cmd of dev.commands) {
    const name = cmd.componentName ?? `Step ${cmd.componentOrder}`;
    if (cmd.status === 'completed' && !cmd.warning) parts.push(`1 Success: ${name}`);
    else if (cmd.status === 'completed' && cmd.warning) parts.push(`1 Warning: ${name}`);
    else if (cmd.status === 'failed') parts.push(`1 Failed: ${name}`);
    else if (cmd.status === 'sent') parts.push(`Running: ${name}`);
    else parts.push(`Pending: ${name}`);
  }
  return parts.join(' · ') || '—';
}

function ranOnLabel(dev: JobDevice): string {
  const ts = dev.commands.map(c => c.completedAt).filter(Boolean) as number[];
  if (!ts.length) return '—';
  return fmtTs(Math.min(...ts));
}

function deviceStatusClass(dev: JobDevice): string {
  const cmds = dev.commands;
  if (cmds.some(c => c.status === 'failed'))              return 'jd-status-failed';
  if (cmds.some(c => c.status === 'completed' && c.warning)) return 'jd-status-warning';
  if (cmds.every(c => c.status === 'completed'))           return 'jd-status-success';
  if (cmds.some(c => c.status === 'sent'))                 return 'jd-status-sent';
  return 'jd-status-queued';
}

function deviceStatusLabel(dev: JobDevice): string {
  const cls = deviceStatusClass(dev);
  if (cls === 'jd-status-failed')  return 'Failed';
  if (cls === 'jd-status-warning') return 'Warning';
  if (cls === 'jd-status-success') return 'Success';
  if (cls === 'jd-status-sent')    return 'Running';
  return 'Queued';
}

// ── Formatting ────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const d = Math.floor(diff / 86400);
  return `${d} day${d !== 1 ? 's' : ''} ago`;
}

// ── Actions ───────────────────────────────────────────────────────

async function retire() {
  if (!detail.value) return;
  actionBusy.value = true;
  actionError.value = '';
  try {
    await api.jobs.cancel(detail.value.id);
    detail.value = { ...detail.value, status: 'cancelled' };
  } catch (e: any) {
    actionError.value = e.message;
  } finally {
    actionBusy.value = false;
  }
}

async function purge() {
  if (!detail.value) return;
  if (!confirm(`Permanently delete job "${detail.value.name}" and all its results?`)) return;
  actionBusy.value = true;
  actionError.value = '';
  try {
    await api.jobs.purge(detail.value.id);
    router.push('/jobs');
  } catch (e: any) {
    actionError.value = e.message;
  } finally {
    actionBusy.value = false;
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  try {
    detail.value = await api.jobs.get(id);
  } catch {
    detail.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
/* Page shell */
.jd-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px; }
.jd-loading-full { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--muted); font-size: 14px; }

/* Topbar */
.jd-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.jd-title { font-size: 22px; font-weight: 700; color: var(--text); flex: 1; margin: 0; }
.jd-topbar-actions { display: flex; gap: 8px; }

/* Cards */
.jd-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.jd-card-title { font-size: 13px; font-weight: 600; color: var(--text); padding: 14px 18px 12px; border-bottom: 1px solid var(--border); }

/* Details grid */
.jd-details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 6px 0 10px; }
.jd-details-col { padding: 0 18px; }
.jd-details-col:first-child { border-right: 1px solid var(--border); }
.jd-det-row { display: flex; align-items: baseline; gap: 12px; padding: 7px 0; font-size: 13px; }
.jd-det-label { font-weight: 600; color: var(--muted); min-width: 100px; flex-shrink: 0; }
.jd-det-val { color: var(--text); }
.jd-accent { color: var(--accent); }

/* Flow diagram */
.jd-flow-wrap { padding: 20px 18px; }
.jd-flow-svg { width: 100%; max-width: 680px; height: auto; display: block; }

/* Devices card */
.jd-devices-card { padding: 0; }
.jd-devices-head { display: flex; align-items: center; gap: 8px; padding: 14px 18px 12px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; color: var(--text); }
.jd-badge { font-size: 11px; font-weight: 700; background: var(--border-2); color: var(--muted); padding: 1px 7px; border-radius: 10px; }
.jd-empty-devs { padding: 32px 18px; text-align: center; font-size: 13px; color: var(--muted); }

/* Devices table */
.jd-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.jd-table th { padding: 8px 14px; text-align: left; font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.jd-table td { padding: 11px 14px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: middle; }
.jd-dev-row:last-child td { border-bottom: none; }
.jd-dev-row:hover { background: var(--surface-2); }
.jd-link { color: var(--accent); text-decoration: none; font-weight: 500; }
.jd-link:hover { text-decoration: underline; }

/* Status badges */
.jd-status { display: inline-flex; padding: 3px 9px; border-radius: 4px; font-size: 11px; font-weight: 700; }
.jd-status-success  { background: rgba(52,199,89,.15);  color: var(--green); }
.jd-status-failed   { background: rgba(255,69,58,.12);  color: var(--red); }
.jd-status-warning  { background: rgba(240,168,64,.15); color: var(--amber); }
.jd-status-sent     { background: rgba(78,126,247,.12); color: var(--accent); }
.jd-status-queued   { background: var(--surface-2);     color: var(--muted); }

/* Output buttons */
.jd-out-cell { display: flex; gap: 6px; align-items: center; }
.jd-out-btn { background: none; border: 1px solid var(--border-2); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: var(--accent); cursor: pointer; font-family: var(--font); transition: background .1s; }
.jd-out-btn:hover { background: rgba(78,126,247,.08); }
.jd-out-err { color: var(--red); border-color: rgba(255,69,58,.3); }
.jd-out-err:hover { background: rgba(255,69,58,.06); }

/* Output expansion */
.jd-output-row td { padding: 0; border-bottom: 1px solid var(--border); }
.jd-output-wrap { background: var(--surface-2); border-top: 1px solid var(--border); }
.jd-output-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.jd-output-close { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 16px; line-height: 1; padding: 0 2px; }
.jd-output-close:hover { color: var(--text); }
.jd-output-pre { margin: 0; padding: 0 14px 14px; font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Mono', monospace; font-size: 12px; color: var(--text); white-space: pre-wrap; word-break: break-all; max-height: 320px; overflow-y: auto; line-height: 1.6; }
</style>
