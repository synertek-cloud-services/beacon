<template>
  <div class="wr-page">
    <div class="wr-toolbar">
      <span class="wr-title">
        Web Remote
        <span v-if="hostname" class="text-xs text-muted-2 mono" style="margin-left:8px;font-weight:400">{{ hostname }}</span>
      </span>
      <div class="wr-actions">
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="rfb?.sendCtrlAltDel()">Ctrl+Alt+Del</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="pasteOpen = !pasteOpen">Paste</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="toggleFullscreen">Fullscreen</button>
        <button class="btn btn-ghost btn-sm" @click="disconnect">Disconnect</button>
      </div>
    </div>

    <div v-if="pasteOpen" class="wr-paste-bar">
      <input v-model="pasteText" class="wr-paste-input" placeholder="Text to paste into the remote session…" @keydown.enter="sendPaste" />
      <button class="btn btn-primary btn-sm" @click="sendPaste">Send</button>
      <button class="btn btn-ghost btn-sm" @click="pasteOpen = false">Cancel</button>
    </div>

    <div ref="screenWrap" class="wr-screen-wrap">
      <div ref="screenEl" class="wr-screen"></div>
      <div v-if="status === 'connecting'" class="wr-overlay">
        <div class="wr-spinner"></div>
        <p>Connecting… this can take up to 60 seconds.</p>
        <p class="text-xs text-muted-2">The device picks up the session on its next check-in.</p>
      </div>
      <div v-else-if="status === 'closed' || status === 'error'" class="wr-overlay">
        <p>{{ status === 'error' ? (errorMsg || 'Connection error.') : 'Session ended.' }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="closeTab">Close Tab</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import RFB from '@novnc/novnc';

const route = useRoute();
const wsUrl = (route.query.ws as string) ?? '';
const hostname = (route.query.hostname as string) ?? '';

type Status = 'connecting' | 'connected' | 'closed' | 'error';
const status = ref<Status>('connecting');
const errorMsg = ref('');

const pasteOpen = ref(false);
const pasteText = ref('');

const screenWrap = ref<HTMLDivElement | null>(null);
const screenEl = ref<HTMLDivElement | null>(null);
const rfb = shallowRef<RFB | null>(null); // shallowRef: an opaque external class instance, not a value to deep-proxy
let connectTimeout: ReturnType<typeof window.setTimeout> | null = null;
const CONNECT_TIMEOUT_MS = 70_000;

function sendPaste() {
  if (!rfb.value || !pasteText.value) return;
  rfb.value.clipboardPasteFrom(pasteText.value);
  pasteText.value = '';
  pasteOpen.value = false;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    screenWrap.value?.requestFullscreen();
  }
}

function disconnect() {
  // Matches this app's own hard-won close-code discipline (a bare
  // WebSocket close produces reserved code 1005, which the relay can't
  // forward to the agent peer) -- rfb.disconnect() is noVNC's own clean
  // close path, the only one available here since noVNC owns the
  // underlying WebSocket internally, not this component.
  rfb.value?.disconnect();
  closeTab();
}

function closeTab() {
  window.close();
}

onMounted(() => {
  if (!wsUrl) {
    status.value = 'error';
    errorMsg.value = 'Missing session connection details.';
    return;
  }

  rfb.value = new RFB(screenEl.value!, wsUrl, {});

  rfb.value.addEventListener('connect', () => {
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    status.value = 'connected';
  });
  rfb.value.addEventListener('disconnect', (e: any) => {
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    if (status.value === 'connecting') {
      status.value = 'error';
      errorMsg.value = 'Failed to connect.';
    } else {
      status.value = e.detail?.clean ? 'closed' : 'error';
      if (!e.detail?.clean) errorMsg.value = 'Connection lost.';
    }
  });

  connectTimeout = window.setTimeout(() => {
    if (status.value !== 'connecting') return;
    status.value = 'error';
    errorMsg.value = 'The agent did not connect within 70 seconds. Confirm the device is online, a user is logged in, and its agent supports Web Remote.';
    rfb.value?.disconnect();
  }, CONNECT_TIMEOUT_MS);
});

onUnmounted(() => {
  if (connectTimeout !== null) window.clearTimeout(connectTimeout);
  rfb.value?.disconnect();
});
</script>

<style scoped>
.wr-page {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: var(--color-canvas); color: var(--color-text-primary);
}
.wr-toolbar {
  display: flex; align-items: center; gap: 12px; padding: 10px 16px;
  border-bottom: 1px solid var(--color-border); flex-shrink: 0;
  background: var(--color-surface);
}
.wr-title { flex: 1; font-weight: 600; font-size: 14px; }
.wr-actions { display: flex; gap: 8px; }

.wr-paste-bar {
  display: flex; gap: 8px; align-items: center; padding: 8px 16px;
  border-bottom: 1px solid var(--color-border); background: var(--color-surface-raised);
  flex-shrink: 0;
}
.wr-paste-input {
  flex: 1; background: var(--color-canvas); border: 1px solid var(--color-border);
  border-radius: 6px; padding: 6px 10px; color: var(--color-text-primary); font-size: 13px;
}

.wr-screen-wrap { position: relative; flex: 1; overflow: auto; background: #000; }
.wr-screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.wr-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; background: rgba(12,14,22,.88); color: var(--color-text-primary); font-size: 13px; text-align: center; padding: 20px;
}
.wr-spinner {
  width: 22px; height: 22px; border: 2px solid var(--color-border-strong); border-top-color: var(--color-primary);
  border-radius: 50%; animation: wr-spin .8s linear infinite; margin-bottom: 8px;
}
@keyframes wr-spin { to { transform: rotate(360deg); } }
</style>
