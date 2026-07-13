<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="section-card">
      <div class="section-card-head">
        <div style="display:flex;align-items:center;gap:10px">
          <input
            v-model="search"
            class="search-input"
            placeholder="Search components…"
          />
          <select v-model="filterCategory" class="filter-select">
            <option value="">All categories</option>
            <option v-for="cat in CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
          </select>
        </div>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="selectedCount === 0"
          @click="openCreateJob"
        >Create a Job{{ selectedCount ? ` (${selectedCount})` : '' }}</button>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ New Component</button>
      </div>

      <div v-if="loading" class="empty"><p class="empty-sub">Loading…</p></div>

      <div v-else-if="visible.length === 0" class="empty">
        <div class="empty-title">{{ search || filterCategory ? 'No matching components' : 'No components yet' }}</div>
        <p class="empty-sub">Build your library by creating reusable PowerShell, Bash, or Shell scripts.</p>
      </div>

      <table v-else>
        <thead>
          <tr>
            <th class="th-check"><input type="checkbox" :checked="allSelected" @change="toggleAll" /></th>
            <th>Name</th>
            <th>Category</th>
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
            <td class="mono text-sm">{{ shellLabel(comp.shell) }}</td>
            <td class="text-sm text-muted-2">{{ comp.timeoutSeconds }}s</td>
            <td class="text-sm text-muted-2">{{ relDate(comp.updatedAt) }}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-ghost btn-sm" @click="openEdit(comp)">Edit</button>
                <button class="btn btn-ghost btn-sm btn-danger-ghost" @click="confirmDelete(comp)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <CreateJobModal
      v-if="jobModalOpen"
      :initial-components="jobModalComponents"
      @created="onJobCreated"
      @close="jobModalOpen = false"
    />

    <!-- Create / Edit modal -->
    <div v-if="modal" class="modal-backdrop" @click.self="modal = null">
      <div class="modal modal-xl">
        <div class="modal-head">
          <div class="modal-title">{{ modal.id ? 'Edit Component' : 'New Component' }}</div>
        </div>
        <div class="modal-body comp-modal-body">

          <!-- Left: metadata -->
          <div class="comp-meta">
            <div class="field">
              <label>Name <span class="required">*</span></label>
              <input v-model="modal.name" type="text" placeholder="e.g. Clear Temp Files" />
            </div>
            <div class="field" style="margin-top:10px">
              <label>Description</label>
              <input v-model="modal.description" type="text" placeholder="What does this component do?" />
            </div>
            <div class="field" style="margin-top:10px">
              <label>Category</label>
              <select v-model="modal.category">
                <option value="">None</option>
                <option v-for="cat in CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
              </select>
            </div>
            <div class="field" style="margin-top:10px">
              <label>Shell</label>
              <select v-model="modal.shell">
                <option value="auto">Auto — PowerShell on Windows, Bash elsewhere</option>
                <option value="powershell">PowerShell (Windows)</option>
                <option value="bash">Bash (Linux / macOS)</option>
                <option value="sh">sh (POSIX)</option>
                <option value="cmd">Command Prompt (Windows)</option>
              </select>
            </div>
            <div class="field" style="margin-top:10px">
              <label>Timeout (seconds)</label>
              <input v-model.number="modal.timeoutSeconds" type="number" min="5" max="3600" style="max-width:120px" />
            </div>
          </div>

          <!-- Right: script editor -->
          <div class="comp-script">
            <label class="script-label">Script <span class="required">*</span></label>
            <textarea
              v-model="modal.script"
              class="code-area code-area-full"
              placeholder="# Enter your script here…
# Use $env:BEACONVAR or environment variables as needed"
              spellcheck="false"
            ></textarea>
          </div>

        </div>
        <div v-if="modalError" class="error-banner" style="margin:0 20px 12px">{{ modalError }}</div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="modal = null">Cancel</button>
          <button class="btn btn-primary" :disabled="modalBusy" @click="saveModal">
            {{ modalBusy ? 'Saving…' : (modal.id ? 'Save Changes' : 'Create Component') }}
          </button>
        </div>
      </div>
    </div>

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

const components    = ref<Component[]>([]);
const loading       = ref(true);
const error         = ref('');
const search        = ref('');
const filterCategory = ref('');

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

interface ModalState {
  id:            string | null;
  name:          string;
  description:   string;
  category:      string;
  shell:         string;
  script:        string;
  timeoutSeconds: number;
}

const modal      = ref<ModalState | null>(null);
const modalError = ref('');
const modalBusy  = ref(false);

const deleteTarget = ref<Component | null>(null);
const deleteBusy   = ref(false);

const visible = computed(() => {
  let list = components.value;
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

function openCreate() {
  modal.value = { id: null, name: '', description: '', category: '', shell: 'auto', script: '', timeoutSeconds: 300 };
  modalError.value = '';
}

function openEdit(comp: Component) {
  modal.value = {
    id: comp.id,
    name: comp.name,
    description: comp.description ?? '',
    category: comp.category ?? '',
    shell: comp.shell,
    script: comp.script,
    timeoutSeconds: comp.timeoutSeconds,
  };
  modalError.value = '';
}

async function saveModal() {
  if (!modal.value) return;
  if (!modal.value.name.trim())   { modalError.value = 'Name is required';   return; }
  if (!modal.value.script.trim()) { modalError.value = 'Script is required'; return; }

  modalBusy.value  = true;
  modalError.value = '';
  const m = modal.value;

  try {
    if (m.id) {
      await api.components.update(m.id, {
        name:            m.name.trim(),
        description:     m.description.trim() || null,
        category:        m.category || null,
        shell:           m.shell,
        script:          m.script,
        timeout_seconds: m.timeoutSeconds,
      });
      const idx = components.value.findIndex(c => c.id === m.id);
      if (idx >= 0) {
        components.value[idx] = { ...components.value[idx],
          name: m.name, description: m.description || null, category: m.category || null,
          shell: m.shell, script: m.script, timeoutSeconds: m.timeoutSeconds,
          updatedAt: Math.floor(Date.now() / 1000),
        };
      }
    } else {
      const created = await api.components.create({
        name:            m.name.trim(),
        description:     m.description.trim() || null,
        category:        m.category || null,
        shell:           m.shell,
        script:          m.script,
        timeout_seconds: m.timeoutSeconds,
      });
      components.value = [created, ...components.value];
    }
    modal.value = null;
  } catch (e: any) {
    modalError.value = e.message;
  } finally {
    modalBusy.value = false;
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

.row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.btn-danger-ghost { color: var(--red) !important; }
.btn-danger-ghost:hover { background: rgba(232,86,106,.08) !important; }

/* ── Component modal layout ── */
.comp-modal-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
  padding-bottom: 0;
}
.comp-meta { display: flex; flex-direction: column; }
.comp-script { display: flex; flex-direction: column; min-height: 0; }
.script-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px;
}
.code-area-full {
  flex: 1;
  min-height: 320px;
  resize: vertical;
}
</style>
