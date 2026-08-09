<template>
  <div class="wr-page">
    <div class="wr-toolbar">
      <span class="wr-title">
        Web Remote
        <span v-if="hostname" class="text-xs text-muted-2 mono" style="margin-left:8px;font-weight:400">{{ hostname }}</span>
        <span v-if="elevated" class="text-xs mono" style="margin-left:8px;font-weight:600;color:var(--color-warning)">Elevated</span>
      </span>
      <div class="wr-actions">
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="rfb?.sendCtrlAltDel()">Ctrl+Alt+Del</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="pasteOpen = !pasteOpen">Paste</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="toggleFullscreen">Fullscreen</button>
        <button class="btn btn-ghost btn-sm" :disabled="!canElevate || elevating" @click="elevate"
          :title="!deviceId ? 'Not available on this session — reopen Web Remote from the device page to enable Elevate' : elevated ? 'This session is already elevated' : 'Reconnect with elevated (admin) input control — needed to interact with UAC prompts or other elevated windows, not just see them'">
          {{ elevating ? 'Elevating…' : 'Elevate' }}
        </button>
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
import { useRoute, useRouter } from 'vue-router';
import RFB from '@novnc/novnc';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const hostname = (route.query.hostname as string) ?? '';
// device_id/company_id are only present on links opened after the Elevate
// feature shipped (see DeviceDetailPage.vue's openWebRemote) -- a stale
// bookmarked/reloaded link from before that just disables the button below
// rather than breaking the page.
const deviceId = (route.query.device_id as string) || '';
const companyId = (route.query.company_id as string) || '';
const canElevate = !!deviceId && !!companyId;

type Status = 'connecting' | 'connected' | 'closed' | 'error';
const status = ref<Status>('connecting');
const errorMsg = ref('');
const elevated = ref(route.query.elevated === '1');
const elevating = ref(false);

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

// connectionSeq guards against a real race introduced by the Elevate
// handler below: it disconnects the *old* RFB instance and immediately
// calls connectTo() again for the new one. That old instance's own
// 'disconnect' event doesn't fire synchronously -- it arrives a moment
// later, asynchronously, by which point status.value already reads
// 'connecting' again (set by the *new* connectTo() call). Without this
// guard, the stale old instance's disconnect handler sees "connecting"
// and incorrectly concludes the *new* connection failed
// ("status.value === 'connecting'" -> 'error'/"Failed to connect."),
// even when the new connection is fine -- exactly the real bug reported
// live ("elevate goes back to trying to connect then fails"). Each
// connectTo() call captures the sequence number current at its own
// start; every listener/timeout closure it registers checks that number
// against the live one before touching any shared ref, so a superseded
// instance's events are inert no-ops once a newer connection exists.
let connectionSeq = 0;

// Shared by the initial onMounted connect and the Elevate handler below --
// both need identical event wiring (connect/disconnect listeners, the 70s
// timeout), the only difference is which WebSocket URL and which starting
// status.value they begin from.
function connectTo(wsUrl: string) {
  const mySeq = ++connectionSeq;
  if (connectTimeout !== null) window.clearTimeout(connectTimeout);
  status.value = 'connecting';
  errorMsg.value = '';

  const instance = new RFB(screenEl.value!, wsUrl, {});
  rfb.value = instance;

  instance.addEventListener('connect', () => {
    if (mySeq !== connectionSeq) return; // superseded by a newer connectTo() call
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    status.value = 'connected';
  });
  instance.addEventListener('disconnect', (e: any) => {
    if (mySeq !== connectionSeq) return; // the old, intentionally-torn-down instance -- see connectionSeq's doc comment
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
    if (mySeq !== connectionSeq) return;
    if (status.value !== 'connecting') return;
    status.value = 'error';
    errorMsg.value = 'The agent did not connect within 70 seconds. Confirm the device is online, a user is logged in, and its agent supports Web Remote.';
    instance.disconnect();
  }, CONNECT_TIMEOUT_MS);
}

// Elevation is a *new* session, not an in-place upgrade of this one --
// SessionRelay is one Durable Object per session ID, so a fresh session ID
// is a fully independent relay with no risk of corrupting the running
// one's RFB byte stream. The old (non-elevated) beacon-screenshare.exe
// process tears down cleanly once its own connection closes below, the
// same way closing this tab normally already does.
//
// If the target user isn't an administrator (or UAC is disabled), the
// elevated helper simply never launches agent-side -- there's no way for
// the worker to know that ahead of time, so this surfaces the same way
// "no active session" already does: the 70s connect timeout above, not a
// distinct error message. A real, known UX tradeoff (worse here than for
// the original connect, since the technician is actively waiting on this
// click), accepted for v1 rather than building a new failure-reporting
// round trip for one button.
async function elevate() {
  if (!canElevate || elevating.value || elevated.value) return;
  elevating.value = true;
  try {
    const { session_id, client_ws_url } = await api.sessions.open(deviceId, companyId, 'screen_share', true);
    rfb.value?.disconnect();
    elevated.value = true;
    connectTo(client_ws_url);
    router.replace(
      `/remote/${session_id}?ws=${encodeURIComponent(client_ws_url)}&hostname=${encodeURIComponent(hostname)}` +
      `&device_id=${encodeURIComponent(deviceId)}&company_id=${encodeURIComponent(companyId)}&elevated=1`
    );
  } catch (e: any) {
    status.value = 'error';
    errorMsg.value = e.message;
    elevated.value = false;
  } finally {
    elevating.value = false;
  }
}

onMounted(() => {
  const wsUrl = (route.query.ws as string) ?? '';
  if (!wsUrl) {
    status.value = 'error';
    errorMsg.value = 'Missing session connection details.';
    return;
  }
  connectTo(wsUrl);
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
