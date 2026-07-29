<template>
  <div class="pf-page">
    <div class="pf-topbar">
      <h1 class="pf-title">General Settings</h1>
      <div class="pf-topbar-right">
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="loadError" class="error-banner" style="margin:0 0 16px">{{ loadError }}</div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <div class="pf-group">
        <label class="pf-label">Time Zone</label>
        <p class="field-hint" style="margin-top:-4px">
          Used to schedule and evaluate Maintenance Policy windows (Global &gt; Maintenance Policies).
          Does not affect timestamps shown elsewhere in the dashboard, which render in your browser's own time zone.
        </p>
        <select v-model="timezone" class="pf-input">
          <option value="UTC">UTC</option>
          <option v-for="tz in ianaTimezones" :key="tz" :value="tz">{{ tz }}</option>
        </select>
      </div>

      <div v-if="saveSuccess" class="pf-success">Saved.</div>
      <div v-if="saveError" class="error-banner">{{ saveError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

const loading     = ref(false);
const saving      = ref(false);
const loadError   = ref('');
const saveError   = ref('');
const saveSuccess = ref(false);
const timezone    = ref('UTC');

// Intl.supportedValuesOf('timeZone') deliberately omits "UTC" itself (a real
// gap hit while building the worker-side validation for this same field --
// see routes/admin/settings.ts) -- "UTC" is added as its own fixed first
// option above rather than relying on the enumeration to include it.
const ianaTimezones = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : [];

onMounted(async () => {
  loading.value = true;
  try {
    const settings = await api.settings.get();
    timezone.value = settings.timezone;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load settings.';
  } finally {
    loading.value = false;
  }
});

async function save() {
  saveError.value = '';
  saveSuccess.value = false;
  saving.value = true;
  try {
    await api.settings.update({ timezone: timezone.value });
    saveSuccess.value = true;
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save.';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pf-page { display: flex; flex-direction: column; min-height: 100%; }
.pf-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.pf-title { font-size: 20px; font-weight: 700; color: var(--color-text-primary); flex: 1; margin: 0; }
.pf-topbar-right { display: flex; gap: 8px; flex-shrink: 0; }
.pf-state { padding: 40px; text-align: center; color: var(--color-text-muted); }
.pf-body { display: flex; flex-direction: column; gap: 0; }
.pf-group { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; border-bottom: 1px solid var(--color-border); max-width: 480px; }
.pf-group:last-child { border-bottom: none; }
.pf-label { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.pf-input {
  width: 100%; padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 6px; }
.pf-success { font-size: 12px; color: var(--color-success); margin-top: 12px; }
</style>
