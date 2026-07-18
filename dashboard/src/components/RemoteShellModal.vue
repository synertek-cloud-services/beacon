<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close">
      <div class="modal rs-modal">
        <div class="modal-header">
          <span class="modal-title">
            Remote Shell
            <span v-if="hostname" class="text-xs text-muted-2 mono" style="margin-left:8px;font-weight:400">{{ hostname }}</span>
          </span>
          <button class="btn-icon" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="rs-term-wrap">
          <div ref="termEl" class="rs-term"></div>
          <div v-if="status === 'connecting'" class="rs-overlay">
            <div class="rs-spinner"></div>
            <p>Connecting… this can take up to 60 seconds.</p>
            <p class="text-xs text-muted-2">The device picks up the session on its next check-in.</p>
          </div>
          <div v-else-if="status === 'closed' || status === 'error'" class="rs-overlay">
            <p>{{ status === 'error' ? (errorMsg || 'Connection error.') : 'Session ended.' }}</p>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-primary btn-sm" @click="reconnect">Reconnect</button>
              <button class="btn btn-ghost btn-sm" @click="close">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api';

const props = defineProps<{ deviceId: string; tenantId: string; hostname: string | null }>();
const emit = defineEmits<{ close: [] }>();

type Status = 'connecting' | 'connected' | 'closed' | 'error';
const status   = ref<Status>('connecting');
const errorMsg = ref('');

const termEl = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

// Sends the terminal's current size as a JSON text control frame — binary
// frames on this connection carry raw PTY bytes, matching the agent's
// binary-for-data/text-for-control split in agent/internal/session/shell.go.
function sendResize() {
  if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
}

async function openSession() {
  status.value = 'connecting';
  errorMsg.value = '';
  try {
    const { client_ws_url } = await api.sessions.open(props.deviceId, props.tenantId, 'shell');
    ws = new WebSocket(client_ws_url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { fitAddon?.fit(); sendResize(); };
    // First message of any kind flips the UI out of "connecting" — the agent
    // doesn't attach to the relay until its next check-in (up to 60s), so
    // there's no earlier signal to key off without extra relay-side plumbing.
    ws.onmessage = (ev) => {
      if (status.value === 'connecting') status.value = 'connected';
      if (typeof ev.data !== 'string') term?.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => { status.value = 'closed'; };
    ws.onerror = () => { status.value = 'error'; errorMsg.value = 'Connection error.'; };
  } catch (e: any) {
    status.value = 'error';
    errorMsg.value = e.message ?? 'Failed to open session.';
  }
}

function reconnect() {
  ws?.close();
  term?.clear();
  openSession();
}

function close() {
  emit('close');
}

onMounted(() => {
  term = new Terminal({
    fontFamily: 'var(--mono, monospace)',
    fontSize: 13,
    theme: { background: getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() || '#0c0e16' },
    cursorBlink: true,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(termEl.value!);
  fitAddon.fit();

  term.onData((str) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(str).buffer);
  });

  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit();
    sendResize();
  });
  resizeObserver.observe(termEl.value!);

  openSession();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  ws?.close();
  term?.dispose();
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65); z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--color-surface); border: 1px solid var(--color-border-strong); border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5);
  display: flex; flex-direction: column; overflow: hidden;
}
.modal-header {
  display: flex; align-items: center; padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.modal-title { flex: 1; font-weight: 600; font-size: 14px; color: var(--color-text-primary); }
.btn-icon {
  background: none; border: none; cursor: pointer; color: var(--color-text-muted); padding: 4px;
  display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s;
}
.btn-icon:hover { background: var(--color-surface-raised); color: var(--color-text-primary); }

.rs-modal { width: 860px; max-width: 92vw; height: 560px; max-height: 85vh; }
.rs-term-wrap { position: relative; flex: 1; overflow: hidden; background: var(--color-canvas); }
.rs-term { position: absolute; inset: 0; padding: 8px; }
.rs-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; background: rgba(12,14,22,.88); color: var(--color-text-primary); font-size: 13px; text-align: center; padding: 20px;
}
.rs-spinner {
  width: 22px; height: 22px; border: 2px solid var(--color-border-strong); border-top-color: var(--color-primary);
  border-radius: 50%; animation: rs-spin .8s linear infinite; margin-bottom: 8px;
}
@keyframes rs-spin { to { transform: rotate(360deg); } }
</style>
