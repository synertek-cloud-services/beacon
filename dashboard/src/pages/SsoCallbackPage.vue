<template>
  <div class="lp-bg">
    <div class="lp-card sso-card">
      <div v-if="!error" class="sso-status">
        <span class="lp-spinner sso-spinner"></span>
        Completing sign-in…
      </div>
      <div v-else class="lp-error">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { loadCurrentUser } from '../auth';

const route  = useRoute();
const router = useRouter();
const error  = ref('');

onMounted(async () => {
  const code = route.query.xchg as string | undefined;
  if (!code) {
    error.value = 'Missing sign-in code.';
    return;
  }
  try {
    const { token } = await api.auth.microsoftExchange(code);
    api.saveToken(token);
    await loadCurrentUser().catch(() => {});
    router.push('/devices');
  } catch {
    error.value = 'This sign-in link has expired or was already used. Please try again.';
  }
});
</script>

<style scoped>
.lp-bg {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse 60% 40% at 50% 0%, rgba(78,126,247,.18) 0%, transparent 70%),
    #0c0e16;
  padding: 24px;
}
.lp-card {
  width: 100%;
  max-width: 400px;
  background: #141720;
  border: 1px solid #2d3148;
  border-radius: 14px;
  padding: 28px 32px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
}
.sso-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #8486a8;
  font-size: 13px;
}
.sso-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(78,126,247,.25);
  border-top-color: #4e7ef7;
  border-radius: 50%;
  animation: spin .65s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
.lp-error {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 13px;
  background: rgba(232,86,106,.08);
  border: 1px solid rgba(232,86,106,.22);
  border-radius: 7px;
  color: #e8566a;
  font-size: 12px;
}
</style>
