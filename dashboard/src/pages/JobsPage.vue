<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="stat-row">
      <div class="stat-card" @click="setTab('all')" style="cursor:pointer">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ jobs.length }}</span>
      </div>
      <div class="stat-card" @click="setTab('quick')" style="cursor:pointer">
        <span class="stat-label">Quick</span>
        <span class="stat-value">{{ countFor('quick') }}</span>
      </div>
      <div class="stat-card" @click="setTab('scheduled')" style="cursor:pointer">
        <span class="stat-label">Scheduled</span>
        <span class="stat-value">{{ countFor('scheduled') }}</span>
      </div>
      <div class="stat-card" @click="setTab('active')" style="cursor:pointer">
        <span class="stat-label">Active</span>
        <span class="stat-value">{{ countFor('active') }}</span>
      </div>
      <div class="stat-card" @click="setTab('completed')" style="cursor:pointer">
        <span class="stat-label">Completed</span>
        <span class="stat-value">{{ countFor('completed') }}</span>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-head">
        <div class="tabs" style="border:none;margin:0">
          <button
            v-for="tab in tabs" :key="tab.value"
            class="tab" :class="{ active: activeTab === tab.value }"
            @click="setTab(tab.value)"
          >
            {{ tab.label }}
            <span class="tab-count">{{ countFor(tab.value) }}</span>
          </button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" @click="jobModalOpen = true">+ New Job</button>
          <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
        </div>
      </div>

      <CreateJobModal
        v-if="jobModalOpen"
        @created="onJobCreated"
        @close="jobModalOpen = false"
      />

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visible.length === 0" class="empty">
        <div class="empty-title">No jobs</div>
        <p class="empty-sub">Jobs appear here when you run a Quick Job from a device or create a Scheduled Job.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Targets</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="job in visible" :key="job.id">
            <tr
              :class="['job-row', expandedId === job.id ? 'job-row-active' : '']"
              style="cursor:pointer"
              @click="toggleExpanded(job)"
            >
              <td>
                <div class="job-name">{{ job.name }}</div>
                <div v-if="job.description" class="text-xs text-muted-2" style="margin-top:1px">{{ job.description }}</div>
              </td>
              <td><span :class="['type-badge', `type-${job.type}`]">{{ job.type }}</span></td>
              <td class="text-sm text-muted-2">{{ job.deviceCount }} device{{ job.deviceCount === 1 ? '' : 's' }}</td>
              <td>
                <div v-if="job.deviceCount > 0" class="prog-bar-wrap">
                  <div class="prog-bar">
                    <div class="prog-seg prog-completed" :style="{ width: pct(job.deviceStats.completed, job.deviceCount) + '%' }"></div>
                    <div class="prog-seg prog-failed"    :style="{ width: pct(job.deviceStats.failed, job.deviceCount) + '%' }"></div>
                    <div class="prog-seg prog-sent"      :style="{ width: pct(job.deviceStats.sent, job.deviceCount) + '%' }"></div>
                  </div>
                  <span class="prog-label">{{ job.deviceStats.completed + job.deviceStats.failed }}/{{ job.deviceCount }}</span>
                </div>
              </td>
              <td><span :class="['status-badge', `status-${job.status}`]">{{ job.status }}</span></td>
              <td class="text-sm text-muted-2">{{ relDate(job.createdAt) }}</td>
              <td @click.stop>
                <button class="btn btn-ghost btn-sm btn-danger-ghost" @click="cancelJob(job)" :disabled="job.status !== 'active'">Cancel</button>
              </td>
            </tr>

            <!-- Inline expansion: per-device breakdown -->
            <tr v-if="expandedId === job.id" class="expand-row">
              <td colspan="7" class="expand-cell">
                <div v-if="detailLoading" class="jd-loading">Loading device results…</div>
                <div v-else-if="detail">

                  <!-- Per-device cards -->
                  <div v-for="dev in detail.devices" :key="dev.deviceId" class="dev-card">
                    <div class="dev-card-head">
                      <div class="dev-card-info">
                        <router-link :to="'/devices/' + dev.deviceId" class="mono text-sm">{{ dev.hostname ?? dev.deviceId.slice(0, 8) }}</router-link>
                        <span v-if="dev.osType" class="text-xs text-muted-2">{{ dev.osType }}</span>
                        <span class="text-xs text-muted-2">{{ dev.tenantName }}</span>
                      </div>
                      <div class="dev-card-statuses">
                        <span
                          v-for="cmd in dev.commands" :key="cmd.id"
                          :class="['mini-badge', badgeClass(cmd)]"
                          :title="cmd.componentName ?? `Component ${cmd.componentOrder}`"
                        >{{ cmd.componentName ?? `Step ${cmd.componentOrder}` }}</span>
                      </div>
                    </div>

                    <!-- Command outputs -->
                    <div v-for="cmd in dev.commands" :key="cmd.id" class="cmd-output-block">
                      <div class="cmd-output-head">
                        <span :class="['mini-badge', badgeClass(cmd)]">{{ badgeLabel(cmd) }}</span>
                        <span class="text-xs text-muted-2" style="margin-left:6px">
                          {{ cmd.componentName ?? `Step ${cmd.componentOrder}` }}
                        </span>
                        <span class="text-xs text-muted-2" style="margin-left:auto">{{ relDate(cmd.createdAt) }}</span>
                      </div>
                      <template v-if="resultOf(cmd)">
                        <div v-if="resultOf(cmd)!.stdout" class="output-stream">
                          <div class="stream-label stream-out">stdout</div>
                          <pre class="output-pre">{{ resultOf(cmd)!.stdout }}</pre>
                        </div>
                        <div v-if="resultOf(cmd)!.stderr" class="output-stream">
                          <div class="stream-label stream-err">stderr</div>
                          <pre class="output-pre output-pre-err">{{ resultOf(cmd)!.stderr }}</pre>
                        </div>
                        <div v-if="!resultOf(cmd)!.stdout && !resultOf(cmd)!.stderr" class="output-empty">
                          (no output)
                        </div>
                        <div v-if="resultOf(cmd)!.exit_code !== 0" class="exit-code">
                          exit {{ resultOf(cmd)!.exit_code }}
                        </div>
                      </template>
                      <div v-else-if="cmd.status === 'queued'" class="output-empty">
                        Waiting for device to check in…
                      </div>
                      <div v-else-if="cmd.status === 'sent'" class="output-empty">
                        Running on device…
                      </div>
                    </div>
                  </div>

                  <div v-if="detail.devices.length === 0" class="jd-loading">
                    No devices matched this job's targets.
                  </div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type Job, type JobDetail, type JobDeviceCommand } from '../api';
import CreateJobModal from '../components/CreateJobModal.vue';

interface CmdResult { stdout: string; stderr: string; exit_code: number; }

const jobs       = ref<Job[]>([]);
const loading    = ref(true);
const error      = ref('');
const expandedId = ref<string | null>(null);
const detail     = ref<JobDetail | null>(null);
const detailLoading = ref(false);
const activeTab  = ref<'all' | 'quick' | 'scheduled' | 'active' | 'completed' | 'cancelled'>('all');
const jobModalOpen = ref(false);

function onJobCreated(job: Job) {
  jobModalOpen.value = false;
  jobs.value = [job, ...jobs.value];
}

const tabs = [
  { label: 'All',       value: 'all'       as const },
  { label: 'Quick',     value: 'quick'     as const },
  { label: 'Scheduled', value: 'scheduled' as const },
  { label: 'Active',    value: 'active'    as const },
  { label: 'Completed', value: 'completed' as const },
];

const TYPE_TABS   = new Set(['quick', 'scheduled']);

const visible = computed(() => {
  if (activeTab.value === 'all') return jobs.value;
  if (TYPE_TABS.has(activeTab.value))
    return jobs.value.filter(j => j.type === activeTab.value);
  return jobs.value.filter(j => j.status === activeTab.value);
});

function countFor(tab: typeof activeTab.value) {
  if (tab === 'all') return jobs.value.length;
  if (TYPE_TABS.has(tab)) return jobs.value.filter(j => j.type === tab).length;
  return jobs.value.filter(j => j.status === tab).length;
}

function setTab(v: typeof activeTab.value) {
  activeTab.value = v;
  expandedId.value = null;
  detail.value = null;
}

async function toggleExpanded(job: Job) {
  if (expandedId.value === job.id) {
    expandedId.value = null;
    detail.value = null;
    return;
  }
  expandedId.value = job.id;
  detail.value = null;
  detailLoading.value = true;
  try {
    detail.value = await api.jobs.get(job.id);
  } finally {
    detailLoading.value = false;
  }
}

async function load() {
  loading.value = jobs.value.length === 0;
  error.value = '';
  try {
    jobs.value = await api.jobs.list();
    // Refresh detail if one is open
    if (expandedId.value) {
      const fresh = await api.jobs.get(expandedId.value);
      detail.value = fresh;
      // Update the summary row too
      const idx = jobs.value.findIndex(j => j.id === expandedId.value);
      if (idx >= 0) {
        jobs.value[idx] = { ...jobs.value[idx],
          deviceStats: fresh.deviceStats,
          deviceCount: fresh.deviceCount,
          status:      fresh.status,
        };
      }
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function cancelJob(job: Job) {
  if (!confirm(`Cancel job "${job.name}"? Queued commands on offline devices will be marked failed.`)) return;
  try {
    await api.jobs.cancel(job.id);
    const j = jobs.value.find(x => x.id === job.id);
    if (j) j.status = 'cancelled';
  } catch (e: any) {
    error.value = e.message;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function badgeClass(cmd: JobDeviceCommand): string {
  if (cmd.status === 'completed' && cmd.warning) return 'mini-warning';
  return `mini-${cmd.status}`;
}
function badgeLabel(cmd: JobDeviceCommand): string {
  if (cmd.status === 'completed' && cmd.warning) return 'warning';
  return cmd.status;
}

function resultOf(cmd: JobDeviceCommand): CmdResult | null {
  if (!cmd.result) return null;
  try { return JSON.parse(cmd.result) as CmdResult; }
  catch { return null; }
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function relDate(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
/* ── Stat cards ── */
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; transition: border-color .12s; }
.stat-card:hover { border-color: var(--border-2); }
.stat-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

/* ── Tabs ── */
.tabs { display: flex; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-variant-numeric: tabular-nums; }

/* ── Job row ── */
.job-name { font-size: 13px; font-weight: 500; color: var(--text); }
.job-row-active td { background: rgba(78,126,247,.04); border-bottom: none; }

/* ── Type badge ── */
.type-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.type-quick     { background: rgba(78,126,247,.12);  color: var(--accent); }
.type-scheduled { background: rgba(156,106,247,.12); color: #9c6af7; }

/* ── Status badge ── */
.status-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.status-active    { background: rgba(45,207,160,.12); color: var(--teal); }
.status-completed { background: var(--surface-2);     color: var(--muted); }
.status-cancelled { background: rgba(232,86,106,.08); color: var(--red); }

/* ── Progress bar ── */
.prog-bar-wrap { display: flex; align-items: center; gap: 8px; }
.prog-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; display: flex; max-width: 120px; }
.prog-seg { height: 100%; transition: width .3s; }
.prog-completed { background: var(--teal); }
.prog-failed    { background: var(--red); }
.prog-sent      { background: var(--accent); }
.prog-label { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* ── Cancel button ── */
.btn-danger-ghost { color: var(--red) !important; }
.btn-danger-ghost:hover:not(:disabled) { background: rgba(232,86,106,.08) !important; }
.btn-danger-ghost:disabled { opacity: .35; cursor: not-allowed; }

/* ── Inline expansion ── */
.expand-row td { padding: 0; }
.expand-cell { border-bottom: 1px solid var(--border); background: var(--bg); border-left: 3px solid var(--border-2); }
.jd-loading { padding: 16px 20px; font-size: 12px; color: var(--muted); }

/* ── Device card ── */
.dev-card { border-bottom: 1px solid var(--border); }
.dev-card:last-child { border-bottom: none; }
.dev-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 20px 8px; background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.dev-card-info { display: flex; align-items: center; gap: 8px; }
.dev-card-statuses { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── Mini badges (inside device cards) ── */
.mini-badge { font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; }
.mini-queued    { background: rgba(240,168,64,.12);  color: var(--amber); }
.mini-sent      { background: rgba(78,126,247,.12);  color: var(--accent); }
.mini-completed { background: rgba(45,207,160,.12);  color: var(--teal); }
.mini-failed    { background: rgba(232,86,106,.12);  color: var(--red); }
.mini-warning   { background: rgba(240,168,64,.12);  color: var(--amber); }

/* ── Command output ── */
.cmd-output-block { padding: 10px 20px 12px; border-bottom: 1px solid var(--border); }
.cmd-output-block:last-child { border-bottom: none; }
.cmd-output-head { display: flex; align-items: center; margin-bottom: 8px; }
.output-stream { margin-bottom: 6px; }
.stream-label { font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 4px; }
.stream-out { color: var(--teal); }
.stream-err { color: var(--red); }
.output-pre {
  margin: 0; padding: 8px 12px;
  background: #080a11; border: 1px solid var(--border); border-radius: 5px;
  font-family: var(--mono); font-size: 12px; line-height: 1.6;
  color: #c8d0e8; white-space: pre-wrap; word-break: break-all;
}
.output-pre-err { color: var(--red); }
.output-empty { font-size: 12px; color: var(--muted); padding: 4px 0; }
.exit-code { font-size: 11px; font-family: var(--mono); color: var(--red); margin-top: 4px; }
</style>
