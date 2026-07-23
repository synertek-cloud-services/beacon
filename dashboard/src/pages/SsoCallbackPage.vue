<template>
  <main class="sc-page">
    <div class="sc-light" aria-hidden="true"></div>
    <section class="sc-status" aria-live="polite">
      <div class="sc-mark"><img src="/brand-mark.svg" width="28" height="28" alt="" /></div>
      <template v-if="!error">
        <span class="sc-spinner"></span>
        <div><p>Secure sign-in</p><strong>Completing Microsoft authentication…</strong></div>
      </template>
      <template v-else>
        <div><p>Sign-in could not be completed</p><strong>{{ error }}</strong></div>
        <RouterLink to="/login">Return to sign-in</RouterLink>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { loadCurrentUser } from '../auth';

const route = useRoute(); const router = useRouter(); const error = ref('');
onMounted(async () => {
  const code = route.query.xchg as string | undefined;
  if (!code) { error.value = 'Missing sign-in code.'; return; }
  try { const { token } = await api.auth.microsoftExchange(code); api.saveToken(token); await loadCurrentUser().catch(() => {}); router.push('/devices'); }
  catch { error.value = 'This sign-in link has expired or was already used. Please try again.'; }
});
</script>

<style scoped>
.sc-page { min-height:100vh; display:grid; place-items:center; position:relative; overflow:hidden; background:var(--color-canvas); color:var(--color-text-primary); padding:24px; }.sc-light { position:absolute; width:min(900px,110vw); aspect-ratio:1; left:-18%; bottom:-55%; background:radial-gradient(circle,color-mix(in srgb,var(--color-primary) 32%,transparent),transparent 66%); filter:blur(12px); }.sc-status { position:relative; width:min(390px,100%); display:grid; grid-template-columns:auto auto 1fr; align-items:center; gap:13px; padding:26px 0 26px 28px; border-left:1px solid color-mix(in srgb,var(--color-text-primary) 15%,transparent); }.sc-mark { width:44px; height:44px; display:grid; place-items:center; border-radius:14px; background:var(--color-surface-brand); box-shadow:0 0 28px color-mix(in srgb,var(--color-primary) 35%,transparent); }.sc-mark img { display:block; }.sc-status p { margin:0 0 4px; color:var(--color-text-muted); font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }.sc-status strong { color:var(--color-text-subtle); font-size:13px; font-weight:500; line-height:1.5; }.sc-spinner { width:15px; height:15px; border:2px solid color-mix(in srgb,var(--color-primary) 25%,transparent); border-top-color:var(--color-primary); border-radius:50%; animation:spin .65s linear infinite; }.sc-status a { grid-column:2 / -1; color:var(--color-text-subtle); font-size:12px; text-underline-offset:3px; } @keyframes spin { to { transform:rotate(360deg); } } @media (prefers-reduced-motion:reduce) { .sc-spinner { animation:none; } } @media (max-width:560px) { .sc-status { padding-left:20px; } }
</style>
