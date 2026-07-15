<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/devices" class="pf-crumb-link">Devices</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <RouterLink :to="`/devices/${deviceId}`" class="pf-crumb-link">{{ device?.hostname ?? deviceId.slice(0, 8) }}</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">Change Log</span>
    </nav>

    <!-- Top bar -->
    <div class="pf-topbar">
      <button class="pf-back" @click="router.push(`/devices/${deviceId}`)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">Change Log</h1>
    </div>

    <div class="section-card">
      <div class="section-card-head" style="flex-direction:column;align-items:flex-start;gap:10px;padding-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="filter-label">Change Log</span>
          <span class="filter-count">{{ filtered.length }}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:10px">
          <div class="seg-bar">
            <button
              v-for="t in tabOptions" :key="t.value"
              :class="['seg-btn', { active: activeTab === t.value }]"
              @click="activeTab = t.value"
            >{{ t.label }}</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="filter-by">Filtered by:</span>
            <span class="filter-chip">Date created</span>
            <select v-model.number="dateRangeDays" class="page-size-select">
              <option :value="7">Last 7 Days</option>
              <option :value="30">Last 30 Days</option>
              <option :value="90">Last 90 Days</option>
              <option :value="0">All Time</option>
            </select>
            <button v-if="!isDefaultFilters" class="btn-reset" @click="resetFilters">Reset Filters</button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="filtered.length === 0" class="empty">
        <div class="empty-title">No changes</div>
        <p class="empty-sub">
          <template v-if="!isDefaultFilters">No changes match the current filters. <button class="btn-link" @click="resetFilters">Reset filters</button> to see everything.</template>
          <template v-else>No changes recorded yet. Changes appear after two or more audits.</template>
        </p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th>Date created</th>
            <th>Type</th>
            <th>Name</th>
            <th>Property</th>
            <th>Value</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ch in paginated" :key="ch.id">
            <td class="mono text-xs text-muted-2">{{ absDate(ch.detectedAt) }}</td>
            <td><span :class="['chg-badge', `chg-badge-${ch.category}`]">{{ ch.category }}</span></td>
            <td class="text-sm">{{ ch.itemName }}</td>
            <td class="text-xs text-muted-2">{{ ch.field ?? '—' }}</td>
            <td class="chg-diff mono text-xs">
              <template v-if="ch.oldValue || ch.newValue">
                <span v-if="ch.oldValue" class="chg-old">{{ ch.oldValue }}</span>
                <span v-if="ch.oldValue && ch.newValue" class="chg-arrow">→</span>
                <span v-if="ch.newValue" class="chg-new">{{ ch.newValue }}</span>
              </template>
              <span v-else class="text-muted-2">—</span>
            </td>
            <td><span :class="['chg-type', `chg-type-${ch.changeType}`]">{{ ch.changeType }}</span></td>
          </tr>
        </tbody>
      </table>

      <div v-if="totalPages > 1 || pageSize !== 50" class="pagination">
        <div class="page-info">{{ rangeStart }}–{{ rangeEnd }} of {{ filtered.length }}</div>
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
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Device, type AuditChange } from '../api';

const route  = useRoute();
const router = useRouter();

const deviceId = computed(() => route.params.id as string);
const device   = ref<Device | null>(null);
const changes  = ref<AuditChange[]>([]);
const loading  = ref(true);

async function load(id: string | undefined) {
  if (!id) return;
  loading.value = true;
  try {
    const [d, c] = await Promise.all([
      api.devices.get(id),
      api.devices.audit.changes(id, 500),
    ]);
    device.value  = d;
    changes.value = c;
  } finally {
    loading.value = false;
  }
}
// watch (not onMounted) since Vue Router reuses this component instance
// across param-only navigations, same convention as DeviceDetailPage.vue.
watch(deviceId, load, { immediate: true });

// ── Filters ──────────────────────────────────────────────────────
// Beacon's real change categories (software/hardware/services/security, per
// worker/src/routes/audit.ts's diff functions) — deliberately not Datto's
// System/Software/Hardware split, since Beacon has no "System" category.
const tabOptions = [
  { value: 'all',      label: 'All' },
  { value: 'software', label: 'Software' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'services', label: 'Services' },
  { value: 'security',  label: 'Security' },
];
const activeTab     = ref('all');
const dateRangeDays = ref(30);

const isDefaultFilters = computed(() => activeTab.value === 'all' && dateRangeDays.value === 30);
function resetFilters() {
  activeTab.value     = 'all';
  dateRangeDays.value = 30;
}

// changes.value already arrives sorted detectedAt DESC (server-side), so no
// re-sort is needed here — filtering alone preserves that order.
const filtered = computed(() => {
  const cutoff = dateRangeDays.value === 0 ? null : Math.floor(Date.now() / 1000) - dateRangeDays.value * 86400;
  return changes.value.filter(ch => {
    if (activeTab.value !== 'all' && ch.category !== activeTab.value) return false;
    if (cutoff !== null && ch.detectedAt < cutoff) return false;
    return true;
  });
});

// ── Pagination ────────────────────────────────────────────────────
const currentPage = ref(1);
const pageSize    = ref(50);

watch([activeTab, dateRangeDays], () => { currentPage.value = 1; });

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const rangeStart = computed(() => filtered.value.length === 0 ? 0 : (currentPage.value - 1) * pageSize.value + 1);
const rangeEnd   = computed(() => Math.min(currentPage.value * pageSize.value, filtered.value.length));

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
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

function absDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn {
  padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font);
  background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer;
  transition: background .12s, color .12s;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }

/* ── Filter bar ── */
.filter-label { font-size: 13px; font-weight: 600; color: var(--text); }
.filter-count { background: var(--border-2); color: var(--muted); font-size: 10px; padding: 1px 6px; border-radius: 3px; font-variant-numeric: tabular-nums; }
.filter-by { font-size: 11px; color: var(--muted); }
.filter-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 500; color: var(--text);
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 4px; padding: 2px 6px 2px 8px;
}
.btn-reset {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--accent); font-family: var(--font); padding: 0;
}
.btn-reset:hover { text-decoration: underline; }
.btn-link {
  background: none; border: none; cursor: pointer;
  color: var(--accent); font-size: inherit; font-family: var(--font); padding: 0;
}
.btn-link:hover { text-decoration: underline; }

/* ── Change badges (Type / Action / Value columns) ── */
.chg-badge {
  font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 3px;
}
.chg-badge-software { background: rgba(78,126,247,.12); color: var(--accent); }
.chg-badge-hardware { background: rgba(160,78,247,.12); color: #a04ef7; }
.chg-badge-services { background: rgba(240,168,64,.12);  color: var(--amber); }
.chg-badge-security { background: rgba(232,86,106,.12);  color: var(--red); }
.chg-type { font-size: 10px; font-weight: 700; }
.chg-type-added   { color: var(--teal); }
.chg-type-removed { color: var(--red); }
.chg-type-changed { color: var(--muted); }
.chg-diff { display: flex; align-items: center; gap: 4px; }
.chg-old   { color: var(--red); text-decoration: line-through; }
.chg-arrow { color: var(--muted); }
.chg-new   { color: var(--teal); }

/* ── Pagination ── */
.pagination {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-top: 1px solid var(--border);
}
.page-info { font-size: 11px; color: var(--muted); margin-right: auto; font-variant-numeric: tabular-nums; }
.page-controls { display: flex; align-items: center; gap: 3px; }
.page-btn {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--border-2); border-radius: 4px;
  background: var(--surface-2); color: var(--muted);
  font-size: 12px; font-family: var(--font); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, color .1s;
}
.page-btn:hover:not(:disabled) { background: var(--border-2); color: var(--text); }
.page-btn:disabled { opacity: .35; cursor: not-allowed; }
.page-btn-active { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }
.page-ellipsis { font-size: 12px; color: var(--muted); padding: 0 4px; }
.page-size-select {
  height: 28px; padding: 0 8px; border: 1px solid var(--border-2); border-radius: 4px;
  background: var(--surface-2); color: var(--muted); font-size: 11px; font-family: var(--font);
  cursor: pointer;
}
</style>
