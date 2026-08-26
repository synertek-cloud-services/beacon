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

        <!-- Displays picker (multi-monitor) -- hidden entirely for the
             common single-monitor case, only rendered once the per-session
             helper has actually reported more than one display. Reworked
             from a plain text list into a real-position, proportionally-
             scaled layout after direct feedback: "why can't we just show
             both displays with the one currently selected with a green
             border... there is too much text here" -- matches how Windows'
             own Display Settings "Identify" arrangement view works, and
             the real x/y/width/height data (already reported) makes an
             accurate layout free, not just a evenly-spaced guess. The
             toolbar button itself went back to icon-only (matching every
             other button in this row) once the dropdown's own visual
             layout became the one place "which display am I on" is
             answered -- a text label on the button was redundant with it. -->
        <div v-if="displays.length > 1" class="wr-kbd-wrap">
          <button class="wr-tbtn" :disabled="status !== 'connected' || switchingDisplay" title="Switch display" @click="toggleDisplaysMenu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </button>
          <div v-if="displaysMenuOpen" class="wr-kbd-dropdown wr-display-picker">
            <div class="wr-display-canvas" :style="{ width: DISPLAY_CANVAS_WIDTH + 'px', height: DISPLAY_CANVAS_HEIGHT + 'px' }">
              <button
                v-for="d in displayLayout" :key="d.device_name"
                class="wr-display-box"
                :class="{ 'wr-display-box-active': d.device_name === currentMonitorName }"
                :style="{ left: d.left + 'px', top: d.top + 'px', width: d.boxWidth + 'px', height: d.boxHeight + 'px' }"
                :title="`Display ${d.index + 1}${d.primary ? ' (Primary)' : ''}`"
                @click="switchDisplay(d.device_name)"
              >{{ d.index + 1 }}</button>
            </div>
          </div>
        </div>

        <!-- Transfer Files dropdown -- Upload/Download, matching the
             toolbar-icon-then-choice flow described directly from real
             Datto RMM usage. Upload triggers the hidden file input below
             immediately (a browser's own local file picker); Download
             opens the remote directory browser modal. -->
        <div class="wr-kbd-wrap">
          <button class="wr-tbtn" :disabled="status !== 'connected'" title="Transfer files" @click="toggleFilesMenu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </button>
          <div v-if="filesMenuOpen" class="wr-kbd-dropdown">
            <button class="wr-kbd-item" @click="filesMenuOpen = false; fileInput?.click()">
              <span>Upload File…</span>
            </button>
            <button class="wr-kbd-item" @click="filesMenuOpen = false; openBrowseModal()">
              <span>Download File…</span>
            </button>
          </div>
        </div>
        <input ref="fileInput" type="file" style="display:none" @change="onUploadFileChosen" />

        <button class="wr-tbtn" :disabled="status !== 'connected'" title="Paste your clipboard into the remote session" @click="onPasteClick">
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

    <div v-if="displaysError" class="wr-toast" @click="displaysError = ''">{{ displaysError }} (click to dismiss)</div>
    <div v-if="fileTransferStatus" class="wr-toast" :class="{ 'wr-toast-ok': !fileTransferError }" @click="fileTransferStatus = ''; fileTransferError = false">
      {{ fileTransferStatus }} (click to dismiss)
    </div>
    <div v-if="pasteStatus" class="wr-toast" :class="{ 'wr-toast-ok': pasteStatusOk }" @click="pasteStatus = ''">
      {{ pasteStatus }} (click to dismiss)
    </div>

    <!-- Fallback only -- shown when a direct clipboard read fails (denied
         permission, unsupported browser, non-secure context). The normal
         path is onPasteClick sending straight from navigator.clipboard with
         no box at all. -->
    <div v-if="pasteOpen" class="wr-paste-bar">
      <input ref="pasteInputEl" v-model="pasteText" class="wr-paste-input" placeholder="Clipboard read failed -- type text to paste instead…" @keydown.enter="sendPaste" />
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
        <div v-if="elevating" class="modal-body wr-elevate-loading">
          <div class="wr-spinner"></div>
          <p class="text-sm text-muted-2">Elevating… this can take up to a minute.</p>
        </div>
        <div v-else class="modal-body">
          <p class="text-sm" style="margin:0">
            Full SYSTEM-level access for the rest of this session, including secure Windows prompts like UAC. No credentials needed.
          </p>
          <div v-if="elevateError" class="error-banner" style="margin-top:12px">{{ elevateError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" :disabled="elevating" @click="closeElevateModal">Cancel</button>
          <button class="btn btn-primary" :disabled="elevating" @click="elevate">{{ elevating ? 'Elevating…' : 'Elevate' }}</button>
        </div>
      </div>
    </div>

    <!-- ── Download: remote directory browser modal ── -->
    <div v-if="browseOpen" class="modal-backdrop" @click.self="browseOpen = false">
      <div class="modal wr-browse-modal">
        <div class="modal-head">
          <span class="modal-title">Download File</span>
        </div>
        <div class="modal-body">
          <div class="wr-browse-path">
            <button class="btn btn-ghost btn-sm" :disabled="browsePath === ''" @click="browseUp">↑ Up</button>
            <span class="mono text-xs text-muted-2" style="margin-left:8px">{{ browsePath || 'Drives' }}</span>
          </div>
          <div v-if="browseLoading" class="wr-browse-loading">
            <div class="wr-spinner"></div>
          </div>
          <div v-else-if="browseError" class="error-banner">{{ browseError }}</div>
          <div v-else class="wr-browse-list">
            <div v-if="browseEntries.length === 0" class="text-xs text-muted-2" style="padding:12px">Empty.</div>
            <button v-for="e in browseEntries" :key="e.name" class="wr-browse-row" @click="onBrowseEntryClick(e)">
              <svg v-if="e.is_dir" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{{ e.name }}</span>
              <span v-if="!e.is_dir" class="text-xs text-muted-2" style="margin-left:auto">{{ formatBytes(e.size_bytes) }}</span>
            </button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="browseOpen = false">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import RFB from '@novnc/novnc';
import { api } from '../api';
import type { SessionDisplay, SessionFileEntry } from '../api';

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
// Which WTS session this connection targets on a Server-class device --
// undefined means the console session (today's only behavior on
// client-class devices). Rides the query string the same way elevated/
// device_id/company_id already do, so a later Elevate reconnect (below)
// can pass the SAME target session through instead of silently resetting
// back to console.
const targetSessionIdParam = route.query.target_session_id as string | undefined;
const targetSessionId = targetSessionIdParam !== undefined ? Number(targetSessionIdParam) : undefined;

type Status = 'connecting' | 'connected' | 'closed' | 'error';
const status = ref<Status>('connecting');
const errorMsg = ref('');
const elevated = ref(route.query.elevated === '1');
const elevating = ref(false);

const pasteOpen = ref(false);
const pasteText = ref('');
const pasteInputEl = ref<HTMLInputElement | null>(null);
const pasteStatus = ref('');
const pasteStatusOk = ref(false);

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

// ── Displays (multi-monitor) ──────────────────────────────────────────
const displays = ref<SessionDisplay[]>([]);
const displaysMenuOpen = ref(false);
const switchingDisplay = ref(false);
const displaysError = ref('');
// Which display's device_name is currently being viewed -- reported
// directly from real usage: switching monitors worked, but nothing showed
// which one you were actually on. Empty string means "not yet known"
// (before the helper's own displays report arrives) or "primary" (the
// agent's own default when no explicit monitor was requested, which is
// every initial connection's actual starting state -- there is no
// initial-connect monitor picker, only the in-session switcher below).
const currentMonitorName = ref('');

// The visual display picker's fixed preview area -- every display's real
// x/y/width/height (already reported by the helper) is scaled down to fit
// inside this box, preserving relative position and aspect ratio, so a
// side-by-side or stacked real-world arrangement actually looks like one
// instead of an arbitrary evenly-spaced list.
const DISPLAY_CANVAS_WIDTH = 260;
const DISPLAY_CANVAS_HEIGHT = 130;
const DISPLAY_CANVAS_PADDING = 8;
const displayLayout = computed(() => {
  if (displays.value.length === 0) return [];
  const minX = Math.min(...displays.value.map(d => d.x));
  const minY = Math.min(...displays.value.map(d => d.y));
  const maxX = Math.max(...displays.value.map(d => d.x + d.width));
  const maxY = Math.max(...displays.value.map(d => d.y + d.height));
  const totalW = maxX - minX;
  const totalH = maxY - minY;
  const usableW = DISPLAY_CANVAS_WIDTH - DISPLAY_CANVAS_PADDING * 2;
  const usableH = DISPLAY_CANVAS_HEIGHT - DISPLAY_CANVAS_PADDING * 2;
  // totalW/totalH are never 0 in practice (a real monitor always has a
  // positive width/height), but guard anyway rather than risk dividing by
  // zero if a future helper ever reports a degenerate rect.
  const scale = Math.min(
    totalW > 0 ? usableW / totalW : 1,
    totalH > 0 ? usableH / totalH : 1,
  );
  // Center the whole scaled arrangement within the canvas -- totalW/totalH
  // scaled rarely exactly fill usableW/usableH (aspect ratios differ), so
  // without this the layout sits flush top-left instead of looking
  // balanced.
  const offsetX = DISPLAY_CANVAS_PADDING + (usableW - totalW * scale) / 2;
  const offsetY = DISPLAY_CANVAS_PADDING + (usableH - totalH * scale) / 2;
  return displays.value.map(d => ({
    ...d,
    left: (d.x - minX) * scale + offsetX,
    top: (d.y - minY) * scale + offsetY,
    boxWidth: d.width * scale,
    boxHeight: d.height * scale,
  }));
});

function toggleDisplaysMenu() {
  if (displaysMenuOpen.value) {
    displaysMenuOpen.value = false;
  } else {
    displaysMenuOpen.value = true;
    setTimeout(() => document.addEventListener('click', closeDisplaysMenuOnce, { once: true }), 0);
  }
}
function closeDisplaysMenuOnce() { displaysMenuOpen.value = false; }

// Polls GET /v1/sessions/:id/displays a handful of times after a session
// opens -- the per-session screen_share helper reports its enumerated
// monitors independently of the browser's own RFB connection (GDI
// enumeration is near-instant, unlike waiting on a check-in cycle), so
// this stops as soon as it's populated rather than waiting out a fixed
// delay. Never surfaces an error to the technician -- a single-monitor
// session (the common case) or a helper that never reports for any
// reason just means no switcher appears, not a broken page.
async function pollDisplaysFor(sessionId: string) {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      const result = await api.sessions.displays(sessionId);
      if (result.displays.length > 0) {
        displays.value = result.displays;
        // Seed the current-display indicator to whichever one the agent
        // actually defaulted to -- the primary monitor, since there's no
        // initial-connect monitor picker (only the in-session switcher).
        // Never overwrites an already-known value: this poll can in
        // principle resolve after a technician has already switched
        // displays once (a slow initial report racing a fast manual
        // switch), and a real switch's own result must always win over a
        // guessed initial default.
        if (!currentMonitorName.value) {
          currentMonitorName.value = result.displays.find(d => d.primary)?.device_name ?? result.displays[0].device_name;
        }
        return;
      }
    } catch {
      return; // e.g. a superseded session id -- stop polling silently
    }
  }
}

// ── File transfer (Upload/Download) ─────────────────────────────────────
// Toolbar icon -> Upload/Download -> a file picker, matching Datto RMM's
// own flow described directly from real usage. Upload is a straight
// browser file picker + POST, landing on the target session's logged-on
// user's Desktop server-side (see beacon-screenshare.exe's own
// resolveDesktopPath) -- no destination picker needed. Download needs a
// remote directory browser (browseOpen and friends below), since there's
// no other way to know what files exist on a machine the technician isn't
// physically at.
const filesMenuOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const fileTransferStatus = ref('');
const fileTransferError = ref(false);

function toggleFilesMenu() {
  if (filesMenuOpen.value) {
    filesMenuOpen.value = false;
  } else {
    filesMenuOpen.value = true;
    setTimeout(() => document.addEventListener('click', closeFilesMenuOnce, { once: true }), 0);
  }
}
function closeFilesMenuOnce() { filesMenuOpen.value = false; }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// pollFileRequest polls GET .../file-requests/:id until it's no longer
// pending -- shared by both the browse (directory listing) and download
// (fetch a specific file) flows below, both of which go through the same
// technician-facing request/poll/result shape (see
// worker/src/routes/sessions.ts's own "Web Remote file transfer" section).
async function pollFileRequest(sessionId: string, reqId: string): Promise<{ result: any }> {
  for (let i = 0; i < 30; i++) {
    const r = await api.sessions.fileRequests.get(sessionId, reqId);
    if (r.status === 'completed') return { result: r.result };
    if (r.status === 'failed') throw new Error(r.error || 'request failed');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('timed out waiting for the device to respond');
}

async function onUploadFileChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file next time
  if (!file) return;

  fileTransferError.value = false;
  fileTransferStatus.value = `Uploading ${file.name}…`;
  try {
    const sessionId = route.params.sessionId as string;
    const { id } = await api.sessions.files.upload(sessionId, file);
    await pollFileRequest(sessionId, id);
    fileTransferStatus.value = `${file.name} uploaded to the remote Desktop.`;
  } catch (e: any) {
    fileTransferError.value = true;
    fileTransferStatus.value = `Upload failed: ${e.message}`;
  }
}

// ── Download: remote directory browser ──────────────────────────────────
const browseOpen = ref(false);
const browsePath = ref('');
const browseEntries = ref<SessionFileEntry[]>([]);
const browseLoading = ref(false);
const browseError = ref('');

function openBrowseModal() {
  browseOpen.value = true;
  browsePath.value = '';
  loadBrowseEntries('');
}

async function loadBrowseEntries(path: string) {
  browseLoading.value = true;
  browseError.value = '';
  try {
    const sessionId = route.params.sessionId as string;
    const { id } = await api.sessions.fileRequests.create(sessionId, 'browse', path);
    const { result } = await pollFileRequest(sessionId, id);
    const entries: SessionFileEntry[] = result?.entries ?? [];
    // Directories first, then files, alphabetically within each group --
    // matches how a normal OS file browser sorts.
    entries.sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1));
    browseEntries.value = entries;
  } catch (e: any) {
    browseError.value = e.message;
  } finally {
    browseLoading.value = false;
  }
}

// joinPath mirrors Windows' own backslash-joined path convention (this
// feature is Windows-only, matching every other agent capability in this
// codebase's screencapture/screeninject/rfbserver chain). Drive-root
// entries (e.g. "C:\") already carry a trailing separator, so joining at
// the true root is just the entry name itself, not root + "\" + name.
function joinPath(base: string, name: string): string {
  if (base === '') return name;
  return base.replace(/\\+$/, '') + '\\' + name;
}

function onBrowseEntryClick(entry: SessionFileEntry) {
  const fullPath = joinPath(browsePath.value, entry.name);
  if (entry.is_dir) {
    browsePath.value = fullPath;
    loadBrowseEntries(fullPath);
    return;
  }
  downloadRemoteFile(fullPath, entry.name);
}

function browseUp() {
  if (browsePath.value === '') return;
  // Strip exactly one trailing path component. Stripping any trailing
  // backslash first before searching handles a drive root ("C:\") for
  // free: trimming it down to "C:" leaves lastIndexOf('\\') at -1, and
  // slice(0, -1 + 1) is slice(0, 0) = "" -- the true root (drive list) --
  // with no separate special case needed for that specific depth.
  const trimmed = browsePath.value.replace(/\\+$/, '');
  const idx = trimmed.lastIndexOf('\\');
  const parent = trimmed.slice(0, idx + 1);
  browsePath.value = parent;
  loadBrowseEntries(parent);
}

async function downloadRemoteFile(path: string, filename: string) {
  browseOpen.value = false;
  fileTransferError.value = false;
  fileTransferStatus.value = `Fetching ${filename} from the remote machine…`;
  try {
    const sessionId = route.params.sessionId as string;
    const { id } = await api.sessions.fileRequests.create(sessionId, 'download', path);
    await pollFileRequest(sessionId, id);
    await api.sessions.files.download(sessionId, id, filename);
    fileTransferStatus.value = `${filename} downloaded.`;
  } catch (e: any) {
    fileTransferError.value = true;
    fileTransferStatus.value = `Download failed: ${e.message}`;
  }
}

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

// Primary path: read the technician's real OS clipboard directly and send
// it straight to the remote session, no separate box to type into. Must be
// called synchronously from a real click handler (not from inside an
// awaited callback) -- navigator.clipboard.readText() only works as a
// direct response to a user gesture, which this button click is.
async function onPasteClick() {
  if (!rfb.value) return;
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      pasteStatusOk.value = false;
      pasteStatus.value = 'Clipboard is empty.';
      return;
    }
    rfb.value.clipboardPasteFrom(text);
    pasteStatusOk.value = true;
    pasteStatus.value = 'Pasted from clipboard.';
  } catch {
    // Permission denied, unsupported browser, or a non-secure context --
    // fall back to the manual box rather than failing silently, and focus
    // it immediately so a real Ctrl+V actually lands in the field instead
    // of going to the remote canvas, which had no focus target before and
    // is very likely why the old box looked broken.
    pasteOpen.value = true;
    await nextTick();
    pasteInputEl.value?.focus();
  }
}

function sendPaste() {
  if (!rfb.value || !pasteText.value) return;
  rfb.value.clipboardPasteFrom(pasteText.value);
  pasteText.value = '';
  pasteOpen.value = false;
  pasteStatusOk.value = true;
  pasteStatus.value = 'Pasted from clipboard.';
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
function connectTo(wsUrl: string, target: 'a' | 'b', sessionId: string) {
  const mySeq = ++connectionSeq;
  if (connectTimeout !== null) window.clearTimeout(connectTimeout);
  status.value = 'connecting';
  errorMsg.value = '';
  activeTarget.value = target;

  const instance = new RFB(targetEl(target), wsUrl, {});
  applyDisplayOptions(instance);
  rfb.value = instance;

  pollConsent(sessionId, instance, (message) => {
    if (mySeq !== connectionSeq) return;
    if (status.value !== 'connecting') return;
    if (connectTimeout !== null) window.clearTimeout(connectTimeout);
    status.value = 'error';
    errorMsg.value = message;
    instance.disconnect();
  });

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

// pollConsent (issue #86) polls GET /v1/sessions/:id/consent while a
// connection attempt is still pending, so a decline/timeout surfaces
// immediately instead of waiting out the full 70s generic connect timeout.
// Always safe to start: status stays null (this just keeps quietly
// polling) unless the company/device policy actually required consent for
// this dispatch. Stops itself the moment the instance connects or
// disconnects for any other reason, or once consent resolves either way --
// never leaks an interval past the one attempt it was started for.
function pollConsent(sessionId: string, instance: RFB, onDeclined: (message: string) => void) {
  const iv = window.setInterval(async () => {
    try {
      const { status: consentStatus } = await api.sessions.consent(sessionId);
      if (consentStatus === 'declined' || consentStatus === 'timed_out') {
        window.clearInterval(iv);
        onDeclined(consentStatus === 'declined'
          ? 'The user declined remote access.'
          : 'No response — the remote-access prompt timed out.');
      } else if (consentStatus === 'accepted') {
        window.clearInterval(iv); // resolved, nothing further to watch for
      }
    } catch { /* transient poll failure -- try again next tick */ }
  }, 2000);
  instance.addEventListener('connect', () => window.clearInterval(iv));
  instance.addEventListener('disconnect', () => window.clearInterval(iv));
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
function attemptElevatedConnect(wsUrl: string, target: 'a' | 'b', sessionId: string): Promise<RFB> {
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
    pollConsent(sessionId, instance, (message) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      instance.disconnect();
      reject(new Error(message));
    });
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
    const { session_id, client_ws_url } = await api.sessions.open(deviceId, companyId, 'screen_share', {
      elevated: true, targetSessionId,
    });
    const newInstance = await attemptElevatedConnect(client_ws_url, pendingTarget, session_id);

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
      (targetSessionId !== undefined ? `&target_session_id=${targetSessionId}` : '')
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

// switchDisplay requests an in-place monitor switch on the *same*,
// already-open session -- no reconnect, no new session, no dual-target
// swap. Supersedes the original design (opening a whole new session per
// switch, reusing elevate()'s own dual-target reconnect mechanism) --
// real-hardware testing found that took 10+ seconds per switch, an
// inherent floor from a fresh relay Durable Object plus the
// check-in-cycle-bound open_session dispatch, unacceptable for what
// should be a near-instant local operation. The already-running
// beacon-screenshare.exe helper polls for this change on its own ~1s
// interval and swaps its live Capturer/Injector, pushing an RFB
// DesktopSize update the existing RFB connection already open in this tab
// picks up automatically -- see agent/internal/rfbserver's SwitchRequest
// and worker/src/routes/sessions.ts's own doc comment on
// POST .../switch-monitor.
//
// route.params.sessionId is read live (not cached in a local var) so this
// keeps working correctly after an Elevate reconnect, which does still
// change the session ID via its own router.replace().
async function switchDisplay(deviceName: string) {
  if (switchingDisplay.value) return;
  switchingDisplay.value = true;
  displaysMenuOpen.value = false;
  displaysError.value = '';
  try {
    await api.sessions.switchMonitor(route.params.sessionId as string, deviceName);
    currentMonitorName.value = deviceName;
    // No reliable client-side "the resize actually landed" signal exists
    // to wait on -- confirmed by reading noVNC's own source (core/rfb.js's
    // _resize()) that it dispatches no public event for this. The real
    // round trip (this POST, then the helper's own poll interval, then a
    // fresh capture, then the WS message arriving) is well under this
    // window in practice; a fixed, generous "Switching…" indicator is a
    // known, accepted tradeoff rather than a second polling loop just to
    // confirm something the technician can already see happen on screen.
    await new Promise(resolve => setTimeout(resolve, 2500));
  } catch (e: any) {
    displaysError.value = e.message;
  } finally {
    switchingDisplay.value = false;
  }
}

onMounted(() => {
  const wsUrl = (route.query.ws as string) ?? '';
  if (!wsUrl) {
    status.value = 'error';
    errorMsg.value = 'Missing session connection details.';
    return;
  }
  const initialSessionId = route.params.sessionId as string;
  connectTo(wsUrl, 'a', initialSessionId);
  if (initialSessionId) pollDisplaysFor(initialSessionId);
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

/* Visual display picker -- see the template's own comment for why this
   replaced a plain text list. .wr-display-canvas is the fixed-size
   preview area displayLayout's computed positions are scaled to fit
   inside; each .wr-display-box is one real monitor, absolutely
   positioned/sized to match its real, proportional arrangement. */
.wr-display-picker { padding: 10px; }
.wr-display-canvas { position: relative; margin: 0 auto; background: var(--color-canvas); border-radius: 6px; border: 1px solid var(--color-border); }
.wr-display-box {
  position: absolute; display: flex; align-items: center; justify-content: center;
  background: var(--color-surface-raised); border: 2px solid var(--color-border-strong);
  border-radius: 4px; color: var(--color-text-muted); font-size: 15px; font-weight: 700;
  cursor: pointer; transition: border-color .12s, background .12s, color .12s; padding: 0;
}
.wr-display-box:hover { background: var(--color-border); color: var(--color-text-primary); }
.wr-display-box-active {
  border-color: var(--color-success); color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
}

.wr-toast {
  position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 60;
  background: var(--color-surface); border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  color: var(--color-danger); font-size: 12px; padding: 8px 14px; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.4); cursor: pointer;
}
/* File-transfer status reuses .wr-toast for both success and failure --
   this modifier just swaps the danger-red styling for success (upload
   complete/download complete), since not every file-transfer status is
   an error the way displaysError above always is. */
.wr-toast-ok {
  border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
  color: var(--color-success);
}

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

/* Real in-modal loading state for Elevate -- reported directly as "it just
   looks like it hangs" when the only feedback was the button's own label
   changing to "Elevating…". Replaces the body text with a spinner (the
   same .wr-spinner already used by the main connect overlay) for the
   duration of the attempt, which can take up to CONNECT_TIMEOUT_MS. */
.wr-elevate-loading { display: flex; flex-direction: column; align-items: center; padding: 28px 20px; text-align: center; }
.wr-elevate-loading .wr-spinner { margin-bottom: 10px; }

/* ── Download: remote directory browser modal ── */
.wr-browse-modal { width: 520px; }
.wr-browse-path { display: flex; align-items: center; margin-bottom: 10px; }
.wr-browse-loading { display: flex; justify-content: center; padding: 24px; }
.wr-browse-list {
  max-height: 320px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 8px;
}
.wr-browse-row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px;
  background: none; border: none; border-bottom: 1px solid var(--color-border); color: var(--color-text-primary);
  font-size: 12px; font-family: var(--font); cursor: pointer; text-align: left; transition: background .1s;
}
.wr-browse-row:last-child { border-bottom: none; }
.wr-browse-row:hover { background: var(--color-surface-raised); }
</style>
