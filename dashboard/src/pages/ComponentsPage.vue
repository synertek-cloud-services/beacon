<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

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
          <button class="btn btn-primary btn-sm" @click="openCreate">+ New Component</button>
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
              <td class="mono text-sm">{{ shellLabel(comp.shell) }}</td>
              <td class="text-sm text-muted-2">{{ comp.timeoutSeconds }}s</td>
              <td class="text-sm text-muted-2">{{ relDate(comp.updatedAt) }}</td>
              <td>
                <div class="row-actions" v-if="comp.origin !== 'store'">
                  <button class="btn btn-ghost btn-sm" @click="openEdit(comp)">Edit</button>
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

    <!-- Create / Edit modal -->
    <div v-if="modal" class="modal-backdrop" @click.self="modal = null">
      <div class="modal modal-xl">
        <div class="modal-head">
          <div class="modal-title">{{ modal.id ? 'Edit Component' : 'New Component' }}</div>
        </div>
        <div class="modal-body comp-modal-body-scroll">

          <div class="comp-modal-body">
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
                <label>Kind</label>
                <select v-model="modal.type">
                  <option value="script">Script</option>
                  <option value="application">Application</option>
                </select>
                <p v-if="modal.type === 'application'" class="field-hint">
                  Applications run identically to Scripts today — file/installer attachments aren't wired up yet.
                </p>
              </div>
              <div class="field" style="margin-top:10px">
                <label>Group</label>
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
# Reference variables as $env:NAME (PowerShell) or $NAME (bash/sh)"
                spellcheck="false"
              ></textarea>
            </div>
          </div>

          <!-- Variables -->
          <div class="comp-subsection">
            <div class="comp-subsection-head">
              <div class="comp-subsection-title">Input Variables</div>
              <button class="btn btn-ghost btn-sm" @click="openVariableForm(null)">+ Add Variable</button>
            </div>

            <div v-if="modal.variables.length === 0" class="comp-subsection-empty">
              No input variables. Add one to prompt users for a value when this component is added to a job.
            </div>
            <div v-else class="var-list">
              <div v-for="v in modal.variables" :key="v.id" class="var-row">
                <div class="var-row-main">
                  <span class="var-name">{{ v.name }}</span>
                  <span class="var-type-badge">{{ v.type }}</span>
                  <span v-if="v.required" class="text-xs text-muted-2">required</span>
                  <span v-else class="text-xs text-muted-2">optional</span>
                </div>
                <div class="text-xs text-muted-2">{{ v.label }}</div>
                <div class="var-row-actions">
                  <button class="btn btn-ghost btn-sm" @click="openVariableForm(v)">Edit</button>
                  <button class="btn btn-ghost btn-sm btn-danger-ghost" @click="removeVariable(v)">Delete</button>
                </div>
              </div>
            </div>

            <!-- Add/Edit variable sub-form -->
            <div v-if="varForm" class="var-form">
              <div class="var-form-grid">
                <div class="field">
                  <label>Name (env var) <span class="required">*</span></label>
                  <input v-model="varForm.name" type="text" placeholder="e.g. BACKUP_PATH" />
                </div>
                <div class="field">
                  <label>Prompt Label <span class="required">*</span></label>
                  <input v-model="varForm.label" type="text" placeholder="e.g. Backup destination path" />
                </div>
                <div class="field">
                  <label>Type</label>
                  <select v-model="varForm.type">
                    <option value="string">String</option>
                    <option value="selection">Selection</option>
                    <option value="boolean">Boolean</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div class="field">
                  <label>Default Value</label>
                  <input v-model="varForm.defaultValue" type="text" placeholder="Optional" />
                </div>
                <div class="field" style="grid-column:1/-1">
                  <label>Description</label>
                  <input v-model="varForm.description" type="text" placeholder="Shown next to the variable during job scheduling" />
                </div>
                <div v-if="varForm.type === 'selection'" class="field" style="grid-column:1/-1">
                  <label>Options</label>
                  <div v-for="(opt, idx) in varForm.options" :key="idx" class="var-option-row">
                    <input v-model="opt.label" type="text" placeholder="Display name" />
                    <input v-model="opt.value" type="text" placeholder="Value" />
                    <button class="btn-icon" @click="varForm.options.splice(idx, 1)" title="Remove">×</button>
                  </div>
                  <button class="btn btn-ghost btn-sm" style="margin-top:6px" @click="varForm.options.push({ label: '', value: '' })">+ Add Option</button>
                </div>
                <div class="field">
                  <label class="checkbox-label"><input type="checkbox" v-model="varForm.required" /> Required</label>
                </div>
              </div>
              <div v-if="varFormError" class="error-banner" style="margin:10px 0 0">{{ varFormError }}</div>
              <div class="var-form-actions">
                <button class="btn btn-ghost btn-sm" @click="varForm = null">Cancel</button>
                <button class="btn btn-primary btn-sm" :disabled="varFormBusy" @click="saveVariableForm">{{ varFormBusy ? 'Saving…' : 'Save Variable' }}</button>
              </div>
            </div>
          </div>

          <!-- Post-conditions -->
          <div class="comp-subsection">
            <div class="comp-subsection-head">
              <div class="comp-subsection-title">Post-conditions</div>
              <button class="btn btn-ghost btn-sm" @click="addPostCondition">+ Add Condition</button>
            </div>
            <p class="text-xs text-muted-2" style="margin:0 0 8px">
              Flag a completed run as "Warning" when its output matches — doesn't change pass/fail.
            </p>
            <div v-if="modal.postConditions.length === 0" class="comp-subsection-empty">
              No post-conditions configured.
            </div>
            <div v-else class="pc-list">
              <div v-for="(pc, idx) in modal.postConditions" :key="pc.id" class="pc-row">
                <select v-model="pc.stream">
                  <option value="stdout">stdout</option>
                  <option value="stderr">stderr</option>
                  <option value="both">both</option>
                </select>
                <select v-model="pc.match_type">
                  <option value="contains">contains</option>
                  <option value="regex">regex</option>
                </select>
                <input v-model="pc.pattern" type="text" placeholder="Pattern to match" class="pc-pattern" />
                <label class="checkbox-label"><input type="checkbox" v-model="pc.enabled" /> Enabled</label>
                <button class="btn-icon" @click="modal.postConditions.splice(idx, 1)" title="Remove">×</button>
              </div>
            </div>
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
import { api, type Component, type ComponentVariable, type ComponentVariableType, type ComponentVariableOption, type PostCondition, type Job } from '../api';
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

// ── Component create/edit modal ──────────────────────────────────

interface ModalState {
  id:            string | null;
  name:          string;
  description:   string;
  category:      string;
  type:          'script' | 'application';
  shell:         string;
  script:        string;
  timeoutSeconds: number;
  postConditions: PostCondition[];
  variables:      ComponentVariable[];
}

const modal      = ref<ModalState | null>(null);
const modalError = ref('');
const modalBusy  = ref(false);

const deleteTarget = ref<Component | null>(null);
const deleteBusy   = ref(false);

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
    activeTab.value = 'library';
    openEdit(created);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    cloningId.value = null;
  }
}

function openCreate() {
  modal.value = {
    id: null, name: '', description: '', category: '', type: 'script', shell: 'auto', script: '',
    timeoutSeconds: 300, postConditions: [], variables: [],
  };
  modalError.value = '';
  varForm.value = null;
}

function openEdit(comp: Component) {
  modal.value = {
    id: comp.id,
    name: comp.name,
    description: comp.description ?? '',
    category: comp.category ?? '',
    type: comp.type,
    shell: comp.shell,
    script: comp.script,
    timeoutSeconds: comp.timeoutSeconds,
    postConditions: comp.postConditions.map(pc => ({ ...pc })),
    variables: comp.variables.map(v => ({ ...v })),
  };
  modalError.value = '';
  varForm.value = null;
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
        type:            m.type,
        shell:           m.shell,
        script:          m.script,
        timeout_seconds: m.timeoutSeconds,
        post_conditions: m.postConditions,
      });
      const idx = components.value.findIndex(c => c.id === m.id);
      if (idx >= 0) {
        components.value[idx] = { ...components.value[idx],
          name: m.name, description: m.description || null, category: m.category || null, type: m.type,
          shell: m.shell, script: m.script, timeoutSeconds: m.timeoutSeconds, postConditions: m.postConditions,
          updatedAt: Math.floor(Date.now() / 1000),
        };
      }
    } else {
      const created = await api.components.create({
        name:            m.name.trim(),
        description:     m.description.trim() || null,
        category:        m.category || null,
        type:            m.type,
        shell:           m.shell,
        script:          m.script,
        timeout_seconds: m.timeoutSeconds,
        post_conditions: m.postConditions,
      });
      // Batch-create any variables added while drafting a brand-new component
      for (const v of m.variables) {
        await api.components.variables.create(created.id, {
          name: v.name, label: v.label, type: v.type,
          options: v.options ?? undefined, default_value: v.defaultValue,
          description: v.description, required: v.required,
        });
      }
      const full = await api.components.get(created.id);
      components.value = [full, ...components.value];
    }
    modal.value = null;
  } catch (e: any) {
    modalError.value = e.message;
  } finally {
    modalBusy.value = false;
  }
}

// ── Variables sub-form ────────────────────────────────────────────

interface VarFormState {
  id:            string | null; // existing variable id, or null when adding
  name:          string;
  label:         string;
  type:          ComponentVariableType;
  options:       ComponentVariableOption[];
  defaultValue:  string;
  description:   string;
  required:      boolean;
}

const varForm      = ref<VarFormState | null>(null);
const varFormError = ref('');
const varFormBusy  = ref(false);

function openVariableForm(existing: ComponentVariable | null) {
  varForm.value = existing
    ? {
        id: existing.id, name: existing.name, label: existing.label, type: existing.type,
        options: existing.options ? existing.options.map(o => ({ ...o })) : [],
        defaultValue: existing.defaultValue ?? '', description: existing.description ?? '',
        required: existing.required,
      }
    : { id: null, name: '', label: '', type: 'string', options: [], defaultValue: '', description: '', required: true };
  varFormError.value = '';
}

async function saveVariableForm() {
  if (!varForm.value || !modal.value) return;
  const f = varForm.value;

  if (!f.name.trim())  { varFormError.value = 'Variable name is required'; return; }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) { varFormError.value = 'Name must be a valid identifier (letters, numbers, underscore)'; return; }
  if (!f.label.trim()) { varFormError.value = 'Prompt label is required'; return; }
  if (f.type === 'selection' && f.options.filter(o => o.label.trim() && o.value.trim()).length === 0) {
    varFormError.value = 'Selection variables need at least one option'; return;
  }

  varFormBusy.value = true;
  varFormError.value = '';
  try {
    const options = f.type === 'selection' ? f.options.filter(o => o.label.trim() && o.value.trim()) : undefined;

    if (modal.value.id) {
      // Existing component — persist immediately
      if (f.id) {
        await api.components.variables.update(modal.value.id, f.id, {
          name: f.name.trim(), label: f.label.trim(), type: f.type, options,
          default_value: f.defaultValue || null, description: f.description || null, required: f.required,
        });
        const idx = modal.value.variables.findIndex(v => v.id === f.id);
        if (idx >= 0) {
          modal.value.variables[idx] = {
            ...modal.value.variables[idx],
            name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
            defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          };
        }
      } else {
        const created = await api.components.variables.create(modal.value.id, {
          name: f.name.trim(), label: f.label.trim(), type: f.type, options,
          default_value: f.defaultValue || null, description: f.description || null, required: f.required,
        });
        modal.value.variables.push(created);
      }
    } else {
      // Brand-new component — hold locally until the component itself is created
      if (f.id) {
        const idx = modal.value.variables.findIndex(v => v.id === f.id);
        if (idx >= 0) {
          modal.value.variables[idx] = {
            ...modal.value.variables[idx],
            name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
            defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          };
        }
      } else {
        modal.value.variables.push({
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          componentId: '',
          name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
          defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          sortOrder: modal.value.variables.length, createdAt: Math.floor(Date.now() / 1000),
        });
      }
    }
    varForm.value = null;
  } catch (e: any) {
    varFormError.value = e.message;
  } finally {
    varFormBusy.value = false;
  }
}

async function removeVariable(v: ComponentVariable) {
  if (!modal.value) return;
  if (modal.value.id && !v.id.startsWith('draft-')) {
    try {
      await api.components.variables.delete(modal.value.id, v.id);
    } catch (e: any) {
      error.value = e.message;
      return;
    }
  }
  modal.value.variables = modal.value.variables.filter(x => x.id !== v.id);
}

// ── Post-conditions (embedded JSON, saved with the component itself) ─────

function addPostCondition() {
  if (!modal.value) return;
  modal.value.postConditions.push({
    id: `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    stream: 'stdout', match_type: 'contains', pattern: '', enabled: true,
  });
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

.row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.btn-danger-ghost { color: var(--red) !important; }
.btn-danger-ghost:hover { background: rgba(232,86,106,.08) !important; }

/* ── Component modal layout ── */
.comp-modal-body-scroll { display: flex; flex-direction: column; gap: 20px; }
.comp-modal-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
}
.comp-meta { display: flex; flex-direction: column; }
.comp-script { display: flex; flex-direction: column; min-height: 0; }
.script-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px;
}
.code-area-full {
  flex: 1;
  min-height: 220px;
  resize: vertical;
}
.field-hint { font-size: 11px; color: var(--muted); margin: 6px 0 0; }
.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); font-weight: 400; }

/* ── Variables / Post-conditions subsections ── */
.comp-subsection { border-top: 1px solid var(--border); padding-top: 16px; }
.comp-subsection-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.comp-subsection-title { font-size: 12px; font-weight: 700; color: var(--text); text-transform: uppercase; letter-spacing: .04em; }
.comp-subsection-empty { font-size: 12px; color: var(--muted); padding: 8px 0; }

.var-list { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.var-row {
  display: flex; align-items: center; gap: 14px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); font-size: 12px;
}
.var-row:last-child { border-bottom: none; }
.var-row-main { display: flex; align-items: center; gap: 8px; min-width: 200px; }
.var-name { font-family: var(--mono); font-size: 12px; color: var(--text); font-weight: 600; }
.var-type-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 1px 6px; border-radius: 3px; background: var(--surface-2); color: var(--muted);
}
.var-row-actions { display: flex; gap: 4px; margin-left: auto; }

.var-form {
  margin-top: 10px; padding: 12px; border: 1px solid var(--border-2); border-radius: 7px;
  background: var(--surface-2);
}
.var-form-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px;
}
.var-option-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.var-option-row input { flex: 1; }
.var-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

.pc-list { display: flex; flex-direction: column; gap: 8px; }
.pc-row { display: flex; align-items: center; gap: 8px; }
.pc-pattern { flex: 1; }

.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-2);
  background: var(--surface-2); color: var(--muted-2); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s;
  flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--border); color: var(--text); }
.btn-icon:disabled { opacity: .3; cursor: not-allowed; }
</style>
