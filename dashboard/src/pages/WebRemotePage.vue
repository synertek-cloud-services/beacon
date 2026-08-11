<template>
  <div class="wr-page">
    <div class="wr-toolbar">
      <span class="wr-title">
        Web Remote
        <span v-if="hostname" class="text-xs text-muted-2 mono" style="margin-left:8px;font-weight:400">{{ hostname }}</span>
        <span v-if="elevated" class="text-xs mono" style="margin-left:8px;font-weight:600;color:var(--color-warning)" title="An administrator PowerShell window was opened on the remote desktop — look for it if it isn't immediately visible. Use it for admin tasks rather than right-clicking something else and choosing &quot;Run as Administrator&quot;, which Beacon still can't see or interact with.">Elevated — admin shell opened</span>
      </span>
      <div class="wr-actions">
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="rfb?.sendCtrlAltDel()">Ctrl+Alt+Del</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="pasteOpen = !pasteOpen">Paste</button>
        <button class="btn btn-ghost btn-sm" :disabled="status !== 'connected'" @click="toggleFullscreen">Fullscreen</button>
        <button class="btn btn-ghost btn-sm" :disabled="!canElevate || elevating" @click="openElevateModal"
          :title="!deviceId ? 'Not available on this session — reopen Web Remote from the device page to enable Elevate' : elevated ? 'This session is already elevated' : 'Opens an administrator PowerShell window on the remote desktop — use it for admin tasks (Task Manager, Control Panel, Services, installers) instead of right-clicking Run as Administrator, which Beacon still cannot interact with'">
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
      <!-- Two targets, not one -- an Elevate attempt connects in the
           background against whichever isn't currently active, so the
           working connection never disappears while a new one is still
           being attempted. See attemptElevatedConnect's doc comment. -->
      <div ref="screenElA" class="wr-screen" :class="{ 'wr-screen-hidden': activeTarget !== 'a' }"></div>
      <div ref="screenElB" class="wr-screen" :class="{ 'wr-screen-hidden': activeTarget !== 'b' }"></div>
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

    <!-- ── Elevate modal ── -->
    <div v-if="elevateModalOpen" class="modal-backdrop" @click.self="closeElevateModal">
      <div class="modal">
        <div class="modal-head"><span class="modal-title">Elevate</span></div>
        <div class="modal-body">
          <p class="text-sm" style="margin:0 0 12px">
            Reconnects with elevated (admin) input control and opens an administrator PowerShell window on the remote desktop. Anything you run from that window — Task Manager, Control Panel, Services, an installer, the registry — runs elevated with no further prompts. Beacon still can't see or interact with Windows' own UAC dialog, so use this window rather than right-clicking something else and choosing "Run as Administrator."
          </p>

          <div class="wr-elevate-status">
            <span v-if="consoleAdminParam === '1'" class="inv-badge-ok">Logged-in user is an administrator</span>
            <span v-else-if="consoleAdminParam === '0'" class="inv-badge-warn">Logged-in user is a standard (non-admin) account</span>
            <span v-else class="inv-badge-muted">Unable to determine whether the logged-in user is an administrator</span>
          </div>
          <div class="wr-elevate-status" style="margin-top:6px">
            <span v-if="elevationStatusLoading" class="text-xs text-muted-2">Checking saved credentials…</span>
            <span v-else-if="hasElevationCredentials" class="inv-badge-ok">Saved admin credentials are configured for this company</span>
            <span v-else class="inv-badge-warn">No saved admin credentials configured for this company</span>
          </div>

          <div class="field" style="margin-top:14px">
            <label>Admin Username <span class="text-xs text-muted-2" style="text-transform:none;font-weight:400;letter-spacing:0">(one-time, not saved)</span></label>
            <input v-model="elevateUsername" placeholder="Leave blank to rely on the user's own admin rights or saved credentials" autofocus />
          </div>
          <div class="field">
            <label>Admin Password</label>
            <input v-model="elevatePassword" type="password" />
          </div>

          <div v-if="elevateError" class="error-banner" style="margin-top:12px">{{ elevateError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="closeElevateModal">Cancel</button>
          <button class="btn btn-primary" :disabled="elevating" @click="elevate">{{ elevating ? 'Elevating…' : 'Elevate' }}</button>
        </div>
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

// console_admin rides along from DeviceDetailPage.vue's openWebRemote() as a
// point-in-time snapshot of the device's latest audit -- purely
// informational text in the Elevate modal below, never the actual
// authorization decision (the agent's own GetLinkedToken check at
// elevation time is). '1'/'0'/absent, matching how elevated ('1') already
// rides the query string.
const consoleAdminParam = (route.query.console_admin as string) ?? '';

const screenWrap = ref<HTMLDivElement | null>(null);
// Two targets, not one -- see the template's own comment. rfb always
// points at whichever instance is currently active/visible; a background
// Elevate attempt gets its own instance that only becomes `rfb` once
// confirmed connected.
const screenElA = ref<HTMLDivElement | null>(null);
const screenElB = ref<HTMLDivElement | null>(null);
const activeTarget = ref<'a' | 'b'>('a');
function targetEl(t: 'a' | 'b'): HTMLDivElement { return (t === 'a' ? screenElA.value : screenElB.value)!; }
function otherTarget(t: 'a' | 'b'): 'a' | 'b' { return t === 'a' ? 'b' : 'a'; }

const rfb = shallowRef<RFB | null>(null); // shallowRef: an opaque external class instance, not a value to deep-proxy
let connectTimeout: ReturnType<typeof window.setTimeout> | null = null;
const CONNECT_TIMEOUT_MS = 70_000;

// Elevate modal state
const elevateModalOpen = ref(false);
const elevateUsername = ref('');
const elevatePassword = ref('');
const elevateError = ref('');
const hasElevationCredentials = ref(false);
const elevationStatusLoading = ref(false);

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

// Used only by the initial onMounted connect below -- the Elevate flow uses
// attemptElevatedConnect instead, which deliberately does NOT touch
// status/errorMsg while an attempt is in flight (see its own doc comment
// for why: losing the working connection before a new one is proven was
// the actual bug report this whole redesign came from).
function connectTo(wsUrl: string, target: 'a' | 'b') {
  const mySeq = ++connectionSeq;
  if (connectTimeout !== null) window.clearTimeout(connectTimeout);
  status.value = 'connecting';
  errorMsg.value = '';
  activeTarget.value = target;

  const instance = new RFB(targetEl(target), wsUrl, {});
  rfb.value = instance;

  instance.addEventListener('connect', () => {
    if (mySeq !== connectionSeq) return; // superseded by a newer connection
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    status.value = 'connected';
  });
  instance.addEventListener('disconnect', (e: any) => {
    if (mySeq !== connectionSeq) return; // the old, intentionally-torn-down instance
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

async function openElevateModal() {
  if (!canElevate || elevating.value || elevated.value) return;
  elevateUsername.value = '';
  elevatePassword.value = '';
  elevateError.value = '';
  elevateModalOpen.value = true;
  elevationStatusLoading.value = true;
  try {
    const result = await api.companies.elevationStatus(companyId);
    hasElevationCredentials.value = result.hasElevationCredentials;
  } catch {
    hasElevationCredentials.value = false; // fails closed -- just informational text either way
  } finally {
    elevationStatusLoading.value = false;
  }
}

function closeElevateModal() {
  if (elevating.value) return; // don't let a click-outside dismiss an in-flight attempt
  elevateModalOpen.value = false;
}

// attemptElevatedConnect connects a *background* RFB instance against
// target and resolves once it's actually connected, or rejects on
// failure/timeout -- it deliberately never touches the shared
// status/errorMsg refs that drive the main overlay, unlike connectTo above.
// This is what lets the currently-active connection stay fully alive and
// interactive for as long as an elevation attempt is in flight: the
// technician only ever loses the working session at the moment a *proven*
// replacement is ready to take over, addressed directly from a real report
// that a failed elevation attempt (no admin rights, no configured
// credentials) previously tore down the old connection immediately and
// left nothing behind.
function attemptElevatedConnect(wsUrl: string, target: 'a' | 'b'): Promise<RFB> {
  return new Promise((resolve, reject) => {
    const instance = new RFB(targetEl(target), wsUrl, {});
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      instance.disconnect();
      reject(new Error('Did not connect within 70 seconds. The target user may not be an administrator, or the supplied/saved credentials may be incorrect.'));
    }, CONNECT_TIMEOUT_MS);
    instance.addEventListener('connect', () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(instance);
    });
    instance.addEventListener('disconnect', (e: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(e.detail?.clean ? 'Connection closed before elevation completed.' : 'Failed to connect.'));
    });
  });
}

// Elevation is a *new* session, not an in-place upgrade of this one --
// SessionRelay is one Durable Object per session ID, so a fresh session ID
// is a fully independent relay with no risk of corrupting the running
// one's RFB byte stream.
async function elevate() {
  if (!canElevate || elevating.value || elevated.value) return;
  elevating.value = true;
  elevateError.value = '';
  const pendingTarget = otherTarget(activeTarget.value);
  try {
    const { session_id, client_ws_url } = await api.sessions.open(
      deviceId, companyId, 'screen_share', true,
      elevateUsername.value || undefined, elevatePassword.value || undefined,
    );
    const newInstance = await attemptElevatedConnect(client_ws_url, pendingTarget);

    // Proven working -- only now do we retire the old connection. Bumping
    // connectionSeq first retires the old instance's own ongoing
    // 'disconnect' handler (wired by connectTo when this session first
    // loaded) before actually disconnecting it, so that handler's async
    // event can't fire afterward and clobber the status we're about to set.
    connectionSeq++;
    rfb.value?.disconnect();

    rfb.value = newInstance;
    activeTarget.value = pendingTarget;
    elevated.value = true;
    status.value = 'connected';
    errorMsg.value = '';
    const mySeq = connectionSeq;
    newInstance.addEventListener('disconnect', (e: any) => {
      if (mySeq !== connectionSeq) return;
      status.value = e.detail?.clean ? 'closed' : 'error';
      if (!e.detail?.clean) errorMsg.value = 'Connection lost.';
    });

    elevateModalOpen.value = false;
    router.replace(
      `/remote/${session_id}?ws=${encodeURIComponent(client_ws_url)}&hostname=${encodeURIComponent(hostname)}` +
      `&device_id=${encodeURIComponent(deviceId)}&company_id=${encodeURIComponent(companyId)}&elevated=1` +
      (consoleAdminParam ? `&console_admin=${consoleAdminParam}` : '')
    );
  } catch (e: any) {
    // The original connection was never touched -- stays fully connected
    // and interactive. Error surfaces inside the still-open modal so the
    // technician can adjust credentials and retry immediately.
    elevateError.value = e.message;
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
  connectTo(wsUrl, 'a');
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
.wr-screen-hidden { visibility: hidden; pointer-events: none; }
.wr-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; background: rgba(12,14,22,.88); color: var(--color-text-primary); font-size: 13px; text-align: center; padding: 20px;
}
.wr-spinner {
  width: 22px; height: 22px; border: 2px solid var(--color-border-strong); border-top-color: var(--color-primary);
  border-radius: 50%; animation: wr-spin .8s linear infinite; margin-bottom: 8px;
}
@keyframes wr-spin { to { transform: rotate(360deg); } }

/* ── Elevate modal (duplicated per this codebase's own convention, not
   shared with the other .modal-backdrop instances elsewhere in the app) ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: var(--color-surface); border: 1px solid var(--color-border-strong);
  border-radius: 10px; width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-head { padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.modal-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--color-border); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }

.wr-elevate-status { display: flex; align-items: center; gap: 6px; }

.inv-badge-ok     { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(45,207,160,.12); color: var(--color-success); }
.inv-badge-warn   { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(240,168,64,.12);  color: var(--color-warning); }
.inv-badge-muted  { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; background: rgba(97,100,128,.15);  color: var(--color-text-muted); }
</style>
