<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">Devices</h1>
      <button class="btn btn-ghost btn-sm" @click="load">Refresh</button>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="tab"
        :class="{ active: activeTab === tab.value }"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
        <span class="tab-count">{{ countFor(tab.value) }}</span>
      </button>
    </div>

    <div v-if="loading" class="empty"><p>Loading…</p></div>

    <div v-else-if="visibleDevices.length === 0" class="empty">
      <strong>No {{ activeTab }} devices</strong>
      <p v-if="activeTab === 'pending'">Devices appear here after enrolling with an enrollment token.</p>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>OS</th>
            <th>Class</th>
            <th>Agent</th>
            <th>Last seen</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in visibleDevices" :key="d.id">
            <td>
              <span class="mono">{{ d.hostname ?? '—' }}</span>
            </td>
            <td class="text-muted">{{ osLabel(d) }}</td>
            <td class="text-muted text-sm">{{ effectiveClass(d) ?? '—' }}</td>
            <td class="text-muted text-sm mono">{{ d.agentVersion ?? '—' }}</td>
            <td class="text-muted text-sm">{{ lastSeenLabel(d.lastSeen) }}</td>
            <td><span :class="`badge badge-${d.status}`">{{ d.status }}</span></td>
            <td>
              <div class="actions">
                <button
                  v-if="d.status === 'pending'"
                  class="btn btn-primary btn-sm"
                  :disabled="busy === d.id"
                  @click="approve(d.id)"
                >Approve</button>
                <button
                  v-if="d.status === 'approved'"
                  class="btn btn-danger btn-sm"
                  :disabled="busy === d.id"
                  @click="revoke(d.id)"
                >Revoke</button>
                <button
                  v-if="d.status === 'revoked'"
                  class="btn btn-ghost btn-sm"
                  :disabled="busy === d.id"
                  @click="approve(d.id)"
                >Re-approve</button>
                <button
                  v-if="d.status === 'revoked'"
                  class="btn btn-danger btn-sm"
                  :disabled="busy === d.id"
                  @click="remove(d.id)"
                >Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, type Device } from '../api';

const devices = ref<Device[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref<string | null>(null);
const activeTab = ref<'all' | 'pending' | 'approved' | 'revoked'>('all');

const tabs = [
  { label: 'All',      value: 'all' as const },
  { label: 'Pending',  value: 'pending' as const },
  { label: 'Approved', value: 'approved' as const },
  { label: 'Revoked',  value: 'revoked' as const },
];

const visibleDevices = computed(() =>
  activeTab.value === 'all' ? devices.value : devices.value.filter(d => d.status === activeTab.value)
);

function countFor(tab: typeof activeTab.value) {
  return tab === 'all' ? devices.value.length : devices.value.filter(d => d.status === tab).length;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    devices.value = await api.devices.list();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function approve(id: string) {
  busy.value = id;
  try {
    await api.devices.approve(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'approved';
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = null;
  }
}

async function revoke(id: string) {
  busy.value = id;
  try {
    await api.devices.revoke(id);
    const d = devices.value.find(x => x.id === id);
    if (d) d.status = 'revoked';
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = null;
  }
}

async function remove(id: string) {
  busy.value = id;
  try {
    await api.devices.delete(id);
    devices.value = devices.value.filter(x => x.id !== id);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = null;
  }
}

function effectiveClass(d: Device) {
  return d.overrideClass ?? d.detectedClass;
}

function osLabel(d: Device) {
  if (!d.osType) return '—';
  return d.osVersion ? `${d.osType} ${d.osVersion}` : d.osType;
}

function lastSeenLabel(ts: number | null) {
  if (!ts) return 'Never';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 90) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

onMounted(load);
</script>
