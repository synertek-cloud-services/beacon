<template>
  <div class="pf-page">
    <nav class="pf-crumb"><span class="pf-crumb-current">Features</span></nav>
    <div class="pf-topbar"><h1 class="pf-title">Features</h1></div>
    <div v-if="loading" class="pf-state">Loading…</div>

    <div v-else class="pf-body">
      <div class="pf-group">
        <p class="field-hint" style="margin-top:0">
          Beacon is built to run on Cloudflare's free plan. The features below do extra work — more scheduled jobs,
          storage, or outbound requests — so they start turned off. Nothing here is locked: turn on what you
          need. Depending on how many devices you manage, enabling several may mean you need Cloudflare's Workers Paid
          plan (about $5/month). The
          <a href="https://runbeacon.net/calculator" target="_blank" rel="noopener noreferrer">cost calculator</a>
          shows where your fleet lands.
        </p>
        <div v-if="forced" class="success-banner">These features are managed by your host and are always on.</div>
        <div v-if="error" class="error-banner">{{ error }}</div>

        <div v-for="f in FEATURES" :key="f.key" class="feat-row">
          <label class="feat-toggle">
            <input type="checkbox" :checked="forced || state[f.key]" :disabled="forced || saving === f.key"
              @change="toggle(f.key, ($event.target as HTMLInputElement).checked)" />
            <span class="feat-name">{{ f.name }}</span>
          </label>
          <p class="field-hint feat-desc">{{ f.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { api, type FeatureKey } from '../api';

const FEATURES: { key: FeatureKey; name: string; description: string }[] = [
  { key: 'discovery', name: 'Network Discovery',
    description: 'Scans a company\'s network from a probe device on a schedule. Adds a scheduled job and agent work for every scan.' },
  { key: 'application_components', name: 'Application Components',
    description: 'Installer files (e.g. MSI) stored in R2 and deployed to devices. Uses R2 storage and download requests.' },
  { key: 'webhooks', name: 'Webhooks',
    description: 'Sends each alert to your webhook endpoints. Every alert makes one outbound request per endpoint.' },
  { key: 'os_update_management', name: 'Windows & Microsoft Update management',
    description: 'Lets Patch Policies take over Windows Update settings. The scheduled job re-checks every managed device and sends it commands.' },
  { key: 'agent_monitors', name: 'Agent-measured monitors',
    description: 'Ping, process, service, and file-size monitors. Each one is measured by the agent and adds work to that device\'s check-ins.' },
];

const loading = ref(true);
const forced = ref(false);
const error = ref('');
const saving = ref<FeatureKey | null>(null);
const state = reactive<Record<FeatureKey, boolean>>({
  discovery: false, application_components: false, webhooks: false, os_update_management: false, agent_monitors: false,
});

onMounted(async () => {
  try {
    const res = await api.settings.features.get();
    Object.assign(state, res.features);
    forced.value = res.forced;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load feature settings.';
  }
  loading.value = false;
});

async function toggle(key: FeatureKey, on: boolean) {
  error.value = '';
  saving.value = key;
  try {
    const res = await api.settings.features.update({ [key]: on });
    Object.assign(state, res.features);
  } catch (e) {
    state[key] = !on;
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    saving.value = null;
  }
}
</script>

<style scoped>
.feat-row { padding: 12px 0; border-top: 1px solid var(--color-border); }
.feat-row:first-of-type { border-top: none; }
.feat-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.feat-name { font-weight: 600; font-size: 14px; color: var(--color-text-primary); }
.feat-desc { margin: 4px 0 0 26px; }
</style>
