<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Stat cards -->
    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ stats.total }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Applications</span>
        <span class="stat-value">{{ stats.applications }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Scripts</span>
        <span class="stat-value">{{ stats.scripts }}</span>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-head">
        <div class="tabs" style="border:none;margin:0">
          <button class="tab" :class="{ active: activeTab === 'library' }" @click="activeTab = 'library'">My Library</button>
          <button class="tab" :class="{ active: activeTab === 'store' }" @click="activeTab = 'store'; loadStore()">Browse Store</button>
        </div>
        <template v-if="activeTab === 'library'">
          <div style="display:flex;align-items:center;gap:10px">
            <input
              v-model="search"
              class="search-input"
              placeholder="Search components…"
            />
            <select v-model="filterCategory" class="filter-select">
              <option value="">All groups</option>
              <option v-for="cat in CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="selectedCount === 0"
            @click="openCreateJob"
          >Create a Job{{ selectedCount ? ` (${selectedCount})` : '' }}</button>
          <button class="btn btn-primary btn-sm" @click="router.push('/components/new')">+ New Component</button>
        </template>
      </div>

      <!-- My Library tab -->
      <template v-if="activeTab === 'library'">
        <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

        <div v-else-if="visible.length === 0" class="empty">
          <div class="empty-title">{{ search || filterCategory ? 'No matching components' : 'No components yet' }}</div>
          <p class="empty-sub">Build your library by creating reusable PowerShell, Bash, or Shell scripts, or browse the store for a starting point.</p>
        </div>

        <table v-else>
          <thead>
            <tr>
              <th class="th-check"><input type="checkbox" :checked="allSelected" @change="toggleAll" /></th>
              <th>Name</th>
              <th>Group</th>
              <th>Kind</th>
              <th>Sites</th>
              <th>Shell</th>
              <th>Timeout</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="comp in visible" :key="comp.id">
              <td class="th-check" @click.stop>
                <input type="checkbox" :checked="!!selected[comp.id]" @change="toggleSelect(comp.id)" />
              </td>
              <td>
                <div class="comp-name">{{ comp.name }}</div>
                <div v-if="comp.description" class="text-xs text-muted-2" style="margin-top:2px">{{ comp.description }}</div>
              </td>
              <td>
                <span v-if="comp.category" :class="['cat-badge', `cat-${comp.category.toLowerCase()}`]">{{ comp.category }}</span>
                <span v-else class="text-muted-2 text-xs">—</span>
              </td>
              <td><span :class="['kind-badge', `kind-${comp.type}`]">{{ kindLabel(comp.type) }}</span></td>
              <td>
                <span v-if="comp.scope === 'company'" class="scope-badge scope-company">{{ comp.companyName ?? 'Site' }}</span>
                <span v-else class="scope-badge scope-global">All Sites</span>
              </td>
              <td class="mono text-sm">{{ shellLabel(comp.shell) }}</td>
              <td class="text-sm text-muted-2">{{ comp.timeoutSeconds }}s</td>
              <td class="text-sm text-muted-2">{{ relDate(comp.updatedAt) }}</td>
              <td>
                <div class="row-actions" v-if="comp.origin !== 'store'">
                  <button class="btn btn-ghost btn-sm" @click="router.push('/components/' + comp.id)">Edit</button>
                  <button class="btn btn-ghost btn-sm btn-danger-ghost" @click="confirmDelete(comp)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- Browse Store tab -->
      <template v-else>
        <div v-if="storeLoading" class="empty"><p class="empty-sub">Loading…</p></div>
        <div v-else-if="storeComponents.length === 0" class="empty">
          <div class="empty-title">Store is empty</div>
          <p class="empty-sub">No built-in components are available.</p>
        </div>
        <table v-else>
          <thead>
            <tr>
              <th>Name</th>
              <th>Group</th>
              <th>Kind</th>
              <th>Shell</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="comp in storeComponents" :key="comp.id">
              <td>
                <div class="comp-name">{{ comp.name }}</div>
                <div v-if="comp.description" class="text-xs text-muted-2" style="margin-top:2px">{{ comp.description }}</div>
              </td>
              <td>
                <span v-if="comp.category" :class="['cat-badge', `cat-${comp.category.toLowerCase()}`]">{{ comp.category }}</span>
                <span v-else class="text-muted-2 text-xs">—</span>
              </td>
              <td><span :class="['kind-badge', `kind-${comp.type}`]">{{ kindLabel(comp.type) }}</span></td>
              <td class="mono text-sm">{{ shellLabel(comp.shell) }}</td>
              <td>
                <button class="btn btn-ghost btn-sm" :disabled="cloningId === comp.id" @click="cloneToLibrary(comp)">
                  {{ cloningId === comp.id ? 'Adding…' : 'Add to My Library' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <CreateJobModal
      v-if="jobModalOpen"
      :initial-components="jobModalComponents"
      @created="onJobCreated"
      @close="jobModalOpen = false"
    />

    <!-- Delete confirmation -->
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-head">
          <div class="modal-title">Delete Component</div>
        </div>
        <div class="modal-body">
          <p class="text-sm" style="color:var(--text)">
            Delete <strong>{{ deleteTarget.name }}</strong>? This cannot be undone. Existing job records that used this component will retain their script output.
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteTarget = null">Cancel</button>
          <button class="btn btn-danger" :disabled="deleteBusy" @click="doDelete">
            {{ deleteBusy ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Component, type Job } from '../api';
import CreateJobModal from '../components/CreateJobModal.vue';

const router = useRouter();

const CATEGORIES = ['Maintenance', 'Diagnostic', 'Deployment', 'Monitoring', 'Security', 'Custom'] as const;

const activeTab = ref<'library' | 'store'>('library');

const components    = ref<Component[]>([]);
const loading       = ref(true);
const error         = ref('');
const search        = ref('');
const filterCategory = ref('');

const storeComponents = ref<Component[]>([]);
const storeLoading    = ref(false);
const storeLoaded     = ref(false);
const cloningId       = ref<string | null>(null);

// ── Bulk select → Create a Job ───────────────────────────────────
const selected      = reactive<Record<string, boolean>>({});
const jobModalOpen  = ref(false);
const jobModalComponents = ref<Component[]>([]);

const selectedCount = computed(() => Object.keys(selected).length);
const allSelected   = computed(() =>
  visible.value.length > 0 && visible.value.every(c => selected[c.id])
);

function toggleAll() {
  if (allSelected.value) visible.value.forEach(c => delete selected[c.id]);
  else                   visible.value.forEach(c => { selected[c.id] = true; });
}
function toggleSelect(id: string) {
  if (selected[id]) delete selected[id];
  else selected[id] = true;
}

function openCreateJob() {
  jobModalComponents.value = visible.value.filter(c => selected[c.id]);
  jobModalOpen.value = true;
}

function onJobCreated(_job: Job) {
  jobModalOpen.value = false;
  Object.keys(selected).forEach(id => delete selected[id]);
  router.push('/jobs');
}

const deleteTarget = ref<Component | null>(null);
const deleteBusy   = ref(false);

// ── Stat cards (unaffected by search/filter — reflect the whole library) ──
const stats = computed(() => {
  const own = components.value.filter(c => c.origin !== 'store');
  return {
    total:        own.length,
    applications: own.filter(c => c.type === 'application').length,
    scripts:      own.filter(c => c.type === 'script').length,
  };
});

const visible = computed(() => {
  let list = components.value.filter(c => c.origin !== 'store');
  if (filterCategory.value) list = list.filter(c => c.category === filterCategory.value);
  if (search.value.trim()) {
    const q = search.value.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    );
  }
  return list;
});

async function load() {
  loading.value = components.value.length === 0;
  error.value = '';
  try {
    components.value = await api.components.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadStore() {
  if (storeLoaded.value) return;
  storeLoading.value = true;
  try {
    storeComponents.value = await api.components.store.list();
    storeLoaded.value = true;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    storeLoading.value = false;
  }
}

async function cloneToLibrary(comp: Component) {
  cloningId.value = comp.id;
  try {
    const created = await api.components.clone(comp.id);
    components.value = [created, ...components.value];
    router.push('/components/' + created.id);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    cloningId.value = null;
  }
}

function confirmDelete(comp: Component) {
  deleteTarget.value = comp;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleteBusy.value = true;
  try {
    await api.components.delete(deleteTarget.value.id);
    components.value = components.value.filter(c => c.id !== deleteTarget.value!.id);
    deleteTarget.value = null;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    deleteBusy.value = false;
  }
}

function shellLabel(shell: string): string {
  return { auto: 'Auto', powershell: 'PowerShell', bash: 'Bash', sh: 'sh', cmd: 'CMD' }[shell] ?? shell;
}

function kindLabel(type: 'script' | 'application'): string {
  return type === 'application' ? 'Application' : 'Script';
}

function relDate(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

onMounted(load);
</script>

<style scoped>
/* ── Stat cards ── */
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
}
.stat-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

.tabs { display: flex; }
.tab { padding: 0 16px; height: 44px; cursor: pointer; color: var(--muted); border: none; border-bottom: 2px solid transparent; background: none; font-size: 12px; font-weight: 500; font-family: var(--font); transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.search-input {
  height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font); width: 220px;
}
.search-input:focus { outline: none; border-color: var(--accent); }
.filter-select {
  height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--surface); color: var(--text); font-size: 12px; font-family: var(--font);
}

.th-check { width: 36px; }

.comp-name { font-size: 13px; font-weight: 500; color: var(--text); }

.cat-badge {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 3px;
}
.cat-maintenance { background: rgba(78,126,247,.12); color: var(--accent); }
.cat-diagnostic  { background: rgba(45,207,160,.12); color: var(--teal); }
.cat-deployment  { background: rgba(240,168,64,.12); color: var(--amber); }
.cat-monitoring  { background: rgba(156,106,247,.12); color: #9c6af7; }
.cat-security    { background: rgba(232,86,106,.12);  color: var(--red); }
.cat-custom      { background: var(--surface-2);       color: var(--muted); }

/* ── Kind badge — deliberately its own class, distinct from .cat-badge
     (that one now means "Group tag") to avoid recreating the exact
     Category/Group naming confusion this page was reworked to fix ── */
.kind-badge {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 3px;
}
.kind-script      { background: var(--surface-2); color: var(--muted); }
.kind-application { background: rgba(78,126,247,.12); color: var(--accent); }

/* ── Scope badge (Sites) ── */
.scope-badge {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 3px; text-transform: none;
}
.scope-global  { background: var(--surface-2); color: var(--muted); }
.scope-company { background: rgba(45,207,160,.12); color: var(--teal); }

.row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.btn-danger-ghost { color: var(--red) !important; }
.btn-danger-ghost:hover { background: rgba(232,86,106,.08) !important; }
</style>
