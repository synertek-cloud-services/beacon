<template>
  <div class="pf-page">
    <nav class="pf-crumb"><span class="pf-crumb-current">RustDesk</span></nav>
    <div class="pf-topbar"><h1 class="pf-title">RustDesk</h1></div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <div class="pf-group">
        <label class="pf-label">Relay Server</label>
        <p class="field-hint" style="margin-top:-4px">
          Leave every field blank to use RustDesk's own free public ID/relay servers — no self-hosted infrastructure
          required. Fill these in only if you're running your own <code>hbbs</code>/<code>hbbr</code> server.
          This is host-wide config for whichever devices have RustDesk enabled (per-company, on the Companies page) —
          on-demand agent installation isn't built yet, so this page doesn't do anything downstream until it is.
        </p>

        <div class="pf-field-row"><label class="pf-sublabel">ID Server</label><input v-model="form.idServer" class="pf-input" placeholder="e.g. rustdesk.example.com" /></div>
        <div class="pf-field-row"><label class="pf-sublabel">Relay Server</label><input v-model="form.relayServer" class="pf-input" placeholder="leave blank if same as ID Server" /></div>
        <div class="pf-field-row"><label class="pf-sublabel">Key</label><input v-model="form.key" class="pf-input" placeholder="the server's public key" /></div>

        <div class="pf-row" style="margin-top:4px;gap:8px">
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
        <div v-if="error" class="error-banner">{{ error }}</div>
        <div v-if="saved" class="success-banner">Saved.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { api } from '../api';

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);

const form = reactive<{ idServer: string; relayServer: string; key: string }>({
  idServer: '', relayServer: '', key: '',
});

onMounted(async () => {
  const settings = await api.rustdeskSettings.get().catch(() => null);
  if (settings) {
    form.idServer = settings.idServer ?? '';
    form.relayServer = settings.relayServer ?? '';
    form.key = settings.key ?? '';
  }
  loading.value = false;
});

async function save() {
  error.value = '';
  saved.value = false;
  saving.value = true;
  try {
    await api.rustdeskSettings.update({
      id_server: form.idServer.trim() || null,
      relay_server: form.relayServer.trim() || null,
      key: form.key.trim() || null,
    });
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 4000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save RustDesk settings.';
  } finally {
    saving.value = false;
  }
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
.pf-field-row { display: flex; flex-direction: column; gap: 4px; }
.pf-sublabel { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.pf-input {
  width: 100%; max-width: 480px;
  padding: 9px 12px;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
  outline: none; transition: border-color .12s; box-sizing: border-box;
}
.pf-input:focus { border-color: var(--color-primary); }
.pf-row { display: flex; align-items: center; gap: 8px; }
.field-hint { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
</style>
