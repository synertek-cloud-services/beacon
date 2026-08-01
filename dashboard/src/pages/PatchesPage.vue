<template>
  <div class="al-page">

    <!-- Table card -->
    <div class="al-card">

      <!-- Card header -->
      <div class="al-card-header">
        <div class="al-card-title">
          Patches
          <span v-if="total > 0" class="al-count-badge">{{ total }}</span>
        </div>
      </div>

      <!-- Filter pills -->
      <div class="al-filters">
        <span class="al-filters-label">Filtered by:</span>
        <div class="al-pill-group">
          <span class="al-filter-tag">Status</span>
          <button
            v-for="s in (['pending', 'approved', 'ignored', 'all'] as const)"
            :key="s"
            class="al-pill"
            :class="{ 'al-pill-active': statusFilter === s }"
            @click="statusFilter = s"
          >{{ capitalize(s) }}</button>
        </div>
        <span v-if="needsRescan > 0" class="al-rescan-note">
          {{ needsRescan }} pending patch{{ needsRescan === 1 ? '' : 'es' }} on older agents need a rescan before they can be approved
        </span>
      </div>

      <!-- Table -->
      <div class="al-table-wrap">
        <div v-if="loading" class="al-state-msg text-muted">Loading…</div>

        <div v-else-if="!filteredRows.length" class="al-state-msg">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-text-muted)">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <div style="margin-top:8px;font-weight:500">No patches match this filter</div>
        </div>

        <table v-else class="al-table">
          <thead>
            <tr>
              <th class="th-message">Title</th>
              <th>KB(s)</th>
              <th class="th-priority">Severity</th>
              <th>Categories</th>
              <th>Devices</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in filteredRows" :key="p.updateId">
              <td class="td-message">
                {{ p.title }}
                <span v-if="p.type === 'driver'" class="badge badge-pending" style="margin-left:6px">Driver</span>
              </td>
              <td class="mono">{{ p.kbArticleIds.length ? p.kbArticleIds.map(k => 'KB' + k).join(', ') : '—' }}</td>
              <td><span :class="severityBadge(p.severity)">{{ p.severity }}</span></td>
              <td class="td-category">{{ p.categories.join(', ') || '—' }}</td>
              <td>{{ p.deviceIds.length }}</td>
              <td><span class="status-pill" :class="statusClass(p.status)">{{ capitalize(p.status) }}</span></td>
              <td>
                <div class="row-actions">
                  <button
                    class="btn-action"
                    :disabled="!canMutate || p.status === 'approved' || saving.has(p.updateId)"
                    @click="setStatus(p, 'approved')"
                  >Approve</button>
                  <button
                    class="btn-action"
                    :disabled="!canMutate || p.status === 'ignored' || saving.has(p.updateId)"
                    @click="setStatus(p, 'ignored')"
                  >Ignore</button>
                  <button
                    v-if="p.status !== 'pending'"
                    class="btn-action"
                    :disabled="!canMutate || saving.has(p.updateId)"
                    @click="setStatus(p, 'pending')"
                  >Reset</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, type FleetPatch } from '../api';
import { hasRole } from '../auth';

const allPatches   = ref<FleetPatch[]>([]);
const needsRescan  = ref(0);
const loading      = ref(true);
const saving       = ref(new Set<string>());
const statusFilter = ref<'pending' | 'approved' | 'ignored' | 'all'>('pending');

const canMutate = computed(() => hasRole('technician'));

async function load() {
  loading.value = true;
  try {
    const res = await api.patches.list();
    allPatches.value = res.patches;
    needsRescan.value = res.needsRescan;
  } catch {
    allPatches.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const total = computed(() => allPatches.value.length);
const filteredRows = computed(() =>
  statusFilter.value === 'all' ? allPatches.value : allPatches.value.filter(p => p.status === statusFilter.value),
);

async function setStatus(p: FleetPatch, status: 'approved' | 'ignored' | 'pending') {
  if (!canMutate.value) return;
  saving.value = new Set(saving.value).add(p.updateId);
  try {
    await api.patches.setStatus(p.updateId, {
      status, title: p.title, kb_article_ids: p.kbArticleIds, severity: p.severity,
    });
    p.status = status;
  } catch {
    // leave prior status displayed; a refresh will show the real state
  } finally {
    const s = new Set(saving.value);
    s.delete(p.updateId);
    saving.value = s;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusClass(status: FleetPatch['status']): string {
  if (status === 'approved') return 'status-resolved';
  if (status === 'ignored')  return 'status-ignored';
  return 'status-open';
}

function severityBadge(severity: string): string {
  if (severity === 'Critical')  return 'pri-badge pri-critical';
  if (severity === 'Important') return 'pri-badge pri-high';
  if (severity === 'Moderate')  return 'pri-badge pri-moderate';
  return 'pri-badge pri-low';
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
  background: var(--color-danger); color: #fff; font-size: 11px; font-weight: 700;
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
.al-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;
  border: 1px solid var(--color-border); background: var(--color-surface-raised); color: var(--color-text-subtle);
  cursor: pointer; transition: background .1s, border-color .1s, color .1s;
}
.al-pill:hover { background: var(--color-border); color: var(--color-text-primary); }
.al-pill-active { background: rgba(78,126,247,.16); border-color: rgba(78,126,247,.4); color: var(--color-primary); }
.al-rescan-note { font-size: 11px; color: var(--color-warning); margin-left: auto; }

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
.th-message  { min-width: 240px; }
.th-priority { width: 100px; }

.al-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--color-border);
  vertical-align: middle; color: var(--color-text-primary);
}
.al-table tr:last-child td { border-bottom: none; }
.al-table tr:hover td { background: var(--color-surface-raised); }

.td-message  { max-width: 360px; }
.td-category { white-space: nowrap; color: var(--color-text-subtle); }
.mono { font-family: var(--mono); white-space: nowrap; }

.pri-badge {
  display: inline-block; padding: 3px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.pri-critical { background: var(--color-danger);   color: #fff; }
.pri-high     { background: #e07830;      color: #fff; }
.pri-moderate { background: var(--color-warning); color: #1a1200; }
.pri-low      { background: var(--color-text-muted); color: var(--color-surface); }

.status-pill {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.status-open     { background: rgba(232,86,106,.12); color: var(--color-danger); }
.status-resolved { background: rgba(88,166,255,.12); color: var(--color-primary); }
.status-ignored  { color: var(--color-text-subtle); }

.row-actions { display: flex; gap: 6px; }
.btn-action {
  padding: 4px 10px; font-size: 11px; font-weight: 500; border-radius: var(--r-btn);
  border: 1px solid var(--color-border); background: var(--color-surface-raised); color: var(--color-text-primary);
  cursor: pointer; transition: background .1s, border-color .1s;
  white-space: nowrap;
}
.btn-action:hover:not(:disabled) { background: var(--color-border); border-color: var(--color-border-strong); }
.btn-action:disabled { opacity: .4; cursor: default; }
</style>
