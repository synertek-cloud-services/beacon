<template>
  <div>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Stat cards -->
    <div class="stat-grid">
      <div class="stat-card c-blue">
        <div class="stat-label">Total Devices</div>
        <div class="stat-value">{{ summary?.total ?? '—' }}</div>
        <div class="stat-sub">{{ summary?.approved ?? 0 }} approved</div>
      </div>
      <div class="stat-card c-teal">
        <div class="stat-label">Online Now</div>
        <div class="stat-value">{{ summary?.online ?? '—' }}</div>
        <div class="stat-sub">checked in &lt; 5 min ago</div>
      </div>
      <div class="stat-card c-amber">
        <div class="stat-label">Pending Approval</div>
        <div class="stat-value">{{ summary?.pending ?? '—' }}</div>
        <div class="stat-sub">
          <RouterLink to="/devices" style="color:inherit">Review →</RouterLink>
        </div>
      </div>
      <div class="stat-card c-red">
        <div class="stat-label">Active Alerts</div>
        <div class="stat-value">0</div>
        <div class="stat-sub">no issues detected</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="chart-grid" v-if="summary">
      <div class="chart-card">
        <div class="chart-card-title">Online / Offline</div>
        <DonutChart
          :data="onlineData"
          center-label="approved"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">By Operating System</div>
        <DonutChart
          :data="osData"
          center-label="devices"
        />
      </div>
      <div class="chart-card">
        <div class="chart-card-title">By Device Class</div>
        <DonutChart
          :data="classData"
          center-label="devices"
        />
      </div>
    </div>
    <div class="chart-grid" v-else-if="!error">
      <div class="chart-card" v-for="i in 3" :key="i" style="min-height:140px">
        <div class="chart-card-title">Loading…</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type Summary } from '../api';
import DonutChart from '../components/DonutChart.vue';

const summary = ref<Summary | null>(null);
const error = ref('');

const OS_COLORS: Record<string, string> = {
  linux:   '#4e7ef7',
  windows: '#2dcfa0',
  darwin:  '#f0a840',
  unknown: '#616480',
};

const CLASS_COLORS: Record<string, string> = {
  server:      '#4e7ef7',
  workstation: '#2dcfa0',
  laptop:      '#f0a840',
  unknown:     '#616480',
};

const onlineData = computed(() => [
  { label: 'Online',  value: summary.value?.online  ?? 0, color: '#2dcfa0' },
  { label: 'Offline', value: summary.value?.offline ?? 0, color: '#2d3148' },
]);

const osData = computed(() =>
  Object.entries(summary.value?.by_os ?? {}).map(([os, count]) => ({
    label: os,
    value: count,
    color: OS_COLORS[os] ?? '#616480',
  }))
);

const classData = computed(() =>
  Object.entries(summary.value?.by_class ?? {}).map(([cls, count]) => ({
    label: cls,
    value: count,
    color: CLASS_COLORS[cls] ?? '#616480',
  }))
);

async function load() {
  try {
    summary.value = await api.summary.get();
  } catch (e: any) {
    error.value = e.message;
  }
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => { load(); timer = setInterval(load, 30_000); });
onUnmounted(() => clearInterval(timer));
</script>
