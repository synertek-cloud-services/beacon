<template>
  <div class="pf-page">
    <nav class="pf-crumb">
      <span class="pf-crumb-current">Custom Fields</span>
    </nav>

    <div class="pf-topbar">
      <h1 class="pf-title">Custom Fields</h1>
    </div>

    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <div class="pf-group">
        <label class="pf-label">Fields</label>
        <p class="field-hint" style="margin-top:-4px">
          Admin-defined fields for information the agent doesn't collect (asset tags, site contacts, etc.).
          Values are entered manually per device on the device's Custom Fields section. A field with a Key
          can be referenced in a script as <code>${CF_&lt;KEY&gt;}</code> (bash), <code>$env:CF_&lt;KEY&gt;</code>
          (PowerShell), or <code>%CF_&lt;KEY&gt;%</code> (Batch) — resolved to that device's own value at job dispatch time.
        </p>

        <div class="pf-monitors">
          <div class="pf-tbl-head">
            <span class="pf-tbl-head-spacer"></span>
            <span style="flex:1;max-width:320px">Name</span>
            <span style="max-width:160px">Key</span>
          </div>
          <div v-if="!fields.length" class="pf-mon-empty">
            <p>No custom fields yet. Add one below.</p>
          </div>
          <div v-for="(f, idx) in fields" :key="f.id" class="pf-mon-row">
            <div class="pf-mon-order">
              <button class="btn-icon" :disabled="idx === 0" title="Move up" @click="moveUp(idx)">↑</button>
              <button class="btn-icon" :disabled="idx === fields.length - 1" title="Move down" @click="moveDown(idx)">↓</button>
            </div>
            <input
              class="pf-input pf-mon-desc"
              style="flex:1;max-width:320px"
              :value="f.name"
              @change="renameField(f, $event)"
            />
            <input
              class="pf-input mono"
              style="max-width:160px"
              :value="f.key"
              placeholder="—"
              @change="rekeyField(f, $event)"
            />
            <div class="pf-mon-actions">
              <button class="btn-text danger" @click="removeField(f.id)">Remove</button>
            </div>
          </div>
        </div>

        <div class="pf-row" style="margin-top:10px;gap:8px">
          <input :value="newFieldName" class="pf-input" style="max-width:280px" placeholder="Field name (e.g. Asset Tag)" @input="onNameInput" @keyup.enter="addField" />
          <input v-model="newFieldKey" class="pf-input mono" style="max-width:180px" placeholder="ASSET_TAG (auto)" @input="keyTouched = true" @keyup.enter="addField" />
          <button class="btn btn-ghost btn-sm" :disabled="!newFieldName.trim()" @click="addField">Add Field</button>
        </div>
        <div v-if="error" class="error-banner">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, type CustomField } from '../api';

const loading = ref(true);
const fields = ref<CustomField[]>([]);
const newFieldName = ref('');
const newFieldKey = ref('');
const keyTouched = ref(false);
const error = ref('');

onMounted(async () => {
  fields.value = await api.customFields.list();
  loading.value = false;
});

// Uppercase, non-alnum runs -> underscore, trim leading/trailing underscores.
// Matches the server's own normalizeKey()/CUSTOM_FIELD_KEY_RE exactly, so the
// suggestion is never rejected by the same validation it's meant to satisfy.
function suggestKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function onNameInput(event: Event) {
  newFieldName.value = (event.target as HTMLInputElement).value;
  if (!keyTouched.value) newFieldKey.value = suggestKey(newFieldName.value);
}

async function addField() {
  error.value = '';
  const name = newFieldName.value.trim();
  if (!name) return;
  const key = newFieldKey.value.trim().toUpperCase();
  try {
    const { id } = await api.customFields.create(name, key || undefined);
    fields.value.push({ id, name, key, sortOrder: fields.value.length, createdAt: Math.floor(Date.now() / 1000) });
    newFieldName.value = '';
    newFieldKey.value = '';
    keyTouched.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to add field.';
  }
}

async function renameField(f: CustomField, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (!name || name === f.name) { (event.target as HTMLInputElement).value = f.name; return; }
  await api.customFields.update(f.id, { name });
  f.name = name;
}

async function rekeyField(f: CustomField, event: Event) {
  const input = event.target as HTMLInputElement;
  const key = input.value.trim().toUpperCase();
  if (key === f.key) { input.value = f.key; return; }
  error.value = '';
  try {
    await api.customFields.update(f.id, { key });
    f.key = key;
  } catch (e) {
    input.value = f.key; // revert the displayed value — the rename was blocked (or invalid/duplicate)
    error.value = e instanceof Error ? e.message : 'Failed to update key.';
  }
}

async function removeField(id: string) {
  await api.customFields.delete(id);
  fields.value = fields.value.filter(f => f.id !== id);
}

async function moveUp(idx: number) {
  if (idx === 0) return;
  await swap(idx - 1, idx);
}
async function moveDown(idx: number) {
  if (idx >= fields.value.length - 1) return;
  await swap(idx, idx + 1);
}
async function swap(i: number, j: number) {
  const a = fields.value[i], b = fields.value[j];
  const aOrder = a.sortOrder, bOrder = b.sortOrder;
  [fields.value[i], fields.value[j]] = [b, a];
  a.sortOrder = bOrder; b.sortOrder = aOrder;
  await Promise.all([
    api.customFields.update(a.id, { sort_order: a.sortOrder }),
    api.customFields.update(b.id, { sort_order: b.sortOrder }),
  ]);
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }
.pf-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); margin-bottom: 14px; }
.pf-crumb-current { color: var(--color-text-subtle); }
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); flex: 1; margin: 0; }
.pf-state { padding: 40px; text-align: center; color: var(--color-text-muted); }

.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group {
  display: flex; flex-direction: column; gap: 10px;
  padding: 20px 0; border-bottom: 1px solid var(--color-border);
  max-width: 760px;
}
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-input {
  padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-row { display: flex; align-items: center; gap: 8px; }
.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }

.pf-monitors { border: 1px solid var(--color-border); border-radius: 7px; overflow: hidden; background: var(--color-surface); }
.pf-tbl-head {
  display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border);
  font-size: 11px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em;
}
/* Matches .pf-mon-order's rendered width (two 22px buttons + 2px gap) so the
   Name/Key labels line up with their actual input columns below, not the
   reorder-arrows column. */
.pf-tbl-head-spacer { width: 46px; flex-shrink: 0; }
.pf-mon-empty { padding: 24px; text-align: center; }
.pf-mon-empty p { font-size: 12px; color: var(--color-text-muted); margin: 0; }
.pf-mon-row { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--color-border); }
.pf-mon-row:last-of-type { border-bottom: none; }
.pf-mon-desc { font-size: 12px; color: var(--color-text-primary); }
.pf-mon-order { display: flex; gap: 2px; flex-shrink: 0; }
.pf-mon-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }

.btn-icon {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong); border-radius: 4px;
  color: var(--color-text-subtle); font-size: 11px; cursor: pointer;
}
.btn-icon:disabled { opacity: .35; cursor: default; }

.btn-text { background: none; border: none; color: var(--color-primary); font-size: 12px; font-weight: 500; cursor: pointer; padding: 2px 4px; }
.btn-text:hover { text-decoration: underline; }
.btn-text.danger { color: var(--color-danger); }
</style>
