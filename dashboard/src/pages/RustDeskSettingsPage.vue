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
          This is host-wide config for whichever devices have RustDesk enabled (per-company, on the Companies page).
          Not yet honored by on-demand installs — every install currently uses RustDesk's public servers
          regardless of what's set here (self-hosted server import is planned, not yet built).
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

      <div class="pf-group">
        <label class="pf-label">Installer</label>
        <p class="field-hint" style="margin-top:-4px">
          The RustDesk installer Beacon deploys on-demand when a technician clicks "Connect via RustDesk" on an
          unprovisioned device. A specific pinned version, not a live fetch from RustDesk's own site at install
          time — upload a new one here to change the version every future install uses.
        </p>

        <p class="text-sm" style="margin:4px 0">
          <template v-if="installer">
            Current: <strong>{{ installer.version }}</strong>
            <span class="text-muted-2"> — {{ formatBytes(installer.sizeBytes) }}, uploaded {{ formatDate(installer.uploadedAt) }}</span>
          </template>
          <span v-else class="text-muted-2">Not uploaded yet.</span>
        </p>

        <div class="pf-field-row"><label class="pf-sublabel">Version</label><input v-model="installerVersion" class="pf-input" placeholder="e.g. 1.3.7" style="max-width:200px" /></div>
        <div class="pf-row" style="gap:8px">
          <input type="file" accept=".exe" @change="onInstallerFileChange" />
          <button class="btn btn-primary btn-sm" :disabled="!installerFile || !installerVersion.trim() || installerUploading" @click="uploadInstaller">
            {{ installerUploading ? 'Uploading…' : 'Upload' }}
          </button>
        </div>
        <div v-if="installerError" class="error-banner">{{ installerError }}</div>
        <div v-if="installerUploaded" class="success-banner">Installer uploaded.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { api, type RustDeskSettings } from '../api';

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);

const form = reactive<{ idServer: string; relayServer: string; key: string }>({
  idServer: '', relayServer: '', key: '',
});

const installer = ref<RustDeskSettings['installer']>(null);
const installerVersion = ref('');
const installerFile = ref<File | null>(null);
const installerUploading = ref(false);
const installerError = ref('');
const installerUploaded = ref(false);

onMounted(async () => {
  const settings = await api.rustdeskSettings.get().catch(() => null);
  if (settings) {
    form.idServer = settings.idServer ?? '';
    form.relayServer = settings.relayServer ?? '';
    form.key = settings.key ?? '';
    installer.value = settings.installer;
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

function onInstallerFileChange(e: Event) {
  installerFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadInstaller() {
  if (!installerFile.value || !installerVersion.value.trim()) return;
  installerError.value = '';
  installerUploaded.value = false;
  installerUploading.value = true;
  try {
    const hash = await sha256(installerFile.value);
    await api.rustdeskSettings.uploadInstaller(installerFile.value, installerVersion.value.trim(), hash);
    const settings = await api.rustdeskSettings.get();
    installer.value = settings.installer;
    installerFile.value = null;
    installerVersion.value = '';
    installerUploaded.value = true;
    setTimeout(() => { installerUploaded.value = false; }, 4000);
  } catch (e) {
    installerError.value = e instanceof Error ? e.message : 'Could not upload installer.';
  } finally {
    installerUploading.value = false;
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
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
