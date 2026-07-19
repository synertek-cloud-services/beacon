<template>
  <main class="lp-page">
    <div class="lp-beacon" aria-hidden="true"><span></span><i></i></div>
    <div class="lp-layout">
      <section class="lp-brand" :aria-label="brandState.productName">
        <div class="lp-brand-lockup">
          <div class="lp-mark"><img :src="brandState.logoUrl" width="34" height="34" alt="" style="object-fit:contain" /></div>
          <div><strong>{{ brandState.productName }}</strong></div>
        </div>
        <div class="lp-brand-copy">
          <p class="lp-kicker">OPERATIONS CONSOLE</p>
          <h1>Bring your fleet<br>into focus.</h1>
          <p>Secure, deliberate access to the systems your team manages.</p>
        </div>
        <div class="lp-signal"><span></span><span></span><span></span><small>SECURE ACCESS</small></div>
      </section>

      <section class="lp-auth" aria-live="polite">
        <div class="lp-auth-head">
          <p class="lp-kicker">ADMIN CONSOLE</p>
          <h2>{{ heading }}</h2>
          <p>{{ subheading }}</p>
        </div>

        <div v-if="mode === 'loading'" class="lp-loading"><span class="lp-spinner"></span> Preparing sign-in…</div>

        <template v-else-if="mode === 'microsoft'">
          <button class="lp-primary lp-microsoft" type="button" @click="signInWithMicrosoft">
            <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
            Continue with Microsoft
          </button>
          <button class="lp-link" type="button" @click="mode = 'local'">Use email and password instead</button>
        </template>

        <form v-else-if="mode === 'local'" class="lp-form" @submit.prevent="submitLocal">
          <div class="lp-field">
            <label for="email">Email</label>
            <input id="email" v-model="email" type="email" placeholder="you@example.com" autocomplete="username" autofocus />
          </div>
          <div class="lp-field">
            <label for="password">Password</label>
            <input id="password" v-model="password" type="password" placeholder="Enter your password" autocomplete="current-password" />
          </div>
          <p class="lp-hint">Forgot your password? Ask an administrator to reset it.</p>
          <button class="lp-primary" :disabled="loading">{{ loading ? 'Signing in…' : 'Sign in' }}</button>
          <button v-if="microsoftAvailable" class="lp-link" type="button" @click="mode = 'microsoft'">Continue with Microsoft instead</button>
        </form>

        <form v-else class="lp-form" @submit.prevent="submitEmergency">
          <div class="lp-emergency-note">Use this only when normal sign-in methods are unavailable. Emergency access is not a regular user account.</div>
          <div class="lp-field">
            <label for="admin-secret">Admin Secret</label>
            <input id="admin-secret" v-model="adminSecret" type="password" placeholder="Paste the emergency administrator secret" autocomplete="off" autofocus />
          </div>
          <button class="lp-primary" :disabled="loading">{{ loading ? 'Verifying…' : 'Continue with emergency access' }}</button>
          <button class="lp-link" type="button" @click="mode = microsoftAvailable ? 'microsoft' : 'local'">Return to normal sign-in</button>
        </form>

        <div v-if="error" class="lp-error" role="alert">{{ error }}</div>
        <button v-if="mode !== 'emergency' && mode !== 'loading'" class="lp-emergency-link" type="button" @click="mode = 'emergency'">Emergency administrator access</button>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { loadCurrentUser } from '../auth';
import { brandState } from '../brand';

type LoginMode = 'loading' | 'microsoft' | 'local' | 'emergency';
const router = useRouter();
const email = ref(''); const password = ref(''); const adminSecret = ref('');
const error = ref(''); const loading = ref(false); const microsoftAvailable = ref(false); const mode = ref<LoginMode>('loading');
const SSO_ERROR_MESSAGES: Record<string, string> = {
  no_group_mapping: 'Your Microsoft account is not mapped to a Beacon role. Contact an administrator.',
  email_already_registered_locally: 'That email is already registered as a local account. Contact an administrator.',
  account_disabled: 'This account has been disabled. Contact an administrator.',
  token_exchange_failed: 'Microsoft sign-in failed. Please try again.',
  id_token_verification_failed: 'Microsoft sign-in failed. Please try again.',
};
const heading = computed(() => mode.value === 'emergency' ? 'Emergency access' : mode.value === 'local' ? 'Sign in with your account' : 'Welcome back');
const subheading = computed(() => mode.value === 'emergency' ? 'Recovery access for the host administrator.' : mode.value === 'local' ? 'Use your Beacon email and password.' : 'Choose a secure sign-in method to continue.');

onMounted(async () => {
  const ssoError = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('error');
  if (ssoError) error.value = SSO_ERROR_MESSAGES[ssoError] ?? 'Microsoft sign-in failed. Please try again.';
  try { microsoftAvailable.value = (await api.auth.microsoftAvailable()).available; } catch { microsoftAvailable.value = false; }
  mode.value = microsoftAvailable.value ? 'microsoft' : 'local';
});

async function complete(token: string, emergency = false) { if (emergency) api.saveEmergencyToken(token); else api.saveToken(token); await loadCurrentUser().catch(() => {}); router.push('/devices'); }
async function submitLocal() {
  if (!email.value.trim() || !password.value) return;
  loading.value = true; error.value = '';
  try { const { token } = await api.auth.login(email.value.trim(), password.value); await complete(token); }
  catch { error.value = 'Invalid email or password.'; }
  finally { loading.value = false; }
}
function signInWithMicrosoft() { window.location.href = api.auth.microsoftLoginUrl(); }
async function submitEmergency() {
  if (!adminSecret.value) return;
  loading.value = true; error.value = '';
  try { await api.auth.verifyEmergencyAccess(adminSecret.value); await complete(adminSecret.value, true); adminSecret.value = ''; }
  catch { error.value = 'Emergency access could not be verified.'; }
  finally { loading.value = false; }
}
</script>

<style scoped>
.lp-page { min-height:100vh; position:relative; overflow:hidden; display:grid; place-items:center; background:var(--color-canvas); color:var(--color-text-primary); padding:32px; isolation:isolate; }
.lp-page::before { content:''; position:absolute; inset:0; z-index:-2; opacity:.4; background-image:linear-gradient(color-mix(in srgb,var(--color-text-primary) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--color-text-primary) 7%,transparent) 1px,transparent 1px); background-size:52px 52px; mask-image:linear-gradient(90deg,black,transparent 72%); }
.lp-beacon { position:absolute; inset:0; z-index:-1; overflow:hidden; pointer-events:none; }
.lp-beacon::before { content:''; position:absolute; width:min(1100px,95vw); aspect-ratio:1; left:-18%; bottom:-56%; background:radial-gradient(circle,color-mix(in srgb,var(--color-primary) 34%,transparent) 0%,color-mix(in srgb,var(--color-surface-brand) 22%,transparent) 29%,transparent 68%); filter:blur(8px); }
.lp-beacon span { position:absolute; width:140%; height:220px; left:-30%; bottom:18%; transform:rotate(-22deg); background:linear-gradient(90deg,transparent 20%,color-mix(in srgb,var(--color-primary) 19%,transparent) 42%,color-mix(in srgb,var(--color-text-primary) 12%,transparent) 50%,color-mix(in srgb,var(--color-primary) 19%,transparent) 58%,transparent 80%); filter:blur(18px); }
.lp-beacon i { position:absolute; width:42vw; height:1px; left:9%; bottom:29%; background:linear-gradient(90deg,transparent,var(--color-primary),transparent); opacity:.55; transform:rotate(-22deg); }
.lp-layout { width:min(1060px,100%); min-height:min(640px,calc(100vh - 64px)); display:grid; grid-template-columns:1.1fr .9fr; align-items:center; gap:clamp(48px,9vw,144px); }
.lp-brand { align-self:stretch; display:flex; flex-direction:column; justify-content:space-between; padding:clamp(20px,4vw,54px) 0; }
.lp-brand-lockup { display:flex; align-items:center; gap:11px; font-size:18px; letter-spacing:-.02em; }.lp-brand-lockup strong { display:block; }
.lp-mark { width:48px; height:48px; display:grid; place-items:center; border-radius:16px; background:color-mix(in srgb,var(--color-surface-brand) 80%,transparent); box-shadow:0 0 32px color-mix(in srgb,var(--color-primary) 40%,transparent),inset 0 0 0 1px color-mix(in srgb,var(--color-text-primary) 12%,transparent); }.lp-mark img { display:block; }
.lp-brand-copy { max-width:560px; }.lp-kicker { color:var(--color-text-muted); font-size:10px; font-weight:700; letter-spacing:.16em; margin:0 0 16px; }.lp-brand h1 { margin:0; max-width:540px; font-size:clamp(42px,5.5vw,68px); letter-spacing:-.065em; line-height:.98; }.lp-brand-copy > p:last-child { max-width:390px; color:var(--color-text-subtle); font-size:15px; line-height:1.65; margin:24px 0 0; }
.lp-signal { display:flex; align-items:center; gap:7px; color:var(--color-text-muted); font-size:10px; font-weight:700; letter-spacing:.13em; }.lp-signal span { width:6px; height:6px; border-radius:50%; background:var(--color-primary); box-shadow:0 0 12px var(--color-primary); }.lp-signal span:nth-child(2) { opacity:.6; }.lp-signal span:nth-child(3) { opacity:.25; }.lp-signal small { margin-left:6px; font:inherit; }
.lp-auth { width:min(390px,100%); justify-self:end; padding:16px 0 16px 34px; border-left:1px solid color-mix(in srgb,var(--color-text-primary) 14%,transparent); }.lp-auth-head { margin-bottom:30px; }.lp-auth-head .lp-kicker { margin-bottom:12px; }.lp-auth h2 { margin:0; font-size:28px; letter-spacing:-.04em; }.lp-auth-head > p:last-child { margin:9px 0 0; color:var(--color-text-subtle); font-size:13px; line-height:1.55; }
.lp-form { display:flex; flex-direction:column; gap:16px; }.lp-field { display:flex; flex-direction:column; gap:7px; }.lp-field label { color:var(--color-text-muted); font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }.lp-field input { box-sizing:border-box; width:100%; padding:12px 13px; border:1px solid var(--color-border-strong); border-radius:8px; outline:none; background:color-mix(in srgb,var(--color-surface-raised) 84%,transparent); color:var(--color-text-primary); font:inherit; font-size:14px; transition:border-color .15s,box-shadow .15s,background .15s; }.lp-field input::placeholder { color:var(--color-text-subtle); opacity:.65; }.lp-field input:focus { border-color:var(--color-primary); background:var(--color-surface-raised); box-shadow:0 0 0 3px color-mix(in srgb,var(--color-primary) 20%,transparent); }
.lp-primary { width:100%; min-height:48px; border:0; border-radius:8px; background:var(--color-primary); color:var(--color-text-on-primary); font:inherit; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 10px 26px color-mix(in srgb,var(--color-primary) 28%,transparent); transition:transform .15s,background .15s,box-shadow .15s; }.lp-primary:hover:not(:disabled) { background:var(--color-primary-hover); transform:translateY(-1px); box-shadow:0 14px 30px color-mix(in srgb,var(--color-primary) 38%,transparent); }.lp-primary:disabled { cursor:not-allowed; opacity:.55; }.lp-microsoft { display:flex; align-items:center; justify-content:center; gap:11px; }
.lp-link,.lp-emergency-link { align-self:flex-start; padding:0; border:0; background:none; color:var(--color-text-subtle); cursor:pointer; font:inherit; font-size:12px; text-decoration:underline; text-underline-offset:3px; }.lp-link { align-self:center; margin-top:2px; }.lp-link:hover,.lp-emergency-link:hover { color:var(--color-text-primary); }.lp-emergency-link { margin-top:34px; color:var(--color-text-muted); font-size:11px; }
.lp-hint { margin:-7px 0 0; color:var(--color-text-muted); font-size:11px; line-height:1.45; }.lp-emergency-note { border-left:2px solid var(--color-warning); padding:8px 0 8px 11px; color:var(--color-text-subtle); font-size:12px; line-height:1.5; }.lp-error { margin-top:18px; padding:10px 12px; border:1px solid color-mix(in srgb,var(--color-danger) 40%,transparent); border-radius:8px; background:color-mix(in srgb,var(--color-danger) 10%,transparent); color:var(--color-danger); font-size:12px; line-height:1.45; }.lp-loading { display:flex; align-items:center; gap:9px; color:var(--color-text-subtle); font-size:13px; }.lp-spinner { width:15px; height:15px; border:2px solid color-mix(in srgb,var(--color-primary) 25%,transparent); border-top-color:var(--color-primary); border-radius:50%; animation:spin .65s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .lp-primary,.lp-spinner { transition:none; animation:none; } }
@media (max-width:760px) { .lp-page { padding:24px; }.lp-layout { min-height:calc(100vh - 48px); grid-template-columns:1fr; gap:52px; }.lp-brand { min-height:250px; padding:6px 0; }.lp-brand h1 { font-size:clamp(38px,11vw,56px); }.lp-signal { display:none; }.lp-auth { width:min(430px,100%); justify-self:stretch; padding:26px 0 0; border-left:0; border-top:1px solid color-mix(in srgb,var(--color-text-primary) 14%,transparent); }.lp-beacon i { width:78vw; left:-8%; bottom:44%; } }
</style>
