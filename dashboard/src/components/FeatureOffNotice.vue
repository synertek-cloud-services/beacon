<template>
  <div class="feat-off">
    <p class="feat-off-title">{{ name }} {{ plural ? 'are' : 'is' }} turned off</p>
    <p class="field-hint">
      {{ description }} It starts off because it does extra work on Cloudflare's free plan, and depending on your fleet size
      may need Workers Paid. Nothing is locked.
    </p>
    <RouterLink v-if="hasRole('admin')" to="/settings/features" class="btn btn-primary btn-sm">Go to Settings &rsaquo; Features</RouterLink>
    <p v-else class="field-hint">Ask an administrator to turn it on in Settings &rsaquo; Features.</p>
  </div>
</template>

<script setup lang="ts">
import { hasRole } from '../auth';
defineProps<{ name: string; description: string; plural?: boolean }>();
</script>

<style scoped>
.feat-off { padding: 18px 20px; border: 1px dashed var(--color-border-strong); border-radius: var(--r-card); background: var(--color-surface); }
.feat-off-title { margin: 0 0 6px; font-weight: 600; font-size: 14px; color: var(--color-text-primary); }
</style>
