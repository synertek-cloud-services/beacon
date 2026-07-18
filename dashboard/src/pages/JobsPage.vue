<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="stat-row">
      <div class="stat-card stat-blue" @click="setTypeFilter(null)" style="cursor:pointer">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ jobs.length }}</span>
      </div>
      <div class="stat-card stat-accent" @click="setTypeFilter('quick')" style="cursor:pointer">
        <span class="stat-label">Immediate</span>
        <span class="stat-value">{{ jobs.filter(j => j.type === 'quick').length }}</span>
      </div>
      <div class="stat-card stat-purple" @click="setTypeFilter('scheduled')" style="cursor:pointer">
        <span class="stat-label">Scheduled</span>
        <span class="stat-value">{{ jobs.filter(j => j.type === 'scheduled').length }}</span>
      </div>
      <div class="stat-card stat-teal" @click="setStatusFilter('active')" style="cursor:pointer">
        <span class="stat-label">Active</span>
        <span class="stat-value">{{ jobs.filter(j => j.status === 'active').length }}</span>
      </div>
      <div class="stat-card stat-muted" @click="setStatusFilter('completed')" style="cursor:pointer">
        <span class="stat-label">Completed</span>
        <span class="stat-value">{{ jobs.filter(j => j.status === 'completed').length }}</span>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-head" style="flex-direction:column;align-items:flex-start;gap:8px;padding-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="filter-label">All Jobs</span>
            <span class="filter-count">{{ visible.length }}</span>
            <button class="btn btn-ghost btn-sm" :disabled="selected.size === 0" @click="retireSelected">Retire</button>
            <button class="btn btn-ghost btn-sm btn-danger-ghost" :disabled="selected.size === 0" @click="deleteSelected">Delete</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" @click="router.push('/jobs/new')">+ New Job</button>
            <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="filter-by">Filtered by:</span>
          <span v-if="filterType" class="filter-chip">
            Type: {{ filterType === 'quick' ? 'immediate' : filterType }}
            <button class="chip-x" @click="filterType = null">×</button>
          </span>
          <span v-if="filterStatus" class="filter-chip">
            Status: {{ filterStatus }}
            <button class="chip-x" @click="filterStatus = null">×</button>
          </span>
          <span v-if="filterUser" class="filter-chip">
            Created by: {{ filterUser }}
            <button class="chip-x" @click="filterUser = null">×</button>
          </span>
          <button v-if="!isDefaultFilters" class="btn-reset" @click="resetFilters">Reset Filters</button>
        </div>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visible.length === 0" class="empty">
        <div class="empty-title">No jobs</div>
        <p class="empty-sub">
          <template v-if="filterUser || filterStatus || filterType">No jobs match the current filters. <button class="btn-link" @click="resetFilters">Reset filters</button> to see all jobs.</template>
          <template v-else>Jobs appear here when you run a Quick Job from a device or create a Scheduled Job.</template>
        </p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th style="width:36px"><input type="checkbox" :checked="allVisibleSelected" @change="toggleSelectAll" /></th>
            <th>Name</th>
            <th>Type</th>
            <th>Targets</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Created by</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="job in paginated" :key="job.id">
            <tr
              class="job-row"
              style="cursor:pointer"
              @click="router.push('/jobs/' + job.id)"
            >
              <td @click.stop><input type="checkbox" :checked="selected.has(job.id)" @change="toggleSelect(job.id)" /></td>
              <td>
                <RouterLink :to="'/jobs/' + job.id" @click.stop class="job-name-link">{{ job.name }}</RouterLink>
                <div v-if="job.description" class="text-xs text-muted-2" style="margin-top:1px">{{ job.description }}</div>
              </td>
              <td><span :class="['type-badge', `type-${job.type}`]">{{ job.type === 'quick' ? 'immediate' : job.type }}</span></td>
              <td class="text-sm text-muted-2">{{ job.deviceCount }} device{{ job.deviceCount === 1 ? '' : 's' }}</td>
              <td>
                <div v-if="job.deviceCount > 0" class="prog-bar-wrap">
                  <div class="prog-bar">
                    <div class="prog-seg prog-completed" :style="{ width: pct(job.deviceStats.completed, job.deviceCount) + '%' }"></div>
                    <div class="prog-seg prog-failed"    :style="{ width: pct(job.deviceStats.failed, job.deviceCount) + '%' }"></div>
                    <div class="prog-seg prog-expired"   :style="{ width: pct(job.deviceStats.expired, job.deviceCount) + '%' }"></div>
                    <div class="prog-seg prog-sent"      :style="{ width: pct(job.deviceStats.sent, job.deviceCount) + '%' }"></div>
                  </div>
                  <span class="prog-label">{{ job.deviceStats.completed + job.deviceStats.failed + job.deviceStats.expired }}/{{ job.deviceCount }}</span>
                </div>
              </td>
              <td><span :class="['status-badge', `status-${job.status}`]">{{ job.status }}</span></td>
              <td class="text-sm text-muted-2">{{ job.createdBy ?? '—' }}</td>
              <td class="text-sm text-muted-2">{{ relDate(job.createdAt) }}</td>
            </tr>

          </template>
        </tbody>
      </table>

      <div v-if="totalPages > 1 || pageSize !== 20" class="pagination">
        <div class="page-info">{{ rangeStart }}–{{ rangeEnd }} of {{ visible.length }}</div>
        <div class="page-controls">
          <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--">‹</button>
          <template v-for="p in pageNumbers" :key="p">
            <span v-if="p === '...'" class="page-ellipsis">…</span>
            <button v-else :class="['page-btn', { 'page-btn-active': p === currentPage }]" @click="currentPage = (p as number)">{{ p }}</button>
          </template>
          <button class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">›</button>
        </div>
        <select class="page-size-select" :value="pageSize" @change="onPageSizeChange">
          <option value="20">20 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Job } from '../api';
import { authState } from '../auth';

const router = useRouter();

const jobs     = ref<Job[]>([]);
const loading  = ref(true);
const error    = ref('');
const selected = ref(new Set<string>());

// ── Filters ──────────────────────────────────────────────────────
const filterUser   = ref<string | null>(null);
const filterStatus = ref<string | null>('active');
const filterType   = ref<string | null>(null);

function currentUserName(): string | null {
  const u = authState.user;
  if (!u) return null;
  return u.displayName ?? u.email;
}

function initFilters() {
  filterUser.value = currentUserName();
}

const isDefaultFilters = computed(() =>
  filterUser.value === currentUserName() && filterStatus.value === 'active' && filterType.value === null
);

function resetFilters() {
  filterUser.value   = currentUserName();
  filterStatus.value = 'active';
  filterType.value   = null;
}

function setStatusFilter(status: string | null) {
  filterStatus.value = status;
}

function setTypeFilter(type: string | null) {
  filterType.value = type;
}

// ── Selection ────────────────────────────────────────────────────
const allVisibleSelected = computed(() =>
  visible.value.length > 0 && visible.value.every(j => selected.value.has(j.id))
);

function toggleSelect(id: string) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selected.value = s;
}

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(visible.value.map(j => j.id));
  }
}

async function retireSelected() {
  if (!selected.value.size) return;
  const ids = [...selected.value];
  try {
    await Promise.all(ids.map(id => api.jobs.cancel(id)));
    for (const id of ids) {
      const j = jobs.value.find(x => x.id === id);
      if (j) j.status = 'cancelled';
    }
    selected.value = new Set();
  } catch (e: any) { error.value = e.message; }
}

async function deleteSelected() {
  if (!selected.value.size) return;
  const count = selected.value.size;
  if (!confirm(`Permanently delete ${count} job${count === 1 ? '' : 's'} and all their command history? This cannot be undone.`)) return;
  const ids = [...selected.value];
  try {
    await Promise.all(ids.map(id => api.jobs.purge(id)));
    jobs.value = jobs.value.filter(j => !selected.value.has(j.id));
    selected.value = new Set();
  } catch (e: any) { error.value = e.message; }
}

const visible = computed(() => {
  return jobs.value.filter(j => {
    if (filterType.value   && j.type    !== filterType.value)   return false;
    if (filterUser.value   && j.createdBy !== filterUser.value) return false;
    if (filterStatus.value && j.status  !== filterStatus.value) return false;
    return true;
  });
});

// ── Pagination ────────────────────────────────────────────────────
const currentPage = ref(1);
const pageSize    = ref(20);

watch([filterUser, filterStatus, filterType], () => { currentPage.value = 1; });

const totalPages = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize.value)));
const rangeStart = computed(() => visible.value.length === 0 ? 0 : (currentPage.value - 1) * pageSize.value + 1);
const rangeEnd   = computed(() => Math.min(currentPage.value * pageSize.value, visible.value.length));

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return visible.value.slice(start, start + pageSize.value);
});

const pageNumbers = computed(() => {
  const total = totalPages.value;
  const cur   = currentPage.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (cur > 3) pages.push('...');
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
  if (cur < total - 2) pages.push('...');
  pages.push(total);
  return pages;
});

function onPageSizeChange(e: Event) {
  pageSize.value    = Number((e.target as HTMLSelectElement).value);
  currentPage.value = 1;
}

// ── Job actions ───────────────────────────────────────────────────
async function load() {
  loading.value = jobs.value.length === 0;
  error.value = '';
  try {
    jobs.value = await api.jobs.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
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
onMounted(() => { initFilters(); load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
/* ── Stat cards ── */
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card {
  flex: 1; display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-top-width: 3px; border-radius: 8px;
  transition: border-color .12s, filter .12s;
}
.stat-card:hover { filter: brightness(1.06); }
.stat-blue   { border-top-color: var(--color-primary-hover); }
.stat-accent { border-top-color: var(--color-primary); }
.stat-purple { border-top-color: #9c6af7; }
.stat-teal   { border-top-color: var(--color-success); }
.stat-muted  { border-top-color: var(--color-text-muted); }
.stat-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 20px; font-weight: 700; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }

/* ── Filter bar ── */
.filter-label { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.filter-count { background: var(--color-border-strong); color: var(--color-text-muted); font-size: 10px; padding: 1px 6px; border-radius: 3px; font-variant-numeric: tabular-nums; }
.filter-sep { color: var(--color-border-strong); }
.filter-by { font-size: 11px; color: var(--color-text-muted); }
.filter-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 500; color: var(--color-text-primary);
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 4px; padding: 2px 6px 2px 8px;
}
.chip-x {
  background: none; border: none; cursor: pointer;
  color: var(--color-text-muted); font-size: 13px; line-height: 1; padding: 0;
  display: flex; align-items: center;
}
.chip-x:hover { color: var(--color-text-primary); }
.btn-reset {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--color-primary); font-family: var(--font); padding: 0;
}
.btn-reset:hover { text-decoration: underline; }
.btn-link {
  background: none; border: none; cursor: pointer;
  color: var(--color-primary); font-size: inherit; font-family: var(--font); padding: 0;
}
.btn-link:hover { text-decoration: underline; }

/* ── Job row ── */
.job-name-link { font-size: 13px; font-weight: 500; color: var(--color-text-primary); text-decoration: none; }
.job-name-link:hover { color: var(--color-primary); }

/* ── Type badge ── */
.type-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.type-quick     { background: rgba(78,126,247,.12);  color: var(--color-primary); }
.type-scheduled { background: rgba(156,106,247,.12); color: #9c6af7; }

/* ── Status badge ── */
.status-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.status-active    { background: rgba(45,207,160,.12); color: var(--color-success); }
.status-completed { background: var(--color-surface-raised);     color: var(--color-text-muted); }
.status-cancelled { background: rgba(232,86,106,.08); color: var(--color-danger); }

/* ── Progress bar ── */
.prog-bar-wrap { display: flex; align-items: center; gap: 8px; }
.prog-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--color-border); overflow: hidden; display: flex; max-width: 120px; }
.prog-seg { height: 100%; transition: width .3s; }
.prog-completed { background: var(--color-success); }
.prog-failed    { background: var(--color-danger); }
.prog-expired   { background: #a078dc; }
.prog-sent      { background: var(--color-primary); }
.prog-label { font-size: 11px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }

/* ── Cancel button ── */
.btn-danger-ghost { color: var(--color-danger) !important; }
.btn-danger-ghost:hover:not(:disabled) { background: rgba(232,86,106,.08) !important; }
.btn-danger-ghost:disabled { opacity: .35; cursor: not-allowed; }

/* ── Pagination ── */
.pagination {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-top: 1px solid var(--color-border);
}
.page-info { font-size: 11px; color: var(--color-text-muted); margin-right: auto; font-variant-numeric: tabular-nums; }
.page-controls { display: flex; align-items: center; gap: 3px; }
.page-btn {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--color-border-strong); border-radius: 4px;
  background: var(--color-surface-raised); color: var(--color-text-muted);
  font-size: 12px; font-family: var(--font); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, color .1s;
}
.page-btn:hover:not(:disabled) { background: var(--color-border-strong); color: var(--color-text-primary); }
.page-btn:disabled { opacity: .35; cursor: not-allowed; }
.page-btn-active { background: var(--color-primary) !important; color: #fff !important; border-color: var(--color-primary) !important; }
.page-ellipsis { font-size: 12px; color: var(--color-text-muted); padding: 0 4px; }
.page-size-select {
  height: 28px; padding: 0 8px; border: 1px solid var(--color-border-strong); border-radius: 4px;
  background: var(--color-surface-raised); color: var(--color-text-muted); font-size: 11px; font-family: var(--font);
  cursor: pointer;
}
</style>
