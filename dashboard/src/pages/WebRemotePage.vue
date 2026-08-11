<template>
  <div class="wr-page">
    <div class="wr-toolbar">
      <span class="wr-title">
        Web Remote
        <span v-if="hostname" class="text-xs text-muted-2 mono" style="margin-left:8px;font-weight:400">{{ hostname }}</span>
        <span v-if="elevated" class="wr-elevated-badge" title="This session has full SYSTEM-level access, including secure Windows prompts such as UAC.">Elevated</span>
      </span>
      <div class="wr-actions">
        <!-- Keyboard shortcuts dropdown -->
        <div class="wr-kbd-wrap">
          <button class="wr-tbtn" :disabled="status !== 'connected'" title="Keyboard shortcuts" @click="toggleKbdMenu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/>
              <line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/>
              <line x1="6" y1="14" x2="18" y2="14"/>
            </svg>
          </button>
          <div v-if="kbdMenuOpen" class="wr-kbd-dropdown">
            <button v-for="k in KBD_SHORTCUTS" :key="k.label" class="wr-kbd-item" @click="k.send(); kbdMenuOpen = false">
              <span>{{ k.label }}</span>
              <span class="wr-kbd-keys mono">{{ k.keys }}</span>
            </button>
          </div>
        </div>

        <button class="wr-tbtn" :disabled="status !== 'connected'" title="Paste text into the remote session" @click="pasteOpen = !pasteOpen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="12" height="18" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
          </svg>
        </button>

        <button class="wr-tbtn" :disabled="status !== 'connected'" title="Fullscreen" @click="toggleFullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </button>

        <div class="wr-tbtn-sep"></div>

        <button class="wr-tbtn wr-elevate-btn" :disabled="!canElevate || elevating" @click="openElevateModal"
          :title="!deviceId ? 'Not available on this session — reopen Web Remote from the device page to enable Elevate' : elevated ? 'This session is already elevated' : 'Get full SYSTEM-level access, including secure Windows prompts such as UAC'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z"/>
          </svg>
          <span>{{ elevating ? 'Elevating…' : 'Elevate' }}</span>
        </button>

        <button class="wr-tbtn wr-disconnect-btn" title="Disconnect (does not power off the remote machine)" @click="disconnect">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
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
            Reconnects with full SYSTEM-level access to the machine — the same privilege level the agent itself runs with — including any secure Windows prompts (e.g. UAC) for the rest of this session. No credentials are needed.
          </p>

          <div v-if="elevateError" class="error-banner">{{ elevateError }}</div>
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

// ── Keyboard shortcuts dropdown ──────────────────────────────────────
// Same toggle-plus-one-shot-document-listener pattern DeviceDetailPage.vue's
// kebab menu already established (toggleMenu/closeMenuOnce there) -- the
// setTimeout(..., 0) defers registering the outside-click listener by one
// macrotask so the same click that opens the menu doesn't immediately
// close it again.
const kbdMenuOpen = ref(false);
function toggleKbdMenu() {
  if (kbdMenuOpen.value) {
    kbdMenuOpen.value = false;
  } else {
    kbdMenuOpen.value = true;
    setTimeout(() => document.addEventListener('click', closeKbdMenuOnce, { once: true }), 0);
  }
}
function closeKbdMenuOnce() { kbdMenuOpen.value = false; }

// X11 keysyms (matches the values noVNC/RFB itself expects -- the same
// keysymdef.h values agent/internal/x11keysym already uses server-side for
// KeyEvent injection) paired with the KeyboardEvent.code RFB.sendKey()
// also accepts. Presses each key down in order, then releases in reverse --
// the same effective sequence RFB.sendCtrlAltDel() itself performs, just
// generalized to an arbitrary key list so more than one shortcut can be
// offered instead of only Ctrl+Alt+Del.
type Key = { keysym: number; code: string };
const CTRL: Key  = { keysym: 0xffe3, code: 'ControlLeft' };
const ALT: Key   = { keysym: 0xffe9, code: 'AltLeft' };
const SHIFT: Key = { keysym: 0xffe1, code: 'ShiftLeft' };
const WIN: Key   = { keysym: 0xffeb, code: 'MetaLeft' };
const ESC: Key   = { keysym: 0xff1b, code: 'Escape' };
const TAB: Key   = { keysym: 0xff09, code: 'Tab' };
const F4: Key    = { keysym: 0xffc1, code: 'F4' };
const KEY_D: Key = { keysym: 0x64,   code: 'KeyD' };
const KEY_E: Key = { keysym: 0x65,   code: 'KeyE' };
const KEY_R: Key = { keysym: 0x72,   code: 'KeyR' };

function sendCombo(keys: Key[]) {
  if (!rfb.value) return;
  for (const k of keys) rfb.value.sendKey(k.keysym, k.code, true);
  for (const k of [...keys].reverse()) rfb.value.sendKey(k.keysym, k.code, false);
}

const KBD_SHORTCUTS = [
  { label: 'Ctrl+Alt+Delete', keys: 'Ctrl Alt Del',   send: () => rfb.value?.sendCtrlAltDel() },
  { label: 'Task Manager',    keys: 'Ctrl Shift Esc', send: () => sendCombo([CTRL, SHIFT, ESC]) },
  { label: 'Switch Windows',  keys: 'Alt Tab',        send: () => sendCombo([ALT, TAB]) },
  { label: 'Close Window',    keys: 'Alt F4',         send: () => sendCombo([ALT, F4]) },
  { label: 'Start Menu',      keys: 'Win',            send: () => sendCombo([WIN]) },
  { label: 'Show Desktop',    keys: 'Win D',          send: () => sendCombo([WIN, KEY_D]) },
  { label: 'File Explorer',   keys: 'Win E',          send: () => sendCombo([WIN, KEY_E]) },
  { label: 'Run…',            keys: 'Win R',          send: () => sendCombo([WIN, KEY_R]) },
];

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

// Applied to both new RFB() call sites (the initial connect and the Elevate
// reconnect) so windowed and fullscreen behave identically -- fullscreen is
// just the same target element growing to fill the screen (toggleFullscreen
// below calls requestFullscreen() on its wrapping .wr-screen-wrap), so one
// scaleViewport setting covers both instead of a separate fullscreen-only
// code path. Without this, noVNC's own default (scaleViewport: false) shows
// the remote framebuffer at real pixel size with scrollbars/centering
// instead of fitting the window -- reported directly: "It should be scaled
// down to fit the window... [and] Full screen has it fit fully."
//
// Deliberately NOT passed as the RFB() constructor's third argument -- a
// real bug in the first attempt at this fix, confirmed live on real
// hardware via a screenshot showing scrollbars still present after the
// "fix" had already been merged and deployed. Traced through noVNC's own
// source (core/rfb.js) rather than guessed: the constructor only ever
// reads options.credentials/shared/repeaterID/wsProtocols from its third
// argument -- scaleViewport/clipViewport are documented under "Properties"
// in API.md, a separate list, and are only actually applied via their
// setters (`set scaleViewport(...)`/`set clipViewport(...)`), which run
// _updateClip()/_updateScale() as a side effect. Passing them in the
// constructor options object is silently ignored -- no error, no warning,
// just never taking effect, which is exactly why the first attempt looked
// correct in code review and type-checked clean but did nothing live.
function applyDisplayOptions(instance: RFB) {
  instance.scaleViewport = true;
  instance.clipViewport = true;
}

// Elevate modal state
const elevateModalOpen = ref(false);
const elevateError = ref('');

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
  applyDisplayOptions(instance);
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

function openElevateModal() {
  if (!canElevate || elevating.value || elevated.value) return;
  elevateError.value = '';
  elevateModalOpen.value = true;
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
    applyDisplayOptions(instance);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      instance.disconnect();
      reject(new Error('Did not connect within 70 seconds. Confirm a user is logged in on the target device.'));
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
    const { session_id, client_ws_url } = await api.sessions.open(deviceId, companyId, 'screen_share', true);
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
      `&device_id=${encodeURIComponent(deviceId)}&company_id=${encodeURIComponent(companyId)}&elevated=1`
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
.wr-elevated-badge {
  margin-left: 8px; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px;
  background: rgba(240,168,64,.12); color: var(--color-warning); vertical-align: middle;
}
.wr-actions { display: flex; align-items: center; gap: 4px; }
.wr-tbtn-sep { width: 1px; height: 20px; background: var(--color-border-strong); margin: 0 4px; }

/* Icon toolbar buttons -- square, icon-only (Elevate is the one exception
   with a visible label, see below), consistent sizing so the row reads as
   one coherent group instead of a row of near-identical text buttons. */
.wr-tbtn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 8px; background: none; border: 1px solid transparent;
  border-radius: 6px; color: var(--color-text-muted); cursor: pointer; font-size: 12px;
  font-family: var(--font); transition: background .12s, color .12s, border-color .12s;
}
.wr-tbtn:hover:not(:disabled) { background: var(--color-surface-raised); color: var(--color-text-primary); }
.wr-tbtn:disabled { opacity: .35; cursor: not-allowed; }

.wr-elevate-btn { color: var(--color-warning); border-color: rgba(240,168,64,.3); }
.wr-elevate-btn:hover:not(:disabled) { background: rgba(240,168,64,.1); border-color: var(--color-warning); color: var(--color-warning); }

.wr-disconnect-btn:hover { background: rgba(230,90,90,.12); color: var(--color-danger); }

.wr-kbd-wrap { position: relative; }
.wr-kbd-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0;
  background: var(--color-surface); border: 1px solid var(--color-border-strong); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.4); min-width: 220px; z-index: 50; overflow: hidden; padding: 4px 0;
}
.wr-kbd-item {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%;
  padding: 8px 14px; background: none; border: none; color: var(--color-text-primary);
  font-size: 12px; font-family: var(--font); cursor: pointer; text-align: left; transition: background .1s;
}
.wr-kbd-item:hover { background: var(--color-surface-raised); }
.wr-kbd-keys { font-size: 10px; color: var(--color-text-muted); }

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
</style>
