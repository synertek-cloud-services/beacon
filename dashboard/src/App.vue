<template>
  <div v-if="isLogin">
    <RouterView />
  </div>
  <div v-else class="shell">
    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.49 3.51a12 12 0 0 1 0 16.97M3.51 20.49a12 12 0 0 1 0-16.97"/>
          </svg>
        </div>
        <span class="sidebar-brand-name">Beacon</span>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-label">Navigation</div>
        <RouterLink to="/" class="nav-item" :class="{ active: route.path === '/' }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Overview
        </RouterLink>
        <RouterLink to="/devices" class="nav-item" :class="{ active: route.path.startsWith('/devices') }">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/>
          </svg>
          Devices
        </RouterLink>
      </div>

      <div class="sidebar-footer">
        <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center" @click="logout">Sign out</button>
      </div>
    </nav>

    <!-- Main -->
    <div class="main-wrap">
      <div class="topbar">
        <span class="topbar-title">{{ pageTitle }}</span>
        <div class="topbar-actions">
          <span class="text-xs text-muted mono">{{ workerUrl }}</span>
        </div>
      </div>
      <main class="page">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api';

const route = useRoute();
const router = useRouter();

const isLogin = computed(() => route.path === '/login');

const workerUrl = import.meta.env.VITE_API_URL || 'localhost:8787';

const pageTitle = computed(() => {
  if (route.path === '/') return 'Overview';
  if (route.path.startsWith('/devices')) return 'Devices';
  return 'Beacon';
});

function logout() {
  api.clearSecret();
  router.push('/login');
}
</script>
