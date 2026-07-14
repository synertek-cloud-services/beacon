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

      <!-- Sites scope -->
      <div class="pf-group">
        <label class="pf-label">Sites</label>
        <div class="seg-bar">
          <button :class="['seg-btn', { active: form.scope === 'global' }]" @click="form.scope = 'global'">All Sites</button>
          <button :class="['seg-btn', { active: form.scope === 'company' }]" @click="form.scope = 'company'">Selected Sites</button>
        </div>
        <template v-if="form.scope === 'company'">
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-primary btn-sm" @click="sitesFlyoutOpen = true">Add Site</button>
            <button class="btn btn-ghost btn-sm" :disabled="selectedSites.length === 0" @click="removeAllSites">Remove all</button>
          </div>
          <div class="pf-monitors" style="margin-top:8px">
            <div v-if="selectedSites.length === 0" class="pf-mon-empty">
              <p>Select which Sites to add to this Component.</p>
            </div>
            <div v-else v-for="s in selectedSites" :key="s.tenantId" class="pf-mon-row">
              <span class="pf-mon-desc">{{ s.name }}</span>
              <div class="pf-mon-actions">
                <button class="btn-text danger" @click="removeSite(s.tenantId)">Remove</button>
              </div>
            </div>
          </div>
        </template>
        <span v-if="fieldErr.sites" class="pf-err">{{ fieldErr.sites }}</span>
      </div>

      <!-- Add Site flyout -->
      <Teleport to="body">
        <div v-if="sitesFlyoutOpen" class="sf-overlay" @click.self="sitesFlyoutOpen = false">
          <div class="sf-panel">
            <div class="sf-head">
              <h2 class="sf-title">Sites</h2>
              <button class="btn-icon" @click="sitesFlyoutOpen = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="sf-search">
              <input v-model="siteFlyoutQuery" class="pf-input" placeholder="Search" />
            </div>
            <div class="sf-list">
              <div v-for="t in siteFlyoutMatches" :key="t.id" class="sf-row" :class="{ selected: isSiteSelected(t.id) }">
                <span>{{ t.name }}</span>
                <button v-if="isSiteSelected(t.id)" class="btn btn-primary btn-sm" @click="removeSite(t.id)">Remove</button>
                <button v-else class="btn btn-ghost btn-sm" @click="addSite(t)">Add</button>
              </div>
              <div v-if="siteFlyoutMatches.length === 0" class="pf-mon-empty"><p>No matching sites.</p></div>
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
                <button class="btn-icon" @click="varForm!.options.splice(idx, 1)" title="Remove">×</button>
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
import { api, type Component, type ComponentSite, type ComponentVariable, type ComponentVariableType, type ComponentVariableOption, type PostCondition, type Tenant } from '../api';

const router = useRouter();
const route  = useRoute();

const CATEGORIES = ['Maintenance', 'Diagnostic', 'Deployment', 'Monitoring', 'Security', 'Custom'] as const;

const componentId = computed(() => route.params.id as string | undefined);
const isNew       = computed(() => !componentId.value);

const loading   = ref(false);
const saving    = ref(false);
const loadError = ref('');
const saveError = ref('');
const tenants   = ref<Tenant[]>([]);
const fieldErr  = reactive({ name: '', sites: '', script: '' });

const form = reactive({
  name: '', description: '', category: '', type: 'script' as 'script' | 'application',
  scope: 'global' as 'global' | 'company',
  shell: 'auto', script: '', timeoutSeconds: 300,
});

const postConditions = ref<PostCondition[]>([]);
const variables       = ref<ComponentVariable[]>([]);

// ── Sites (multi-select — a component can be restricted to several sites,
// added/removed one at a time via the "Add Site" flyout) ──

const selectedSites   = ref<ComponentSite[]>([]);
const sitesFlyoutOpen = ref(false);
const siteFlyoutQuery = ref('');

const siteFlyoutMatches = computed(() => {
  const q = siteFlyoutQuery.value.trim().toLowerCase();
  const list = q ? tenants.value.filter(t => t.name.toLowerCase().includes(q)) : tenants.value;
  return list.slice(0, 50);
});

function isSiteSelected(tenantId: string): boolean {
  return selectedSites.value.some(s => s.tenantId === tenantId);
}

async function addSite(t: Tenant) {
  if (isSiteSelected(t.id)) return;
  if (!isNew.value && componentId.value) {
    try { await api.components.sites.add(componentId.value, t.id); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  selectedSites.value.push({ tenantId: t.id, name: t.name });
}

async function removeSite(tenantId: string) {
  if (!isNew.value && componentId.value) {
    try { await api.components.sites.remove(componentId.value, tenantId); }
    catch (e: any) { saveError.value = e.message; return; }
  }
  selectedSites.value = selectedSites.value.filter(s => s.tenantId !== tenantId);
}

async function removeAllSites() {
  if (!isNew.value && componentId.value) {
    for (const s of selectedSites.value) {
      try { await api.components.sites.remove(componentId.value, s.tenantId); } catch { /* best-effort, continue clearing locally */ }
    }
  }
  selectedSites.value = [];
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
  try { tenants.value = await api.tenants.list(); } catch { /* ok */ }

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
      postConditions.value = comp.postConditions.map(pc => ({ ...pc }));
      variables.value       = comp.variables.map(v => ({ ...v }));
      selectedSites.value   = comp.sites.map(s => ({ ...s }));
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
  fieldErr.sites  = '';
  fieldErr.script = '';
  saveError.value = '';

  if (!form.name.trim())   { fieldErr.name   = 'Name is required.';   return; }
  if (!form.script.trim()) { fieldErr.script = 'Script is required.'; return; }
  if (form.scope === 'company' && selectedSites.value.length === 0) { fieldErr.sites = 'Add at least one site.'; return; }

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
      });
      for (const v of variables.value) {
        await api.components.variables.create(created.id, {
          name: v.name, label: v.label, type: v.type,
          options: v.options ?? undefined, default_value: v.defaultValue,
          description: v.description, required: v.required,
        });
      }
      for (const s of selectedSites.value) {
        await api.components.sites.add(created.id, s.tenantId);
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
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-bottom: 14px; }
.pf-crumb-link { color: var(--accent); text-decoration: none; }
.pf-crumb-link:hover { text-decoration: underline; }
.pf-crumb-current { color: var(--muted-2); }

/* ── Top bar ── */
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-back {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--muted-2); cursor: pointer; flex-shrink: 0;
  transition: color .12s, background .12s;
}
.pf-back:hover { color: var(--text); background: var(--border); }
.pf-title { font-size: 20px; font-weight: 700; color: var(--text); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }

.pf-state { padding: 40px; text-align: center; color: var(--muted); }

/* ── Body ── */
.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--border); max-width: 760px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--text); }
.pf-input {
  width: 100%; max-width: 480px; padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 6px; color: var(--text); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--accent); }
.pf-textarea { resize: vertical; min-height: 60px; }
.pf-code { max-width: none; min-height: 260px; resize: vertical; font-family: var(--mono); font-size: 12px; }
.pf-err { font-size: 11px; color: var(--red); }
.field-hint { font-size: 11px; color: var(--muted); margin: 0; }

/* ── Segmented bar ── */
.seg-bar { display: inline-flex; border: 1px solid var(--border-2); border-radius: 6px; overflow: hidden; align-self: flex-start; }
.seg-btn { padding: 7px 18px; font-size: 13px; font-weight: 500; font-family: var(--font); background: var(--surface-2); color: var(--muted-2); border: none; cursor: pointer; transition: background .12s, color .12s; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border-2); }
.seg-btn.active { background: var(--surface); color: var(--text); }

/* ── Site search ── */
.pf-site-wrap { position: relative; max-width: 340px; }
.pf-site-row  { position: relative; }
.pf-site-input { padding-right: 32px; }
.pf-site-icon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.pf-site-drop {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 50; overflow: hidden;
}
.pf-site-opt { padding: 8px 12px; font-size: 13px; color: var(--text); cursor: pointer; transition: background .08s; }
.pf-site-opt:hover { background: var(--surface-2); }

/* ── Variables / Post-conditions "table" containers (reuse monitor-list chrome) ── */
.pf-monitors { border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--surface); }
.pf-mon-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--muted); max-width: 340px; line-height: 1.6; margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { flex: 1; font-size: 12px; color: var(--text); }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; }
.pf-mon-add { padding: 8px 14px; border-top: 1px solid var(--border); }

.var-type-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  padding: 1px 6px; border-radius: 3px; background: var(--surface-2); color: var(--muted); flex-shrink: 0;
}

.var-form { margin-top: 10px; padding: 12px; border: 1px solid var(--border-2); border-radius: 7px; background: var(--surface-2); }
.var-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.var-option-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
.var-option-row input { flex: 1; }
.var-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); font-weight: 400; }
.required { color: var(--red); }

.pc-row { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--border); }
.pc-row:last-of-type { border-bottom: none; }
.pc-pattern { flex: 1; }

.btn-text { background: none; border: none; padding: 2px 7px; font-size: 11px; font-family: var(--font); color: var(--muted); cursor: pointer; border-radius: 3px; transition: background .1s, color .1s; }
.btn-text:hover { background: var(--border); color: var(--text); }
.btn-text.danger:hover { color: var(--red); }

.btn-icon {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-2);
  background: var(--surface-2); color: var(--muted-2); cursor: pointer; font-size: 12px;
  display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s; flex-shrink: 0;
}
.btn-icon:hover:not(:disabled) { background: var(--border); color: var(--text); }

/* ── Add Site flyout (right-side panel, mirrors PolicyFormPage's monitor drawer) ── */
.sf-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  z-index: 500; display: flex; align-items: stretch; justify-content: flex-end;
}
.sf-panel {
  display: flex; flex-direction: column;
  width: 420px; max-width: calc(100vw - 80px); height: 100%;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden;
}
.sf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.sf-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; }
.sf-search { padding: 14px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sf-search .pf-input { max-width: none; }
.sf-list { flex: 1; overflow-y: auto; }
.sf-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid var(--border);
  font-size: 13px; color: var(--text);
}
.sf-row.selected { background: rgba(78,126,247,.06); }
</style>
