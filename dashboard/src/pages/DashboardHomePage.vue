<template><div class="dash-home">Loading dashboard…</div></template>
<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
const router = useRouter();
onMounted(async () => {
  try {
    const dashboards = await api.dashboards.list();
    const home = dashboards.find(dashboard => dashboard.isHome) ?? dashboards[0];
    if (home) await router.replace(`/dashboards/${home.id}`);
  } catch { /* DashboardPage will surface normal API failures after navigation. */ }
});
</script>
<style scoped>.dash-home { color:var(--color-text-muted); padding:32px; font-size:13px; }</style>
