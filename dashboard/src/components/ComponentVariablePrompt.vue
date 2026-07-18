<template>
  <div v-if="variables.length" class="cvp-list">
    <div v-for="v in variables" :key="v.id" class="cvp-row">
      <label class="cvp-label">{{ v.label }} <span v-if="v.required" class="required">*</span></label>
      <p v-if="v.description" class="cvp-desc">{{ v.description }}</p>

      <input
        v-if="v.type === 'string'"
        type="text"
        :value="values[v.name] ?? ''"
        @input="set(v.name, ($event.target as HTMLInputElement).value)"
      />
      <input
        v-else-if="v.type === 'date'"
        type="date"
        :value="values[v.name] ?? ''"
        @input="set(v.name, ($event.target as HTMLInputElement).value)"
      />
      <select
        v-else-if="v.type === 'selection'"
        :value="values[v.name] ?? ''"
        @change="set(v.name, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Select…</option>
        <option v-for="opt in v.options ?? []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <label v-else-if="v.type === 'boolean'" class="cvp-checkbox">
        <input
          type="checkbox"
          :checked="values[v.name] === 'true'"
          @change="set(v.name, ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
        />
        Enabled
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import type { ComponentVariable } from '../api';

const props = defineProps<{
  variables: ComponentVariable[];
  values: Record<string, string>;
}>();
const emit = defineEmits<{ 'update:values': [Record<string, string>] }>();

function set(name: string, value: string) {
  emit('update:values', { ...props.values, [name]: value });
}

// Seed defaults whenever the variable list changes (e.g. a new component added to the job)
watch(() => props.variables, (vars) => {
  const next = { ...props.values };
  let changed = false;
  for (const v of vars) {
    if (next[v.name] === undefined) {
      next[v.name] = v.defaultValue ?? (v.type === 'boolean' ? 'false' : '');
      changed = true;
    }
  }
  if (changed) emit('update:values', next);
}, { immediate: true, deep: true });

function validate(): string | null {
  for (const v of props.variables) {
    if (v.required && !props.values[v.name]) return `"${v.label}" is required`;
  }
  return null;
}

defineExpose({ validate });
</script>

<style scoped>
.cvp-list { display: flex; flex-direction: column; gap: 10px; }
.cvp-row { display: flex; flex-direction: column; gap: 4px; }
.cvp-label { font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.cvp-desc { font-size: 11px; color: var(--color-text-muted); margin: 0; }
.cvp-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-primary); font-weight: 400; }
.required { color: var(--color-danger); }
</style>
