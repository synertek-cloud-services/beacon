<template>
  <div class="pf-page">
    <nav class="pf-crumb"><span class="pf-crumb-current">Branding</span></nav>
    <div class="pf-topbar"><h1 class="pf-title">Branding</h1></div>
    <div v-if="loading" class="pf-state">Loading…</div>
    <div v-else class="pf-body">
      <section class="pf-group">
        <label class="pf-label">Identity</label>
        <p class="field-hint">Product name and logo shown in the sidebar and on the sign-in page.</p>
        <div class="pf-row" style="gap:10px;align-items:center">
          <img :src="brandState.logoUrl" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:6px;background:var(--color-surface-raised)" />
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            {{ logoUploading ? 'Uploading…' : 'Upload Logo' }}
            <input type="file" accept="image/jpeg,image/png,image/gif,image/svg+xml" style="display:none" :disabled="logoUploading" @change="onLogoChange" />
          </label>
          <button v-if="identity?.logoKey" class="btn-text danger" :disabled="logoUploading" @click="removeLogo">Remove</button>
        </div>
        <p class="field-hint">Square image recommended (256×256px or larger) — it's shown very small (18px in the sidebar, 34px on the sign-in page), so a simple, bold mark works best. Transparent background recommended for non-square art. JPG, PNG, GIF, or SVG, up to 1MB.</p>
        <div class="pf-row" style="gap:8px;margin-top:4px">
          <input v-model="productNameInput" class="pf-input" placeholder="Product name (defaults to Beacon)" style="max-width:280px" @change="saveProductName" />
        </div>
        <div v-if="identityError" class="error-banner">{{ identityError }}</div>
      </section>

      <section class="pf-group">
        <label class="pf-label">Themes</label>
        <p class="field-hint">A theme is a complete palette. Built-in themes activate directly; host themes publish immutable revisions and retain up to five for rollback.</p>
        <div class="theme-list">
          <button v-for="theme in themes" :key="theme.id" class="theme-row" :class="{ selected: selected?.id === theme.id }" @click="select(theme)">
            <span class="theme-swatch" :style="{ background: theme.draftTokens?.primary ?? 'var(--color-primary)' }" />
            <span class="theme-name">{{ theme.name }} <small>{{ theme.source === 'built_in' ? 'Built-in' : 'Host theme' }}</small></span>
            <span v-if="theme.active" class="active-badge">Active</span>
          </button>
        </div>
        <div class="pf-row" style="margin-top:10px;gap:8px">
          <input v-model="newName" class="pf-input" placeholder="New theme name" style="max-width:260px" @keyup.enter="createTheme" />
          <button class="btn btn-ghost btn-sm" :disabled="!newName.trim()" @click="createTheme">Create from selected</button>
        </div>
      </section>

      <section v-if="selected && draft" class="pf-group">
        <label class="pf-label">{{ selected.name }} <span v-if="selected.source === 'built_in'" class="text-muted">(read-only template)</span></label>
        <p class="field-hint">Named semantic values are applied across the dashboard. Contrast warnings are advisory; they do not replace your selected colors.</p>
        <div class="token-grid">
          <label v-for="key in themeKeys" :key="key" class="token-field" :class="{ 'token-warning': fieldWarnings[key] }" :title="fieldWarnings[key]">
            <span>{{ labels[key] }} <span v-if="fieldWarnings[key]" class="warning-icon" aria-hidden="true">⚠</span></span>
            <input v-model="draft[key]" type="color" :disabled="selected.source === 'built_in'" />
            <code>{{ draft[key] }}</code>
          </label>
        </div>
        <div class="pf-row" style="margin-top:14px;gap:8px">
          <button v-if="selected.source === 'custom'" class="btn btn-ghost btn-sm" :disabled="saving" @click="saveDraft">{{ saving ? 'Saving…' : 'Save Draft' }}</button>
          <button v-if="selected.source === 'custom'" class="btn btn-primary btn-sm" :disabled="saving" @click="publish">Publish revision</button>
          <select v-if="selected.source === 'custom' && selected.revisions.length" v-model="revisionToActivate" class="pf-input" style="max-width:210px">
            <option v-for="revision in selected.revisions" :key="revision.id" :value="revision.id">Revision {{ revision.revision }}</option>
          </select>
          <button v-if="selected.source === 'built_in' && !selected.active" class="btn btn-primary btn-sm" @click="activateBuiltIn">Make active</button>
          <button v-if="selected.source === 'custom' && revisionToActivate" class="btn btn-primary btn-sm" @click="activate">Make active</button>
          <button v-if="selected.source === 'custom' && !selected.active" class="btn-text danger" @click="removeTheme">Delete theme</button>
        </div>
        <div v-if="error" class="error-banner">{{ error }}</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, type BrandingIdentity, type BrandingTheme } from '../api';
import { applyTheme, defaultTheme, loadActiveTheme, THEME_KEYS, type ThemeKey, type ThemeTokens } from '../theme';
import { brandState, loadBrandIdentity } from '../brand';

const labels: Record<ThemeKey, string> = { canvas: 'Canvas', surface: 'Surface', surfaceRaised: 'Raised surface', surfaceBrand: 'Brand surface', border: 'Border', borderStrong: 'Strong border', textPrimary: 'Main text', textMuted: 'Muted text', textSubtle: 'Subtle text', textOnPrimary: 'Primary button label', primary: 'Primary button color', primaryHover: 'Primary button hover', success: 'Success', warning: 'Warning', danger: 'Danger', info: 'Info' };
const themeKeys = THEME_KEYS;
const themes = ref<BrandingTheme[]>([]); const selected = ref<BrandingTheme | null>(null);
const draft = ref<ThemeTokens | null>(null); const newName = ref(''); const loading = ref(true); const saving = ref(false); const error = ref(''); const revisionToActivate = ref('');
const identity = ref<BrandingIdentity | null>(null); const productNameInput = ref(''); const identityError = ref(''); const logoUploading = ref(false);

const fieldWarnings = computed<Partial<Record<ThemeKey, string>>>(() => {
  if (!draft.value) return {};
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126*c[0] + .7152*c[1] + .0722*c[2]; };
    const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  };
  const result: Partial<Record<ThemeKey, string>> = {};
  if (contrast(draft.value.textPrimary, draft.value.canvas) < 4.5) result.textPrimary = 'Main text may be hard to read on the canvas.';
  if (contrast(draft.value.textOnPrimary, draft.value.primary) < 4.5) result.textOnPrimary = 'Primary button label may be hard to read on the Primary button color.';
  return result;
});

let previewDraftChanges = true;
function select(theme: BrandingTheme, preview = true) { selected.value = theme; previewDraftChanges = preview; draft.value = { ...(theme.draftTokens ?? defaultTheme) }; revisionToActivate.value = theme.revisions[0]?.id ?? ''; previewDraftChanges = true; }
// Preview is intentionally immediate. Save Draft persists this working palette;
// it must not be required just to see a color change while experimenting.
watch(draft, (tokens) => { if (tokens && previewDraftChanges) applyTheme(tokens); }, { deep: true, flush: 'sync' });
async function reload(selectId?: string, preview = false) { themes.value = await api.branding.list(); const next = themes.value.find(t => t.id === (selectId ?? selected.value?.id)) ?? themes.value.find(t => t.active) ?? themes.value[0]; if (next) select(next, preview); }
async function createTheme() { if (!newName.value.trim() || !draft.value) return; error.value = ''; try { const { id } = await api.branding.create(newName.value.trim(), { ...draft.value }); newName.value = ''; await reload(id, true); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not create theme.'; } }
async function saveDraft() { if (!selected.value || !draft.value) return; saving.value = true; error.value = ''; try { await api.branding.update(selected.value.id, { tokens: draft.value }); await reload(selected.value.id, true); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not save draft.'; } finally { saving.value = false; } }
async function publish() { if (!selected.value) return; await saveDraft(); if (error.value) return; try { const revision = await api.branding.publish(selected.value.id); revisionToActivate.value = revision.id; await reload(selected.value.id); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not publish theme.'; } }
async function activateBuiltIn() { if (!selected.value) return; try { await api.branding.activateBuiltIn(selected.value.id); await loadActiveTheme(); await reload(selected.value.id); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not activate theme.'; } }
async function activate() { if (!revisionToActivate.value) return; try { await api.branding.activate(revisionToActivate.value); await loadActiveTheme(); await reload(selected.value?.id); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not activate theme.'; } }
async function removeTheme() { if (!selected.value || !confirm(`Delete ${selected.value.name}?`)) return; try { await api.branding.delete(selected.value.id); await reload(); } catch (e) { error.value = e instanceof Error ? e.message : 'Could not delete theme.'; } }
async function saveProductName() { identityError.value = ''; try { await api.branding.identity.update(productNameInput.value.trim()); await loadBrandIdentity(); } catch (e) { identityError.value = e instanceof Error ? e.message : 'Could not save product name.'; } }
async function onLogoChange(e: Event) {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  logoUploading.value = true; identityError.value = '';
  try { const { logoKey } = await api.branding.logo.upload(file); if (identity.value) identity.value.logoKey = logoKey; await loadBrandIdentity(); }
  catch (e) { identityError.value = e instanceof Error ? e.message : 'Could not upload logo.'; }
  finally { logoUploading.value = false; }
}
async function removeLogo() { identityError.value = ''; try { await api.branding.logo.remove(); if (identity.value) identity.value.logoKey = null; await loadBrandIdentity(); } catch (e) { identityError.value = e instanceof Error ? e.message : 'Could not remove logo.'; } }
onMounted(async () => {
  try {
    await reload();
    identity.value = await api.branding.identity.get();
    productNameInput.value = identity.value.productName;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not load branding.'; }
  finally { loading.value = false; }
});
onUnmounted(() => { void loadActiveTheme(); });
</script>

<style scoped>
.pf-crumb { display:flex; margin-bottom:14px; font-size:12px; color:var(--color-text-muted); }.pf-topbar { display:flex; margin-bottom:20px; }.pf-title { font-size:20px; color:var(--color-text-primary); }.pf-state { padding:40px; color:var(--color-text-muted); }.pf-body { max-width:900px; }.pf-group { padding:20px 0; border-bottom:1px solid var(--color-border); display:flex; flex-direction:column; gap:10px; }.pf-label { font-size:15px; font-weight:600; color:var(--color-text-primary); }.field-hint { font-size:12px; color:var(--color-text-muted); }.pf-row { display:flex; align-items:center; flex-wrap:wrap; }.pf-input { background:var(--color-surface-raised); color:var(--color-text-primary); border:1px solid var(--color-border-strong); border-radius:6px; padding:7px 9px; font:inherit; }.theme-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:8px; }.theme-row { display:flex; align-items:center; gap:9px; padding:10px; background:var(--color-surface); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:6px; text-align:left; cursor:pointer; }.theme-row.selected { border-color:var(--color-primary); }.theme-swatch { width:20px; height:20px; border-radius:50%; }.theme-name { flex:1; }.theme-name small { color:var(--color-text-muted); display:block; }.active-badge { color:var(--color-success); font-size:11px; }.token-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }.token-field { display:grid; grid-template-columns:1fr 34px 80px; align-items:center; gap:8px; color:var(--color-text-subtle); font-size:12px; background:var(--color-surface); border:1px solid var(--color-border); padding:7px; border-radius:5px; }.token-field.token-warning { border-color:var(--color-warning); }.warning-icon { color:var(--color-warning); }.token-field input { width:28px; height:24px; border:0; background:transparent; }.token-field code { color:var(--color-text-primary); }.error-banner { color:var(--color-danger); font-size:12px; }.btn-text { border:0; background:none; color:var(--color-text-muted); cursor:pointer; }.btn-text.danger { color:var(--color-danger); } @media(max-width:650px) { .token-grid { grid-template-columns:1fr; } }
</style>
