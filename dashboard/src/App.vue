<template>
  <div v-if="isLogin" class="login-wrap">
    <RouterView />
  </div>
  <div v-else class="shell">
    <nav class="sidebar">
      <div class="sidebar-brand">Bea<span>con</span></div>
      <div class="sidebar-nav">
        <RouterLink to="/devices" active-class="active">Devices</RouterLink>
      </div>
      <div class="sidebar-footer">
        <button class="btn btn-ghost btn-sm" @click="logout">Sign out</button>
      </div>
    </nav>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api';

const route = useRoute();
const router = useRouter();

const isLogin = computed(() => route.path === '/login');

function logout() {
  api.clearSecret();
  router.push('/login');
}
</script>
