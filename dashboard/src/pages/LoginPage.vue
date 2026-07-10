<template>
  <div class="login-card">
    <h1>Bea<span>con</span></h1>
    <p>Enter your admin secret to continue.</p>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="secret">Admin Secret</label>
        <input id="secret" v-model="secret" type="password" placeholder="beacon-local-admin-secret" autocomplete="current-password" />
      </div>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <button class="btn btn-primary" style="width:100%" :disabled="loading">
        {{ loading ? 'Checking…' : 'Sign in' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const secret = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  if (!secret.value.trim()) return;
  loading.value = true;
  error.value = '';
  api.saveSecret(secret.value.trim());
  try {
    // Verify the secret works by hitting a protected endpoint
    await api.devices.list();
    router.push('/devices');
  } catch (e: any) {
    api.clearSecret();
    error.value = e.message === 'unauthorized' ? 'Incorrect secret.' : e.message;
  } finally {
    loading.value = false;
  }
}
</script>
