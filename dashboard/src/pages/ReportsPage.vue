<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="section-card">
      <div class="section-card-head">
        <span class="section-card-title">Reports</span>
      </div>
      <p class="rp-intro">
        On-demand CSV exports of fleet data — filtered by company below, downloaded directly to your browser. No scheduling or email delivery yet.
      </p>

      <div class="rp-shared-filter">
        <label>Company</label>
        <select v-model="companyId">
          <option value="">All Companies</option>
          <option v-for="t in companies" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>

      <div class="rp-report">
        <div class="rp-report-info">
          <div class="rp-report-name">Device Inventory</div>
          <div class="rp-report-desc">Hostname, OS, class, agent version, last seen, uptime, external IP, and enrollment date for every approved device.</div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="downloading === 'device-inventory'" @click="download('device-inventory')">
          {{ downloading === 'device-inventory' ? 'Downloading…' : 'Download CSV' }}
        </button>
      </div>

      <div class="rp-report">
        <div class="rp-report-info">
          <div class="rp-report-name">Patch Compliance</div>
          <div class="rp-report-desc">Per-device pending patch counts (approved vs. unapproved), driver count, reboot-required, and Windows Update Management status.</div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="downloading === 'patch-compliance'" @click="download('patch-compliance')">
          {{ downloading === 'patch-compliance' ? 'Downloading…' : 'Download CSV' }}
        </button>
      </div>

      <div class="rp-report">
        <div class="rp-report-info">
          <div class="rp-report-name">Alert History</div>
          <div class="rp-report-desc">Alerts triggered within the selected range — device, check type, priority, alerted/resolved timestamps, and current status.</div>
          <div class="rp-report-range">
            <label>Range</label>
            <select v-model.number="alertRangeDays">
              <option :value="7">Last 7 Days</option>
              <option :value="30">Last 30 Days</option>
              <option :value="90">Last 90 Days</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="downloading === 'alert-history'" @click="download('alert-history')">
          {{ downloading === 'alert-history' ? 'Downloading…' : 'Download CSV' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, type Company } from '../api';

const companies = ref<Company[]>([]);
const companyId = ref('');
const alertRangeDays = ref(30);
const downloading = ref('');
const error = ref('');

async function load() {
  try {
    companies.value = await api.companies.list();
  } catch (e: any) {
    error.value = e.message;
  }
}

async function download(type: 'device-inventory' | 'patch-compliance' | 'alert-history') {
  downloading.value = type;
  error.value = '';
  try {
    const params: Record<string, string | undefined> = { company_id: companyId.value || undefined };
    if (type === 'alert-history') {
      const now = Math.floor(Date.now() / 1000);
      params.from = String(now - alertRangeDays.value * 86400);
      params.to = String(now);
    }
    await api.reports.download(type, params);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    downloading.value = '';
  }
}

onMounted(load);
</script>

<style scoped>
.rp-intro {
  font-size: 12px; color: var(--color-text-muted);
  margin: 0 0 16px; padding-bottom: 14px; border-bottom: 1px solid var(--color-border);
}
.rp-shared-filter {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 18px;
}
.rp-shared-filter label {
  font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--color-text-muted);
}
.rp-shared-filter select {
  background: var(--color-canvas); border: 1px solid var(--color-border-strong); border-radius: var(--r-btn);
  padding: 6px 10px; color: var(--color-text-primary); font-size: 13px; font-family: var(--font);
}

.rp-report {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 0; border-top: 1px solid var(--color-border);
}
.rp-report:first-of-type { border-top: none; }
.rp-report-info { flex: 1; min-width: 0; }
.rp-report-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 3px; }
.rp-report-desc { font-size: 12px; color: var(--color-text-muted); line-height: 1.5; }
.rp-report-range { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.rp-report-range label { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-muted); }
.rp-report-range select {
  background: var(--color-canvas); border: 1px solid var(--color-border-strong); border-radius: var(--r-btn);
  padding: 4px 8px; color: var(--color-text-primary); font-size: 12px; font-family: var(--font);
}
</style>
