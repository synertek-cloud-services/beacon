<template>
  <div class="dash-page">
    <div class="dash-head">
      <div><h1>{{ dashboard?.name ?? 'Dashboard' }}</h1><p v-if="companyId" class="dash-context">Showing the selected company</p></div>
      <div class="dash-actions">
        <button v-if="hasRole('admin')" class="btn btn-ghost btn-sm" @click="showSettings = true">Manage</button>
        <button v-if="hasRole('admin')" class="btn btn-primary btn-sm" @click="editing = !editing">{{ editing ? 'Done editing' : 'Edit layout' }}</button>
      </div>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-else-if="!dashboard" class="dash-loading">Loading dashboard…</div>

    <template v-else>
      <GridStack :key="dashboard.id" ref="gridRef" class="dash-grid" :options="gridOptions" :components="{ DashWidget }" @change="onGridChange" />
      <button v-if="editing" class="add-widget" @click="showWidgetPicker = true">+ Add widget</button>
    </template>

    <Teleport to="body"><div v-if="showWidgetPicker" class="modal-backdrop" @click.self="showWidgetPicker = false"><div class="modal dash-modal"><div class="modal-header"><span class="modal-title">Add widget</span><button class="btn-icon" @click="showWidgetPicker = false">×</button></div><div class="modal-body widget-picker"><button v-for="type in availableWidgets" :key="type" @click="addWidget(type)"><strong>{{ widgetLabels[type] }}</strong><span>{{ widgetDescriptions[type] }}</span></button></div></div></div></Teleport>
    <Teleport to="body"><div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false"><div class="modal dash-modal"><div class="modal-header"><span class="modal-title">Manage dashboard</span><button class="btn-icon" @click="showSettings = false">×</button></div><div class="modal-body"><label class="field-label">Name<input v-model="settingsName" class="form-input" /></label><label class="field-label">Sites <select v-model="settingsSiteIds" multiple class="form-input site-select"><option v-for="company in companies" :key="company.id" :value="company.id">{{ company.name }}</option></select><span class="field-hint">No selections means all sites.</span></label><label class="home-check"><input v-model="settingsHome" type="checkbox" /> Make this the home dashboard</label></div><div class="modal-footer"><button class="btn btn-danger btn-sm" :disabled="dashboards.length <= 1" @click="deleteDashboard">Delete</button><span class="modal-spacer"/><button class="btn btn-ghost btn-sm" @click="createDashboard('blank')">New blank</button><button class="btn btn-ghost btn-sm" @click="createDashboard('default')">New default</button><button class="btn btn-ghost btn-sm" @click="cloneDashboard">Clone</button><button class="btn btn-primary btn-sm" @click="saveSettings">Save</button></div></div></div></Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GridStack, type GridStackOptions, type GridStackWidget } from 'gridstack/dist/vue';
import type { GridStack as GridStackCore } from 'gridstack';
import { api, type DashboardData, type DashboardDetail, type DashboardWidgetType, type Company } from '../api';
import { hasRole } from '../auth';
import DashWidget from '../components/DashWidget.vue';

const route = useRoute(), router = useRouter();
const dashboard = ref<DashboardDetail | null>(null), dashboards = ref<DashboardDetail[]>([]), data = ref<DashboardData | null>(null), companies = ref<Company[]>([]), error = ref('');
const editing = ref(false), showWidgetPicker = ref(false), showSettings = ref(false);
const settingsName = ref(''), settingsSiteIds = ref<string[]>([]), settingsHome = ref(false);
const companyId = computed(() => typeof route.query.company === 'string' ? route.query.company : undefined);
const gridRef = ref<InstanceType<typeof GridStack> | null>(null);
// gridstack-vue's shipped .d.ts doesn't reflect its own runtime
// expose({ getGrid }) (confirmed present by reading dist/vue/gridstack.js
// directly) -- a real gap in the library's types, not a guess. Narrow cast
// only at this one call site rather than loosening gridRef's own type.
function rawGrid(): GridStackCore | null {
  return (gridRef.value as unknown as { getGrid(): GridStackCore | null } | null)?.getGrid() ?? null;
}

// Shared state for every DashWidget instance -- provided once here rather
// than passed as gridstack node props, since gridstack only re-reads node
// props through its own add/update lifecycle, not on every Vue reactivity
// tick. `data` refreshes on a 30s timer completely independently of any
// widget layout change, and `editing` toggles independently too -- both
// need to just flow through Vue's normal reactivity, unaffected by
// whichever gridstack mechanism is or isn't involved.
provide('dashboardData', data);
provide('dashboardEditing', editing);
provide('dashboardId', computed(() => dashboard.value?.id));
// Same reason onGridChange updates dashboard.value.widgets locally on every
// drag/resize -- gridstack's updateOptions() calls grid.load(children) on
// every options change (e.g. the Edit layout/Done editing toggle), which
// would silently re-add a widget that was removed from the server but not
// from this local array.
provide('dashboardRemoveLocalWidget', (id: string) => {
  if (!dashboard.value) return;
  dashboard.value.widgets = dashboard.value.widgets.filter(w => w.id !== id);
});

const widgetLabels: Record<DashboardWidgetType, string> = { device_summary: 'Device summary', online_offline: 'Online / Offline', os_distribution: 'Operating systems', class_distribution: 'Device classes', antivirus_status: 'Antivirus status', offline_by_type: 'Offline devices by type', alerts_by_priority: 'Alerts by priority', recent_alerts: 'Recent alerts', patches_by_severity: 'Pending patches' };
const widgetDescriptions: Record<DashboardWidgetType, string> = { device_summary: 'Key device and alert counts', online_offline: 'Approved device availability', os_distribution: 'Device distribution by OS', class_distribution: 'Device distribution by class', antivirus_status: 'Current antivirus reporting state', offline_by_type: 'Alerting offline devices by class', alerts_by_priority: 'Open alerts by priority', recent_alerts: 'Latest alert activity', patches_by_severity: 'Distinct pending Windows Updates by severity' };
const availableWidgets = Object.keys(widgetLabels) as DashboardWidgetType[];

// Read once at grid init (and on :key-forced remount when switching
// dashboards) -- GridStack's own updateOptions() deliberately never
// re-reads `children` on a reactive options change (confirmed against the
// library source), so runtime add/remove goes through gridRef's imperative
// addWidget()/removeWidget() instead, never through this computed re-firing.
// staticGrid IS re-read reactively by updateOptions, so the Edit
// layout/Done editing toggle works through this computed with no extra code.
const gridOptions = computed<GridStackOptions>(() => ({
  column: 12,
  // Not a straight port of the old CSS Grid's 8px grid-auto-rows: gridstack
  // sizes an item as h * cellHeight directly, with no equivalent of CSS
  // Grid's row-gap being included inside a spanned item's own height.
  // Exact pixel parity between device_summary's centered top/bottom padding
  // and its own 14px left/right padding is not safely achievable: it would
  // require zero slack above the stat row's natural height, i.e. sizing the
  // widget exactly to its content with no buffer -- any slack above zero
  // gets halved and added on TOP of the existing 14px, not substituted for
  // it. h:8 here is the closest fit with real (not zero) headroom against
  // clipping if content ever renders slightly larger (different fonts,
  // browser, zoom) -- see device_summary's h in TEMPLATES below.
  cellHeight: 20,
  // 7, not 14 -- gridstack gives each item its own inset on every side, so
  // two adjacent items combine to 2x this value (14+14=28px). The old CSS
  // Grid system's row-gap/column-gap of 14px was a single gap applied once
  // between tracks, not doubled -- 7 here reproduces that same real 14px
  // combined gap instead of accidentally doubling it.
  margin: 7,
  float: false,
  staticGrid: !editing.value,
  resizable: { handles: 'se' },
  children: (dashboard.value?.widgets ?? []).map(w => ({
    id: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
    minW: 2, minH: 4, maxH: 24,
    component: 'DashWidget',
    props: { type: w.type, title: w.title },
  })),
}));

function onGridChange(_e: Event, nodes: Array<{ id?: string; x?: number; y?: number; w?: number; h?: number }>) {
  if (!dashboard.value) return;
  for (const node of nodes) {
    if (!node.id || node.x == null || node.y == null || node.w == null || node.h == null) continue;
    // Update the local copy immediately, not just the server -- gridstack's
    // own updateOptions() calls grid.load(children) on every options change
    // (confirmed by reading its source; an earlier assumption that it never
    // re-reads children was wrong), which happens on the very next Edit
    // layout/Done editing toggle. Without this, that reconciliation used
    // stale pre-drag positions and visibly snapped the widget back until
    // the next 30s poll happened to refresh dashboard.value with correct
    // data -- a real, reproduced bug, not a guess.
    const local = dashboard.value.widgets.find(w => w.id === node.id);
    if (local) { local.x = node.x; local.y = node.y; local.w = node.w; local.h = node.h; }
    api.dashboards.widgets.update(dashboard.value.id, node.id, { layout: { x: node.x, y: node.y, w: node.w, h: node.h } }).catch(load);
  }
}

async function addWidget(type: DashboardWidgetType) {
  if (!dashboard.value) return;
  showWidgetPicker.value = false;
  try {
    const created = await api.dashboards.widgets.create(dashboard.value.id, { type });
    dashboard.value.widgets.push(created);
    // Same shipped-types gap as rawGrid()/getGrid() -- the core GridStack
    // class's own addWidget(w: GridStackWidget) type doesn't know about the
    // Vue wrapper's component/props extension fields, even though the
    // runtime (same registerSyntheticItemId path confirmed used by initial
    // children) handles them identically either way.
    rawGrid()?.addWidget({
      id: created.id, x: created.x, y: created.y, w: created.w, h: created.h,
      minW: 2, minH: 4, maxH: 24,
      component: 'DashWidget',
      props: { type: created.type, title: created.title },
    } as GridStackWidget);
  } catch (e: any) { error.value = e.message; }
}

function openSettings() { if (!dashboard.value) return; settingsName.value = dashboard.value.name; settingsSiteIds.value = [...dashboard.value.siteIds]; settingsHome.value = dashboard.value.isHome; showSettings.value = true; }
watch(showSettings, shown => { if (shown) openSettings(); });
async function saveSettings() { if (!dashboard.value) return; const updated = await api.dashboards.update(dashboard.value.id, { name: settingsName.value, siteIds: settingsSiteIds.value, isHome: settingsHome.value }); dashboard.value = updated; showSettings.value = false; await loadList(); window.dispatchEvent(new Event('beacon:dashboards-changed')); }
async function cloneDashboard() { if (!dashboard.value) return; const clone = await api.dashboards.clone(dashboard.value.id); showSettings.value = false; window.dispatchEvent(new Event('beacon:dashboards-changed')); await router.push(`/dashboards/${clone.id}`); }
async function createDashboard(template: 'default' | 'blank') { const name = prompt(`Name this ${template === 'default' ? 'Default' : 'Blank'} dashboard`, template === 'default' ? 'New Dashboard' : 'Blank Dashboard'); if (!name?.trim()) return; const created = await api.dashboards.create({ name: name.trim(), template }); showSettings.value = false; window.dispatchEvent(new Event('beacon:dashboards-changed')); await router.push(`/dashboards/${created.id}`); }
async function deleteDashboard() { if (!dashboard.value || dashboards.value.length <= 1 || !confirm(`Delete ${dashboard.value.name}?`)) return; await api.dashboards.delete(dashboard.value.id); const next = dashboards.value.find(item => item.id !== dashboard.value?.id); showSettings.value = false; window.dispatchEvent(new Event('beacon:dashboards-changed')); if (next) await router.push(`/dashboards/${next.id}`); }
async function loadList() { dashboards.value = await api.dashboards.list() as DashboardDetail[]; }
async function load() { const id = route.params.id as string; if (!id) return; try { const [detail, snapshot] = await Promise.all([api.dashboards.get(id), api.dashboards.data(id, companyId.value)]); dashboard.value = detail; data.value = snapshot; error.value = ''; } catch (e: any) { error.value = e.message; } }
let timer: ReturnType<typeof setInterval>;
onMounted(async () => { await Promise.all([loadList(), api.companies.list().then(value => companies.value = value)]); await load(); timer = setInterval(load, 30_000); }); onUnmounted(() => clearInterval(timer)); watch(() => [route.params.id, companyId.value], load);
</script>

<style scoped>
/* Every grid item already carries its own 7px top inset (gridstack's own
   margin option, applied on all 4 sides of every item independently --
   confirmed by inspecting the live --gs-item-margin-* values, not assumed).
   So the *first* widget's visible top gap is already this header's
   margin-bottom PLUS that built-in 7px inset -- setting margin-bottom to
   7px (not 14px) is what makes the total match the real between-widget gap
   (7+7=14px there too), not a mismatched double-count of the same inset. */
/* margin: 0 7px matches gridstack's own per-item margin (applied on ALL 4
   sides of every grid item, not just top/bottom -- confirmed via
   --gs-item-margin-left/right), which insets each widget's visible card 7px
   in from the invisible outer grid cell. Without this, the header/button
   align to that outer (invisible) edge instead of the actual visible card
   edges the eye tracks -- confirmed misaligned by exactly 7px on both sides
   before this fix. */
.dash-head { display:flex; justify-content:space-between; align-items:flex-start; margin:0 7px 7px; gap:16px; } h1 { margin:0; font-size:20px; }.dash-context { margin:5px 0 0; color:var(--color-text-muted); font-size:12px; }.dash-actions { display:flex; gap:8px; }.dash-loading { color:var(--color-text-muted); font-size:13px; padding:32px; text-align:center; }.dash-grid { display:block; }
/* gridstack's default placeholder (rgba(0,0,0,.1)) is nearly invisible
   against this app's already-dark background -- swap for the same
   dashed-primary-color language ".add-widget" already uses elsewhere on
   this page, so "this is where it'll land" reads clearly while dragging. */
.dash-grid :deep(.grid-stack-placeholder > .placeholder-content) { background-color:color-mix(in srgb, var(--color-primary) 15%, transparent); border:2px dashed var(--color-primary); border-radius:8px; box-sizing:border-box; }/* Same 7px horizontal inset as .dash-head above, for the same reason --
   width:100% would otherwise extend to the invisible outer grid boundary,
   not the visible cards' actual left/right edges. */
.add-widget { display:block; width:calc(100% - 14px); margin:14px 7px 0; min-height:56px; color:var(--color-primary); border:1px dashed var(--color-primary); border-radius:8px; background:transparent; cursor:pointer; font-size:13px; }.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }.modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.4); display: flex; flex-direction: column; max-height: 90vh; }.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--color-border); }.modal-title { font-size: 15px; font-weight: 600; }.modal-body { padding: 20px; overflow-y: auto; }.btn-icon { background: none; border: none; cursor: pointer; color: var(--color-text-muted); padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }.btn-icon:hover { background: var(--color-surface-raised); color: var(--color-text-primary); }.dash-modal { width:min(560px,calc(100vw - 32px)); }.widget-picker { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }.widget-picker button { text-align:left; padding:12px; border:1px solid var(--color-border); background:var(--color-surface-raised); color:var(--color-text-primary); border-radius:6px; cursor:pointer; }.widget-picker button:hover { border-color:var(--color-primary); }.widget-picker span { display:block; margin-top:4px; color:var(--color-text-muted); font-size:11px; }.field-label { display:block; font-size:12px; color:var(--color-text-muted); margin-bottom:16px; }.form-input { display:block; width:100%; box-sizing:border-box; margin-top:6px; }.site-select { min-height:120px; }.field-hint { display:block; margin-top:5px; font-size:11px; }.home-check { font-size:12px; }.modal-footer { display:flex; align-items:center; gap:8px; padding:16px 20px; border-top:1px solid var(--color-border); }.modal-spacer { flex:1; }
@media (max-width:760px) { .widget-picker { grid-template-columns:1fr; } }
</style>
