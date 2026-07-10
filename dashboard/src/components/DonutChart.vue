<template>
  <div class="donut-wrap">
    <div class="donut-svg-wrap">
      <svg class="donut-svg" viewBox="0 0 110 110">
        <!-- Track -->
        <circle cx="55" cy="55" r="42" fill="none" stroke="var(--border-2)" stroke-width="9"/>
        <!-- Segments -->
        <circle
          v-for="(seg, i) in segments"
          :key="i"
          cx="55" cy="55" r="42"
          fill="none"
          :stroke="seg.color"
          stroke-width="9"
          stroke-linecap="butt"
          :stroke-dasharray="`${seg.length} ${circumference}`"
          :transform="`rotate(${-90 + seg.startDeg} 55 55)`"
        />
      </svg>
      <div class="donut-center">
        <span class="donut-center-value">{{ total }}</span>
        <span class="donut-center-label">{{ centerLabel }}</span>
      </div>
    </div>
    <div class="donut-legend">
      <div v-for="(d, i) in data" :key="i" class="legend-row">
        <span class="legend-dot" :style="{ background: d.color }"></span>
        <span class="legend-name">{{ d.label }}</span>
        <span class="legend-count">{{ d.value }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  data: { label: string; value: number; color: string }[];
  centerLabel: string;
}>();

const circumference = 2 * Math.PI * 42; // ≈ 263.9

const total = computed(() => props.data.reduce((s, d) => s + d.value, 0));

const segments = computed(() => {
  let cumulative = 0;
  return props.data.map(d => {
    const length = total.value > 0 ? (d.value / total.value) * circumference : 0;
    const startDeg = total.value > 0 ? (cumulative / circumference) * 360 : 0;
    cumulative += length;
    return { length, startDeg, color: d.color };
  });
});
</script>
