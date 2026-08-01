<template>
  <div class="pf-page">

    <!-- Breadcrumb -->
    <nav class="pf-crumb">
      <RouterLink to="/components" class="pf-crumb-link">Component Library</RouterLink>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      <span class="pf-crumb-current">{{ isNew ? 'Create Component' : 'Edit Component' }}</span>
    </nav>

    <!-- Top bar -->
    <div class="pf-topbar">
      <button class="pf-back" @click="router.push('/components')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="pf-title">{{ isNew ? 'Create Component' : (form.name || 'Edit Component') }}</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-ghost btn-sm" @click="router.push('/components')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : (isNew ? 'Create Component' : 'Save Changes') }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="error-banner" style="margin:0 0 16px">{{ loadError }}</div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">

      <!-- Name -->
      <div class="pf-group">
        <label class="pf-label">Name</label>
        <input v-model="form.name" class="pf-input" placeholder="Enter a name" />
        <span v-if="fieldErr.name" class="pf-err">{{ fieldErr.name }}</span>
      </div>

      <!-- Description -->
      <div class="pf-group">
        <label class="pf-label">Description</label>
        <textarea v-model="form.description" class="pf-input pf-textarea" rows="2" placeholder="What does this component do?" />
      </div>

      <!-- Kind -->
      <div class="pf-group">
        <label class="pf-label">Kind</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: form.type === 'script' }]" @click="form.type = 'script'">Script</button>
          <button :class="['seg-btn', { active: form.type === 'application' }]" @click="form.type = 'application'">Application</button>
        </div>
        <p v-if="form.type === 'application'" class="field-hint">
          Applications run identically to Scripts today — file/installer attachments aren't wired up yet.
        </p>
      </div>

      <!-- Group -->
      <div class="pf-group">
        <label class="pf-label">Group</label>
        <select v-model="form.category" class="pf-input" style="max-width:280px">
          <option value="">None</option>
          <option v-for="cat in CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </div>

      <!-- Platform (OS targeting) -->
      <div class="pf-group">
        <label class="pf-label">Platform</label>
        <select v-model="form.targetOs" class="pf-input" style="max-width:200px" :disabled="isStore">
          <option value="">All Platforms</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
          <option value="darwin">macOS</option>
        </select>
        <p class="field-hint">Jobs skip devices whose OS doesn't match. Leave blank to run on any platform.</p>
      </div>

      <!-- Companies scope -->
      <div class="pf-group">
        <label class="pf-label">Companies</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: form.scope === 'global' }]" @click="form.scope = 'global'">All Companies</button>
          <button :class="['seg-btn', { active: form.scope === 'company' }]" @click="form.scope = 'company'">Selected Companies</button>
        </div>
        <template v-if="form.scope === 'company'">
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-primary btn-sm" @click="companiesFlyoutOpen = true">Add Company</button>
            <button class="btn btn-ghost btn-sm" :disabled="selectedCompanies.length === 0" @click="removeAllCompanies">Remove all</button>
          </div>
          <div class="pf-monitors" style="margin-top:8px">
            <div v-if="selectedCompanies.length === 0" class="pf-mon-empty">
              <p>Select which Companies to add to this Component.</p>
            </div>
            <div v-else v-for="s in selectedCompanies" :key="s.companyId" class="pf-mon-row">
              <span class="pf-mon-desc">{{ s.name }}</span>
              <div class="pf-mon-actions">
                <button class="btn-text danger" @click="removeCompany(s.companyId)">Remove</button>
              </div>
            </div>
          </div>
        </template>
        <span v-if="fieldErr.companies" class="pf-err">{{ fieldErr.companies }}</span>
      </div>

      <!-- Add Company flyout -->
      <Teleport to="body">
        <div v-if="companiesFlyoutOpen" class="sf-overlay" @click.self="companiesFlyoutOpen = false">
          <div class="sf-panel">
            <div class="sf-head">
              <h2 class="sf-title">Companies</h2>
              <button class="btn-icon" @click="companiesFlyoutOpen = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="sf-search">
              <input v-model="companyFlyoutQuery" class="pf-input" placeholder="Search" />
            </div>
            <div class="sf-list">
              <div v-for="t in companyFlyoutMatches" :key="t.id" class="sf-row" :class="{ selected: isCompanySelected(t.id) }">
                <span>{{ t.name }}</span>
                <button v-if="isCompanySelected(t.id)" class="btn btn-primary btn-sm" @click="removeCompany(t.id)">Remove</button>
                <button v-else class="btn btn-ghost btn-sm" @click="addCompany(t)">Add</button>
              </div>
              <div v-if="companyFlyoutMatches.length === 0" class="pf-mon-empty"><p>No matching companies.</p></div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Shell -->
      <div class="pf-group">
        <label class="pf-label">Shell</label>
        <select v-model="form.shell" class="pf-input" style="max-width:380px">
          <option value="auto">Auto — PowerShell on Windows, Bash elsewhere</option>
          <option value="powershell">PowerShell (Windows)</option>
          <option value="bash">Bash (Linux / macOS)</option>
          <option value="sh">sh (POSIX)</option>
          <option value="cmd">Command Prompt (Windows)</option>
        </select>
      </div>

      <!-- Script -->
      <div class="pf-group">
        <label class="pf-label">Script</label>
        <textarea
          v-model="form.script"
          class="pf-input pf-code"
          placeholder="# Enter your script here…
# Reference variables as $env:NAME (PowerShell) or $NAME (bash/sh)"
          spellcheck="false"
        ></textarea>
        <span v-if="fieldErr.script" class="pf-err">{{ fieldErr.script }}</span>
        <p v-if="availableCfKeys.length" class="field-hint">
          Available custom fields (resolved per-device at dispatch time): <span class="mono">{{ availableCfKeys.map(k => `CF_${k}`).join(', ') }}</span>
        </p>
        <p class="field-hint">
          Company Variables/Secrets are also available as <span class="mono">CV_&lt;KEY&gt;</span>, resolved per-target-company at dispatch time — see each company's Variables tab on the Companies page.
        </p>
      </div>

      <!-- Timeout -->
      <div class="pf-group">
        <label class="pf-label">Timeout this script if not completed within (seconds)</label>
        <input v-model.number="form.timeoutSeconds" type="number" min="5" max="3600" class="pf-input" style="max-width:140px" />
      </div>

      <!-- Variables -->
      <div class="pf-group">
        <label class="pf-label">Variables</label>
        <div class="pf-monitors">
          <div v-if="variables.length === 0" class="pf-mon-empty">
            <p>Add variables to prompt users for a value when this component is added to a job.</p>
            <button class="btn btn-primary btn-sm" @click="openVariableForm(null)">Add Variable</button>
          </div>
          <template v-else>
            <div v-for="v in variables" :key="v.id" class="pf-mon-row">
              <span class="var-type-badge">{{ v.type }}</span>
              <span class="pf-mon-desc"><strong>{{ v.name }}</strong> — {{ v.label }}<span v-if="!v.required" class="text-xs text-muted-2"> (optional)</span></span>
              <div class="pf-mon-actions">
                <button class="btn-text" @click="openVariableForm(v)">Edit</button>
                <button class="btn-text danger" @click="removeVariable(v)">Delete</button>
              </div>
            </div>
            <div class="pf-mon-add">
              <button class="btn btn-ghost btn-sm" @click="openVariableForm(null)">+ Add Variable</button>
            </div>
          </template>
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
              <div class="type-required-row">
                <select v-model="varForm.type">
                  <option value="string">String</option>
                  <option value="selection">Selection</option>
                  <option value="boolean">Boolean</option>
                  <option value="date">Date</option>
                </select>
                <label class="checkbox-label"><input type="checkbox" v-model="varForm.required" /> Required</label>
              </div>
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
                <button class="btn-icon" @click="varForm!.options.splice(idx, 1)" title="Remove">×</button>
              </div>
              <button class="btn btn-ghost btn-sm" style="margin-top:6px" @click="varForm.options.push({ label: '', value: '' })">+ Add Option</button>
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
      <div class="pf-group">
        <label class="pf-label">Post-conditions</label>
        <p class="field-hint" style="margin:0 0 8px">Flag a completed run as "Warning" when its output matches — doesn't change pass/fail.</p>
        <div class="pf-monitors">
          <div v-if="postConditions.length === 0" class="pf-mon-empty">
            <p>No post-conditions configured.</p>
            <button class="btn btn-primary btn-sm" @click="addPostCondition">Add Post-condition</button>
          </div>
          <template v-else>
            <div v-for="(pc, idx) in postConditions" :key="pc.id" class="pc-row">
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
              <button class="btn-icon" @click="postConditions.splice(idx, 1)" title="Remove">×</button>
            </div>
            <div class="pf-mon-add">
              <button class="btn btn-ghost btn-sm" @click="addPostCondition">+ Add Condition</button>
            </div>
          </template>
        </div>
      </div>

      <div v-if="saveError" class="error-banner">{{ saveError }}</div>

    </div><!-- /pf-body -->
  </div><!-- /pf-page -->
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, type Component, type ComponentCompany, type ComponentVariable, type ComponentVariableType, type ComponentVariableOption, type PostCondition, type Company, type CustomField } from '../api';

const router = useRouter();
const route  = useRoute();

const CATEGORIES = ['Maintenance', 'Diagnostic', 'Deployment', 'Monitoring', 'Security', 'Custom'] as const;

const componentId = computed(() => route.params.id as string | undefined);
const isNew       = computed(() => !componentId.value);

const loading   = ref(false);
const saving    = ref(false);
const loadError = ref('');
const saveError = ref('');
const isStore   = ref(false);
const companies   = ref<Company[]>([]);
const customFieldsList = ref<CustomField[]>([]);
const availableCfKeys  = computed(() => customFieldsList.value.filter(f => f.key).map(f => f.key));
const fieldErr  = reactive({ name: '', companies: '', script: '' });

const form = reactive({
  name: '', description: '', category: '', type: 'script' as 'script' | 'application',
  scope: 'global' as 'global' | 'company',
  shell: 'auto', script: '', timeoutSeconds: 300, targetOs: '' as string,
});

const postConditions = ref<PostCondition[]>([]);
const variables       = ref<ComponentVariable[]>([]);

// ── Companies (multi-select — a component can be restricted to several companies,
// added/removed one at a time via the "Add Company" flyout) ──

const selectedCompanies   = ref<ComponentCompany[]>([]);
const companiesFlyoutOpen = ref(false);
const companyFlyoutQuery = ref('');

const companyFlyoutMatches = computed(() => {
  const q = companyFlyoutQuery.value.trim().toLowerCase();
  const list = q ? companies.value.filter(t => t.name.toLowerCase().includes(q)) : companies.value;
  return list.slice(0, 50);
});

function isCompanySelected(companyId: string): boolean {
  return selectedCompanies.value.some(s => s.companyId === companyId);
}

async function addCompany(t: Company) {
  if (isCompanySelected(t.id)) return;
  if (!isNew.value && componentId.value) {
    try { await api.components.companies.add(componentId.value, t.id); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  selectedCompanies.value.push({ companyId: t.id, name: t.name });
}

async function removeCompany(companyId: string) {
  if (!isNew.value && componentId.value) {
    try { await api.components.companies.remove(componentId.value, companyId); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  selectedCompanies.value = selectedCompanies.value.filter(s => s.companyId !== companyId);
}

async function removeAllCompanies() {
  if (!isNew.value && componentId.value) {
    for (const s of selectedCompanies.value) {
      try { await api.components.companies.remove(componentId.value, s.companyId); } catch { /* best-effort, continue clearing locally */ }
    }
  }
  selectedCompanies.value = [];
}

// ── Variables sub-form ──

interface VarFormState {
  id:            string | null;
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
  if (!varForm.value) return;
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

    if (!isNew.value && componentId.value) {
      // Existing component — persist immediately
      if (f.id) {
        await api.components.variables.update(componentId.value, f.id, {
          name: f.name.trim(), label: f.label.trim(), type: f.type, options,
          default_value: f.defaultValue || null, description: f.description || null, required: f.required,
        });
        const idx = variables.value.findIndex(v => v.id === f.id);
        if (idx >= 0) {
          variables.value[idx] = {
            ...variables.value[idx],
            name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
            defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          };
        }
      } else {
        const created = await api.components.variables.create(componentId.value, {
          name: f.name.trim(), label: f.label.trim(), type: f.type, options,
          default_value: f.defaultValue || null, description: f.description || null, required: f.required,
        });
        variables.value.push(created);
      }
    } else {
      // Brand-new component — hold locally until the component itself is created
      if (f.id) {
        const idx = variables.value.findIndex(v => v.id === f.id);
        if (idx >= 0) {
          variables.value[idx] = {
            ...variables.value[idx],
            name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
            defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          };
        }
      } else {
        variables.value.push({
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          componentId: '',
          name: f.name.trim(), label: f.label.trim(), type: f.type, options: options ?? null,
          defaultValue: f.defaultValue || null, description: f.description || null, required: f.required,
          sortOrder: variables.value.length, createdAt: Math.floor(Date.now() / 1000),
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
  if (!isNew.value && componentId.value && !v.id.startsWith('draft-')) {
    try {
      await api.components.variables.delete(componentId.value, v.id);
    } catch (e: any) {
      saveError.value = e.message;
      return;
    }
  }
  variables.value = variables.value.filter(x => x.id !== v.id);
}

// ── Post-conditions ──

function addPostCondition() {
  postConditions.value.push({
    id: `pc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    stream: 'stdout', match_type: 'contains', pattern: '', enabled: true,
  });
}

// ── Load ──

onMounted(async () => {
  try { companies.value = await api.companies.list(); } catch { /* ok */ }
  try { customFieldsList.value = await api.customFields.list(); } catch { /* ok */ }

  if (!isNew.value && componentId.value) {
    loading.value = true;
    try {
      const comp: Component = await api.components.get(componentId.value);
      form.name           = comp.name;
      form.description     = comp.description ?? '';
      form.category        = comp.category ?? '';
      form.type             = comp.type;
      form.scope           = comp.scope;
      form.shell           = comp.shell;
      form.script          = comp.script;
      form.timeoutSeconds = comp.timeoutSeconds;
      form.targetOs        = comp.targetOs ?? '';
      postConditions.value = comp.postConditions.map(pc => ({ ...pc }));
      variables.value       = comp.variables.map(v => ({ ...v }));
      selectedCompanies.value   = comp.companies.map(s => ({ ...s }));
      isStore.value         = comp.origin === 'store';
    } catch (e: any) {
      loadError.value = e.message;
    } finally {
      loading.value = false;
    }
  }
});

// ── Save ──

async function save() {
  fieldErr.name   = '';
  fieldErr.companies  = '';
  fieldErr.script = '';
  saveError.value = '';

  if (!form.name.trim())   { fieldErr.name   = 'Name is required.';   return; }
  if (!form.script.trim()) { fieldErr.script = 'Script is required.'; return; }
  if (form.scope === 'company' && selectedCompanies.value.length === 0) { fieldErr.companies = 'Add at least one company.'; return; }

  saving.value = true;
  try {
    if (isNew.value) {
      const created = await api.components.create({
        name:            form.name.trim(),
        description:     form.description.trim() || null,
        category:        form.category || null,
        type:            form.type,
        scope:           form.scope,
        shell:           form.shell,
        script:          form.script,
        timeout_seconds: form.timeoutSeconds,
        post_conditions: postConditions.value,
        target_os:       form.targetOs || null,
      });
      for (const v of variables.value) {
        await api.components.variables.create(created.id, {
          name: v.name, label: v.label, type: v.type,
          options: v.options ?? undefined, default_value: v.defaultValue,
          description: v.description, required: v.required,
        });
      }
      for (const s of selectedCompanies.value) {
        await api.components.companies.add(created.id, s.companyId);
      }
    } else if (componentId.value) {
      await api.components.update(componentId.value, {
        name:            form.name.trim(),
        description:     form.description.trim() || null,
        category:        form.category || null,
        type:            form.type,
        scope:           form.scope,
        shell:           form.shell,
        script:          form.script,
        timeout_seconds: form.timeoutSeconds,
        post_conditions: postConditions.value,
        target_os:       form.targetOs || null,
      });
    }
    router.push('/components');
  } catch (e: any) {
    saveError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }

/* ── Breadcrumb ── */
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--color-primary); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--color-text-subtle); }

/* ── Top bar ── */
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-back {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border);
  color: var(--color-text-subtle); cursor: pointer; flex-shrink: 0;
  transition: color .12s, background .12s;
}
.pf-back:hover { color: var(--color-text-primary); background: var(--color-border); }
.pf-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }

.pf-state { padding: 40px; text-align: center; color: var(--color-text-muted); }

/* ── Body ── */
.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--color-border); max-width: 760px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-input {
  width: 100%; max-width: 480px; padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-textarea { resize: vertical; min-height: 60px; }
.pf-code { max-width: none; min-height: 260px; resize: vertical; font-family: var(--mono); font-size: 12px; }
.pf-err { font-size: 11px; color: var(--color-danger); }
.field-hint { font-size: 11px; color: var(--color-text-muted); margin: 0; }

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn { padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font); background: var(--color-surface-raised); color: var(--color-text-subtle); border: none; cursor: pointer; transition: background .12s, color .12s; }
.seg-btn + .seg-btn { border-left: 1px solid var(--color-border-strong); }
.seg-btn.active { background: var(--color-surface); color: var(--color-text-primary); }

/* ── Company search ── */
.pf-company-wrap { position: relative; max-width: 340px; }
.pf-company-row  { position: relative; }
.pf-company-input { padding-right: 32px; }
.pf-company-icon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); pointer-events: none; }
.pf-company-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden;
}
.pf-company-opt { padding: 8px 12px; font-size: 13px; color: var(--color-text-primary); cursor: pointer; transition: background .08s; }
.pf-company-opt:hover { background: var(--color-surface-raised); }

/* ── Variables / Post-conditions "table" containers (reuse monitor-list chrome) ── */
.pf-monitors { border: 1px solid var(--color-border); border-radius: 7px; overflow: hidden; background: var(--color-surface); }
.pf-mon-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--color-text-muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--color-text-primary); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }
.pf-mon-add { padding: 8px 14px; border-top: 1px solid var(--color-border); }

.var-type-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 1px 6px; border-radius: 3px; background: var(--color-surface-raised); color: var(--color-text-muted); flex-shrink: 0;
}

.var-form { margin-top: 10px; padding: 12px; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-surface-raised); }
.var-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.var-option-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.var-option-row input { flex: 1; }
.var-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-primary); font-weight: 400; }
/* Attach Required directly to its Type select rather than leaving it isolated
   in its own grid row. `.field .checkbox-label` (two classes) intentionally
   outweighs the global `.field label` rule's specificity (class+element) so
   this doesn't get silently uppercased/muted like a field's own label. */
.type-required-row { display: flex; align-items: center; gap: 12px; }
.type-required-row select { flex: 1; }
.field .checkbox-label { text-transform: none; font-size: 12px; color: var(--color-text-primary); letter-spacing: normal; }
.required { color: var(--color-danger); }

.pc-row { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--color-border); }
.pc-row:last-of-type { border-bottom: none; }
.pc-pattern { flex: 1; }

.btn-text { background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font); color: var(--color-text-muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s; }
.btn-text:hover { background: var(--color-border); color: var(--color-text-primary); }
.btn-text.danger:hover { color: var(--color-danger); }

.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--color-border-strong);
  background: var(--color-surface-raised); color: var(--color-text-subtle); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s; flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--color-border); color: var(--color-text-primary); }

/* ── Add Company flyout (right-side panel, mirrors PolicyFormPage's monitor drawer) ── */
.sf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  z-index: 500; display: flex; align-items: stretch; justify-content: flex-end;
}
.sf-panel {
  display: flex; flex-direction: column;
  width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--color-surface); border-left: 1px solid var(--color-border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.sf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.sf-title { font-size: 16px; font-weight: 700; color: var(--color-text-primary); margin: 0; }
.sf-search { padding: 14px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.sf-search .pf-input { max-width: none; }
.sf-list { flex: 1; overflow-y: auto; }
.sf-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid var(--color-border);
  font-size: 13px; color: var(--color-text-primary);
}
.sf-row.selected { background: rgba(78,126,247,.06); }
</style>
