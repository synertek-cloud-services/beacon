<template>
  <div class="lp-bg">
    <div class="lp-card">

      <!-- Logo -->
      <div class="lp-logo">
        <div class="lp-mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="2"/>
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.49 3.51a12 12 0 0 1 0 16.97M3.51 20.49a12 12 0 0 1 0-16.97"/>
          </svg>
        </div>
        <div>
          <div class="lp-product">Beacon RMM</div>
          <div class="lp-sub">Admin Console</div>
        </div>
      </div>

      <div class="lp-divider"></div>

      <p class="lp-lead">Sign in to access the dashboard.</p>

      <form @submit.prevent="submit" class="lp-form">
        <div class="lp-field">
          <label class="lp-label" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            class="lp-input"
            placeholder="you@example.com"
            autocomplete="username"
            autofocus
          />
        </div>

        <div class="lp-field">
          <label class="lp-label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="lp-input"
            placeholder="••••••••••••••••"
            autocomplete="current-password"
          />
        </div>

        <div v-if="error" class="lp-error">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ error }}
        </div>

        <button class="lp-btn" :disabled="loading">
          <span v-if="loading" class="lp-spinner"></span>
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <div class="lp-sso-divider"><span>or</span></div>

      <button class="lp-btn-ms" type="button" @click="signInWithMicrosoft">
        <svg width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
        Sign in with Microsoft
      </button>

      <div class="lp-footer">Beacon RMM</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { loadCurrentUser } from '../auth';

const router = useRouter();
const email    = ref('');
const password = ref('');
const error    = ref('');
const loading  = ref(false);

const SSO_ERROR_MESSAGES: Record<string, string> = {
  no_group_mapping: 'Your Microsoft account isn\'t a member of any group mapped to a Beacon role. Contact an admin.',
  email_already_registered_locally: 'That email is already registered as a local account. Contact an admin.',
  account_disabled: 'This account has been disabled. Contact an admin.',
  token_exchange_failed: 'Microsoft sign-in failed. Please try again.',
  id_token_verification_failed: 'Microsoft sign-in failed. Please try again.',
};

onMounted(() => {
  const ssoError = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('error');
  if (ssoError) error.value = SSO_ERROR_MESSAGES[ssoError] ?? 'Microsoft sign-in failed. Please try again.';
});

async function submit() {
  if (!email.value.trim() || !password.value) return;
  loading.value = true;
  error.value   = '';
  try {
    const { token } = await api.auth.login(email.value.trim(), password.value);
    api.saveToken(token);
    await loadCurrentUser().catch(() => {});
    router.push('/devices');
  } catch (e: unknown) {
    error.value = 'Invalid email or password.';
  } finally {
    loading.value = false;
  }
}

function signInWithMicrosoft() {
  window.location.href = api.auth.microsoftLoginUrl();
}
</script>

<style scoped>
/* ── Full-screen wrapper ──────────────────────────────────────── */
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

/* ── Card ─────────────────────────────────────────────────────── */
.lp-card {
  width: 100%;
  max-width: 400px;
  background: #141720;
  border: 1px solid #2d3148;
  border-radius: 14px;
  padding: 36px 36px 28px;
  box-shadow:
    0 0 0 1px rgba(78,126,247,.06),
    0 8px 32px rgba(0,0,0,.5),
    0 2px 8px rgba(0,0,0,.4);
}

/* ── Logo block ───────────────────────────────────────────────── */
.lp-logo {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}

.lp-mark {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3a6be0 0%, #4e7ef7 60%, #6a96ff 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 12px rgba(78,126,247,.45);
}

.lp-product {
  font-size: 17px;
  font-weight: 700;
  color: #d8daf0;
  letter-spacing: -.01em;
  line-height: 1.2;
}

.lp-sub {
  font-size: 11px;
  font-weight: 500;
  color: #616480;
  letter-spacing: .04em;
  text-transform: uppercase;
  margin-top: 2px;
}

/* ── Divider ──────────────────────────────────────────────────── */
.lp-divider {
  height: 1px;
  background: #232638;
  margin-bottom: 22px;
}

/* ── Lead text ────────────────────────────────────────────────── */
.lp-lead {
  font-size: 13px;
  color: #8486a8;
  margin-bottom: 22px;
  line-height: 1.55;
}

/* ── Form ─────────────────────────────────────────────────────── */
.lp-form { display: flex; flex-direction: column; gap: 16px; }

.lp-field { display: flex; flex-direction: column; gap: 6px; }

.lp-label {
  font-size: 11px;
  font-weight: 600;
  color: #616480;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.lp-input {
  width: 100%;
  padding: 10px 13px;
  background: #1c1f2e;
  border: 1px solid #2d3148;
  border-radius: 7px;
  color: #d8daf0;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
  letter-spacing: .08em;
}
.lp-input:focus {
  border-color: #4e7ef7;
  box-shadow: 0 0 0 3px rgba(78,126,247,.18);
}
.lp-input::placeholder { color: #3a3d56; letter-spacing: .04em; }

/* ── Error ────────────────────────────────────────────────────── */
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

/* ── Submit button ────────────────────────────────────────────── */
.lp-btn {
  width: 100%;
  padding: 11px;
  background: #4e7ef7;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: opacity .12s, box-shadow .12s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 2px 10px rgba(78,126,247,.4);
}
.lp-btn:hover:not(:disabled) {
  opacity: .92;
  box-shadow: 0 4px 16px rgba(78,126,247,.5);
}
.lp-btn:disabled { opacity: .45; cursor: not-allowed; }

/* Spinner */
.lp-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .65s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── SSO divider ──────────────────────────────────────────────── */
.lp-sso-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 14px;
  color: #616480;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.lp-sso-divider::before, .lp-sso-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #232638;
}

/* ── Microsoft SSO button ─────────────────────────────────────── */
.lp-btn-ms {
  width: 100%;
  padding: 10px;
  background: #1c1f2e;
  color: #d8daf0;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid #2d3148;
  border-radius: 7px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: border-color .12s, background .12s;
}
.lp-btn-ms:hover { border-color: #4e7ef7; background: #232638; }

/* ── Footer ───────────────────────────────────────────────────── */
.lp-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 11px;
  color: #3a3d56;
}
</style>
