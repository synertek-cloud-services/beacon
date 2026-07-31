<template>
  <div class="al-page">

    <!-- Table card -->
    <div class="al-card">

      <!-- Card header -->
      <div class="al-card-header">
        <div class="al-card-title">
          Activity Log
          <span v-if="total > 0" class="al-count-badge">{{ total }}</span>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="al-filters">
        <span class="al-filters-label">Filtered by:</span>
        <div class="al-pill-group">
          <span class="al-filter-tag">Category</span>
          <select v-model="categoryFilter" class="page-size-select">
            <option value="">All</option>
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="al-pill-group">
          <span class="al-filter-tag">Company</span>
          <select v-model="companyFilter" class="page-size-select">
            <option value="">All</option>
            <option v-for="t in companies" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <div class="al-pill-group">
          <span class="al-filter-tag">Created</span>
          <select v-model.number="dateRangeDays" class="page-size-select">
            <option :value="7">Last 7 Days</option>
            <option :value="30">Last 30 Days</option>
            <option :value="90">Last 90 Days</option>
            <option :value="0">All Time</option>
          </select>
        </div>
        <button v-if="!isDefaultFilters" class="btn-reset" @click="resetFilters">Reset Filters</button>
      </div>

      <!-- Table -->
      <div class="al-table-wrap">
        <div v-if="loading" class="al-state-msg text-muted">Loading…</div>

        <div v-else-if="!rows.length" class="al-state-msg">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted)">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <div style="margin-top:8px;font-weight:500">No activity recorded</div>
          <p v-if="!isDefaultFilters" style="font-size:12px;color:var(--color-text-muted)">
            No activity matches the current filters. <button class="btn-link" @click="resetFilters">Reset filters</button> to see everything.
          </p>
        </div>

        <table v-else class="al-table">
          <thead>
            <tr>
              <th class="th-date">Date</th>
              <th>Actor</th>
              <th>Category</th>
              <th class="th-action">Action</th>
              <th>Company</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="mono text-xs text-muted-2">{{ absDate(row.createdAt) }}</td>
              <td class="text-sm">{{ actorDisplay(row) }}</td>
              <td><span class="al-cat-badge">{{ row.category }}</span></td>
              <td class="td-action">{{ row.action }}</td>
              <td class="text-xs text-muted-2">{{ companyName(row.companyId) }}</td>
              <td>
                <RouterLink v-if="entityLink(row)" :to="entityLink(row)!" class="al-entity-link">
                  {{ row.entityType }} · {{ row.entityId!.slice(0, 8) }}
                </RouterLink>
                <span v-else-if="row.entityType" class="mono text-xs text-muted-2">{{ row.entityType }}{{ row.entityId ? ' · ' + row.entityId.slice(0, 8) : '' }}</span>
                <span v-else class="text-muted-2">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1 || pageSize !== 50" class="pagination">
        <div class="page-info">{{ rangeStart }}–{{ rangeEnd }} of {{ total }}</div>
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
import { ref, computed, watch, onMounted } from 'vue';
import { api, type ActivityLogEntry, type Company } from '../api';

// Mirrors worker/src/lib/activityLog.ts's PREFIX_DEFAULTS/FINE_GRAINED
// category set -- kept as a plain sorted list here rather than fetched from
// the server, since it's a small, effectively-static taxonomy.
const CATEGORIES = [
  'Agent Version', 'Alert', 'Auth', 'Branding', 'Command', 'Component', 'Custom Field',
  'Dashboard', 'Device', 'Device Group', 'Email Settings', 'Job', 'Maintenance Policy',
  'Notification Email', 'Patch', 'Patch Policy', 'Policy', 'Remote Session', 'Settings',
  'SSO', 'Company', 'User', 'Webhook',
].sort();

const rows    = ref<ActivityLogEntry[]>([]);
const total   = ref(0);
const loading = ref(true);
const companies = ref<Company[]>([]);

const categoryFilter = ref('');
const companyFilter   = ref('');
const dateRangeDays  = ref(30);
const currentPage    = ref(1);
const pageSize       = ref(50);

const isDefaultFilters = computed(() => !categoryFilter.value && !companyFilter.value && dateRangeDays.value === 30);
function resetFilters() {
  categoryFilter.value = '';
  companyFilter.value   = '';
  dateRangeDays.value  = 30;
}

async function load() {
  loading.value = true;
  try {
    const from = dateRangeDays.value === 0 ? undefined : Math.floor(Date.now() / 1000) - dateRangeDays.value * 86400;
    const res = await api.activityLog.list({
      category:  categoryFilter.value || undefined,
      company_id: companyFilter.value || undefined,
      from,
      limit:  pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    });
    rows.value  = res.rows;
    total.value = res.total;
  } catch {
    rows.value  = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  api.companies.list().then(t => { companies.value = t; }).catch(() => { companies.value = []; });
});

// Filter changes re-query the server and reset to page 1 -- unlike every
// other list page in this app, rows aren't pre-loaded client-side, so a
// filter change is a real new fetch, not a computed() re-slice.
watch([categoryFilter, companyFilter, dateRangeDays], () => { currentPage.value = 1; load(); });
watch([currentPage, pageSize], load);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const rangeStart  = computed(() => total.value === 0 ? 0 : (currentPage.value - 1) * pageSize.value + 1);
const rangeEnd    = computed(() => Math.min(currentPage.value * pageSize.value, total.value));

const pageNumbers = computed(() => {
  const t = totalPages.value, cur = currentPage.value;
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (cur > 3) pages.push('...');
  for (let p = Math.max(2, cur - 1); p <= Math.min(t - 1, cur + 1); p++) pages.push(p);
  if (cur < t - 2) pages.push('...');
  pages.push(t);
  return pages;
});

function onPageSizeChange(e: Event) {
  pageSize.value    = Number((e.target as HTMLSelectElement).value);
  currentPage.value = 1;
}

// Cheap "click through to the real thing" links rather than fetching a
// friendly name per row (would need a per-entity-type name-resolution
// fetch across ~15 different entity types) -- the destination page already
// shows the name once you land on it. Left out of scope for v1, see
// CLAUDE.md's Activity Log section.
const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  device:             (id) => `/devices/${id}`,
  policy:             (id) => `/global/policies/${id}`,
  job:                (id) => `/jobs/${id}`,
  component:          (id) => `/components/${id}`,
  user:               (id) => `/settings/users/${id}`,
  group:              (id) => `/groups/${id}`,
  dashboard:          (id) => `/dashboards/${id}`,
  patchPolicy:        (id) => `/global/patch-policies/${id}`,
  maintenancePolicy:  (id) => `/global/maintenance-policies/${id}`,
  alert:              (id) => `/global/alerts/${id}`,
  company:            (id) => `/devices?company=${id}`,
};
function entityLink(row: ActivityLogEntry): string | null {
  if (!row.entityType || !row.entityId) return null;
  const fn = ENTITY_ROUTES[row.entityType];
  return fn ? fn(row.entityId) : null;
}

function companyName(id: string | null): string {
  if (!id) return '—';
  return companies.value.find(t => t.id === id)?.name ?? id.slice(0, 8);
}

function actorDisplay(row: ActivityLogEntry): string {
  if (row.actorType === 'break-glass') return 'Emergency Access';
  if (row.actorType === 'system')      return 'System';
  return row.actorLabel ?? row.actorId ?? 'Unknown';
}

function absDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
</script>

<style scoped>
.al-page { display: flex; flex-direction: column; gap: 16px; height: 100%; }

.al-card {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--r-card);
}

.al-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 0;
  flex-shrink: 0;
}
.al-card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: var(--color-text-primary);
}
.al-count-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  background: var(--color-primary); color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 10px;
}

.al-filters {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.al-filters-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); }
.al-pill-group { display: flex; align-items: center; gap: 5px; }
.al-filter-tag { font-size: 11px; color: var(--color-text-subtle); }
.btn-reset {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--color-primary); font-family: var(--font); padding: 0;
  margin-left: auto;
}
.btn-reset:hover { text-decoration: underline; }
.btn-link {
  background: none; border: none; cursor: pointer;
  color: var(--color-primary); font-size: inherit; font-family: var(--font); padding: 0;
}
.btn-link:hover { text-decoration: underline; }

.al-table-wrap { flex: 1; overflow: auto; }
.al-state-msg {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 200px; gap: 4px; color: var(--color-text-primary);
}

.al-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.al-table thead { position: sticky; top: 0; z-index: 1; }
.al-table th {
  background: var(--color-surface-raised); padding: 7px 12px;
  text-align: left; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border); white-space: nowrap;
}
.th-date   { width: 160px; }
.th-action { min-width: 200px; }

.al-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--color-border);
  vertical-align: middle; color: var(--color-text-primary);
}
.al-table tr:last-child td { border-bottom: none; }
.al-table tr:hover td { background: var(--color-surface-raised); }
.td-action { color: var(--color-text-primary); }
.mono { font-family: var(--mono); white-space: nowrap; }

.al-cat-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 10px; font-weight: 600; white-space: nowrap;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong); color: var(--color-text-subtle);
}
.al-entity-link { color: var(--color-primary); text-decoration: none; font-size: 12px; white-space: nowrap; }
.al-entity-link:hover { text-decoration: underline; }

/* ── Pagination ── */
.pagination {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-top: 1px solid var(--color-border);
  flex-shrink: 0;
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
