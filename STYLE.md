# Beacon — UI/UX Style Guide

Dark-first design system. All tokens defined in `dashboard/src/style.css` as CSS custom properties.

## Design tokens

```css
--color-canvas:        #0c0e16   /* page background */
--color-surface:   #141720   /* cards, sidebar, topbar */
--color-surface-raised: #1c1f2e   /* table headers, expanded rows, hover states */
--color-border:    #232638   /* standard dividers */
--color-border-strong:  #2d3148   /* form inputs, stronger outlines */
--color-text-primary:      #d8daf0   /* primary text */
--color-text-muted:     #616480   /* labels, timestamps, secondary text */
--color-text-subtle:   #8486a8   /* nav items unselected, sub-labels */
--color-primary:    #4e7ef7   /* primary blue — CTAs, active state, links */
--color-success:      #2dcfa0   /* online/success/approved */
--color-warning:     #f0a840   /* warning, pending */
--color-danger:       #e8566a   /* error, offline, danger */
```

## Shell layout

```
#app (flex column, 100vh)
  .shell (flex row, flex:1)
    .sidebar (fixed width, resizable, collapsible, z-index:600)
    .main-wrap (flex column, flex:1)
      .topbar (52px fixed height)
      .page (flex:1, overflow-y:auto, padding:28px)
        <RouterView />
```

The sidebar has a CSS transition on width for collapse animation. Use `.no-transition` class during drag to suppress it.

## Sidebar collapse toggle (floating chevron)

Collapse/expand is **not** a topbar hamburger button — it's a small circular button that straddles the sidebar's right edge, sibling to `.sidebar`/`.main-wrap` inside `.shell` (which needs `position: relative` in `style.css` for this to anchor correctly):

```html
<button
  class="sidebar-toggle-btn"
  :class="{ 'no-transition': isResizing }"
  :style="{ left: (sidebarCollapsed ? 11 : sidebarWidth) + 'px' }"
  @click="toggleSidebar"
>
  <svg ...><polyline v-if="!sidebarCollapsed" points="15 18 9 12 15 6"/><polyline v-else points="9 18 15 12 9 6"/></svg>
</button>
```
```css
.sidebar-toggle-btn {
  position: absolute; top: 14px; transform: translateX(-50%);
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--color-surface-raised); border: 1px solid var(--color-border-strong);
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-subtle); z-index: 601; /* above .sidebar's z-index:600 */
  transition: left .2s ease, background .12s, color .12s, border-color .12s;
}
.sidebar-toggle-btn.no-transition { transition: none !important; }
```

**Must be a sibling of `.sidebar`, not a child** — `.sidebar` has `overflow: hidden`, which would clip a button meant to poke halfway outside it. Position it via `left` relative to `.shell` instead, bound live to `sidebarWidth`/`sidebarCollapsed` so it tracks the sidebar during a resize drag (share the same `isResizing` no-transition flag the resizer uses).

**The collapsed-state offset is `11px`, not `0`** — at `left: 0` the circle's center sits exactly on the viewport edge and half the button renders off-screen and unclickable. `11` (half the button's 22px width) keeps the whole circle on-screen, touching the true edge.

Icon flips direction based on state (chevron-left when expanded → click collapses; chevron-right when collapsed → click expands) rather than a static hamburger glyph.

## Typography scale

| Usage | Size | Weight | Color |
|---|---|---|---|
| Page title (`h1`) | 20px | 700 | `--color-text-primary` |
| Section label (form groups in PolicyFormPage) | 15px | 600 | `--color-text-primary` |
| Body / table cells | 13px | 400 | `--color-text-primary` |
| Table column headers | 10–11px | 600–700 | `--color-text-muted`, uppercase, 0.04–0.08em spacing |
| Badges / chips | 10–11px | 700 | varies by type |
| Sub-labels / timestamps | 11–12px | 400 | `--color-text-muted` or `--color-text-subtle` |

## Buttons

```css
.btn           /* base: inline-flex, 5px 13px, 12px font */
.btn-primary   /* accent bg, white text */
.btn-ghost     /* transparent, muted-2 text, border */
.btn-danger    /* red tint bg + text */
.btn-sm        /* 3px 10px, 11px font */
.btn-xs        /* used in table toolbars: 3px 10px, 12px font, surface-2 bg */
```

Ghost buttons in table toolbars use `.btn-xs` (locally defined in the scoped component), not `.btn-sm`.

## Status indicators

```css
.status-dot + .dot-online   /* teal, glowing box-shadow */
.status-dot + .dot-offline  /* muted grey */
.status-dot + .dot-pending  /* amber */
```

## Badges

```css
.badge.badge-approved  /* teal */
.badge.badge-pending   /* amber */
.badge.badge-revoked   /* red */
```

Each badge has a 4px dot pseudo-element via `::before`.

## Type/priority chips (policy monitors)

Full palette, 10 colors deep as of this session — check this table before adding a new check type's chip so the color stays distinct:

```css
.check-chip.chip-disk_space    /* purple tint  — rgba(130,80,240,.14)  / #8050f0 */
.check-chip.chip-offline       /* amber tint   — var(--color-warning) tint (also used for "Online Status" label) */
.check-chip.chip-cpu_usage     /* red tint     — rgba(240,80,60,.12)   / #e04040 */
.check-chip.chip-memory_usage  /* accent blue  — rgba(78,126,247,.14)  / var(--color-primary) */
.check-chip.chip-av_status     /* teal tint    — rgba(45,207,160,.14)  / var(--color-success) */
.check-chip.chip-file_size     /* grey tint    — rgba(132,134,168,.16) / var(--color-text-subtle) */
.check-chip.chip-ping          /* teal tint    — rgba(45,207,160,.14)  / var(--color-success) (shares teal with av_status, contexts don't collide) */
.check-chip.chip-process       /* amber tint   — rgba(240,168,64,.16)  / var(--color-warning) (shares amber with offline) */
.check-chip.chip-service       /* pink/magenta — rgba(200,80,180,.14)  / #c850b4 */
.check-chip.chip-software      /* green tint   — rgba(80,180,120,.14)  / #50b478 */

.pri-badge.pri-critical  /* solid red, white text */
.pri-badge.pri-high      /* solid #e07830, white text */
.pri-badge.pri-moderate  /* amber bg, dark text */
.pri-badge.pri-low       /* muted bg */
```

Chip CSS is duplicated (not shared) between `PolicyFormPage.vue` and `GlobalPoliciesPage.vue`, matching this codebase's established duplication-over-sharing convention for small per-page presentational logic.

## Scope badges (policy scope)

```css
.scope-badge.scope-global   /* accent blue tint */
.scope-badge.scope-company  /* teal tint */
```

## Tables

Standard pattern (used in all list pages):

```html
<div class="section-card">
  <div class="section-card-head">...</div>
  <table>
    <thead><tr><th>...</th></tr></thead>
    <tbody><tr><td>...</td></tr></tbody>
  </table>
</div>
```

GlobalPoliciesPage uses a self-contained table (`policy-table`) inside `.table-wrap` with sticky `<thead>`. Expand rows use `<tr class="expand-row">` with a full-colspan `<td class="expand-cell">`.

**Never use `ref<Set>` for boolean expand/select state.** Vue 3 doesn't reliably track Set replacements. Use:
```typescript
const expanded = reactive<Record<string, boolean>>({});
// toggle:
if (expanded[id]) delete expanded[id]; else expanded[id] = true;
// check: expanded[id]  (truthy)
```

## Toggle switches

Two variants used in the app:

**Standard toggle** (policy enabled, per-monitor enabled):
```html
<button :class="['toggle-btn', { enabled: item.enabled }]" @click="toggle(item)">
  <span class="toggle-track"><span class="toggle-thumb"></span></span>
</button>
```
- Track: 28×16px, border-radius 8px, `--color-border` → `--color-primary` when enabled
- Thumb: 12×12px white circle
- Small variant `.toggle-sm`: 22×12px track, 8×8px thumb

**Drawer toggle** (used in Add Monitor response section):
```html
<button :class="['mf-tgl', { on: active }]" @click="active = !active">
  <span class="mf-tgl-thumb"></span>
</button>
```
- Track: 40×22px, border-radius 11px
- Thumb: 16×16px white circle

## Segmented bar (toggle button group)

Used for Scope (Global/Site) and Enabled/Disabled selectors:
```html
<div class="seg-bar">
  <button :class="['seg-btn', { active: val === 'a' }]" @click="val = 'a'">Option A</button>
  <button :class="['seg-btn', { active: val === 'b' }]" @click="val = 'b'">Option B</button>
</div>
```

**Critical**: `.seg-bar` must have `align-self: flex-start` when inside a flex column container, otherwise it stretches full width.

Primary variant for the active state: add `.seg-primary` to the button — gives it `--color-primary` background instead of surface white.

**Also used for >2 options**: `DeviceChangeLogPage.vue`'s category filter (All/Software/Hardware/Services/Security, 5 buttons) confirms this isn't just a binary toggle — works the same way for any small fixed set of mutually-exclusive filter values, `v-for`'d over an options array instead of two hardcoded buttons.

**Disabled option, with a reason shown below** — `JobFormPage.vue`'s Execution section ("Run as system account" / "Run as a logged in user") uses this when one option is a real, known capability gap rather than a value the user just can't currently pick:
```html
<div class="seg-bar">
  <button class="seg-btn active">Run as system account</button>
  <button class="seg-btn" disabled title="Not supported yet — the agent has no Windows user-impersonation support.">Run as a logged in user</button>
</div>
<p class="field-hint">Running as the logged-in user isn't supported yet — every job runs under the system account.</p>
```
```css
.seg-btn:disabled { opacity: .4; cursor: not-allowed; }
```
Deliberately **shown-but-disabled**, not omitted from the control entirely — the greyed-out option itself communicates "this exists in the reference and is a real gap," which a missing button wouldn't. Pair it with a `field-hint` below the bar restating why, since a `title` tooltip alone is easy to miss. Contrast with Notification-style features (email on job completion) that have **zero** UI presence at all — use the disabled-option treatment specifically when the control's shape itself (e.g. two mutually-exclusive execution contexts) is worth preserving as documentation of the gap; omit entirely when there's no natural "slot" for the missing feature to sit in.

## Modals

Centered modal pattern (used for Override, confirmation dialogs, `RemoteShellModal.vue`):
```html
<Teleport to="body">
<div class="modal-backdrop" @click.self="close">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">Title</span>
      <button class="btn-icon" @click="close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">...</div>
    <div class="modal-footer">...</div>
  </div>
</div>
</Teleport>
```
```css
.modal-header { display: flex; align-items: center; padding: 16px 18px 12px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.btn-icon { background: none; border: none; cursor: pointer; color: var(--color-text-muted); padding: 4px; display: flex; align-items: center; border-radius: 4px; transition: background .1s, color .1s; }
.btn-icon:hover { background: var(--color-surface-raised); color: var(--color-text-primary); }
```

Modal: 440px wide (default), max 95vw, max 90vh, border-radius 10px, `var(--shadow)`. Widen with a local override class for content-heavy modals (e.g. `RemoteShellModal.vue`'s `.rs-modal { width: 860px; height: 560px; }` for an embedded terminal).

**A second, different modal shell also exists in this codebase** — `DeviceDetailPage.vue`'s Quick Job modal uses `.modal-head`/`.modal-foot` (no "-er" suffix, no `<Teleport>`, no header close button — just a Cancel button in the footer) with its own differently-styled `.modal`/`.modal-xl` classes. The two conventions are **not interchangeable** and are easy to confuse by name alone (`modal-header` vs `modal-head`) — check which file you're extending before copying markup. Prefer the `Teleport`+`.modal-header`+`.btn-icon`-close variant above for anything new; it's the one with more real consumers (`GlobalPoliciesPage.vue`, `RemoteShellModal.vue`) and it survives being opened from a component nested inside `overflow:hidden` ancestors, which the non-Teleported variant does not.

## Right-side drawer (Add Monitor panel)

Used in PolicyFormPage for Add/Edit Monitor:
```css
.mo-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 500;
  display: flex; align-items: stretch; justify-content: flex-end;
}
.mo-inner {
  width: 620px; max-width: calc(100vw - 160px);
  height: 100%;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4);
}
```

Sidebar stays visible because `.sidebar { z-index: 600 }` is above the drawer's `z-index: 500`.

Use `<Teleport to="body">` so the drawer escapes any `overflow: hidden` parent.

## PolicyFormPage layout (the full-page form pattern)

Full-page form pattern:

```
.pf-page (flex column, min-height: 100%)
  .pf-crumb  (breadcrumb: 12px, --color-text-muted, accent links)
  .pf-topbar (back button + h1 + Cancel/Save)
  .pf-body (flex column)
    .pf-group (each section: flex column, gap 10px, padding 20px 0, border-bottom)
      .pf-label (15px, 600, --color-text-primary)
      <content>
```

Each `.pf-group` is max-width 760px. The label font-size is larger (15px) than the global field label (11px uppercase) to match Datto-style section headers.

**Second real example: `ComponentFormPage.vue`** (`/components/new`, `/components/:id`) — reuses this exact shell (`.pf-page`/`.pf-crumb`/`.pf-topbar`/`.pf-body`/`.pf-group`/`.pf-label` class names, copied per-component like everything else in this pattern) rather than inventing new class names, even though it replaced what used to be a modal on `ComponentsPage.vue`. If you're building a third full-page create/edit form, start from this shell before reaching for a modal — the modal-first instinct is what this session explicitly moved away from.

**Third real example: `JobFormPage.vue`** (`/jobs/new`) — same story as `ComponentFormPage.vue`: replaced a modal (`CreateJobModal.vue`, deleted) that had grown a real Schedule/Execution feature set with no natural place to put it in an 860px `.modal-xl`. Confirms the shell scales past "a handful of simple fields" — this page has a component picker with a live search-combobox, a multi-mode target picker (All/Company/Specific Devices, the latter with its own scrollable checkbox list), and two seg-bar-driven conditional sections (Schedule, Execution), all inside ordinary `.pf-group` blocks with no layout changes needed to the shell itself.

**Fourth real example, and the first non-form use: `DeviceChangeLogPage.vue`** (`/devices/:id/change-log`) — reuses the `.pf-page`/`.pf-crumb`/`.pf-topbar` shell for a read-only, filterable/paginated *browse* page (no `.pf-group`/`.pf-body` form fields at all — just a `.section-card` with a filter bar, table, and pagination bar dropped into the topbar's place). Confirms this shell isn't just for create/edit forms; use it any time a section needs to "pop out" into its own full page reached via a button (as opposed to a modal, which stays overlaid on the page that opened it) — see Device detail page's Change Log entry in CLAUDE.md for why this one specifically needed to be a page and not a modal (unbounded, growing dataset needing real pagination/filtering, not a quick glance).

### Variables / Post-conditions editor (inline add-form, not a drawer)

A lighter-weight sibling of the Add Monitor right-side drawer below — used in `ComponentFormPage.vue` for a component's input variables. The list itself reuses the monitor-list chrome (`.pf-monitors`/`.pf-mon-empty`/`.pf-mon-row`/`.pf-mon-actions`/`.pf-mon-add` — same classes as PolicyFormPage's monitor list, copied per-component), but instead of opening a full drawer, "Add Variable"/"Edit" opens a small inline sub-form directly below the list:

```html
<div v-if="varForm" class="var-form">
  <div class="var-form-grid"><!-- 2-col grid of fields --></div>
  <div class="var-form-actions"><!-- Cancel / Save Variable --></div>
</div>
```
```css
.var-form { margin-top: 10px; padding: 12px; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-surface-raised); }
.var-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
```

Use this lighter pattern (not the full `.mo-overlay` drawer) when the sub-form has ≤~8 simple fields and doesn't need its own type-selector-grid + multi-section layout — the drawer earns its complexity for Add Monitor specifically because that form has real branching structure (10 check types, each with different fields) that a component variable (4 simple types) doesn't.

Post-conditions, by contrast, don't get their own add-form at all — each row's fields (stream/match_type/pattern/enabled) are simple enough to edit inline directly in the list row, with just an add/remove button, no separate panel.

## Pill checkboxes (OS / class targeting)

```html
<label :class="['pill-opt', { active: selected.includes(val) }]">
  <input type="checkbox" :value="val" v-model="selected" class="pill-cb" />
  Label
</label>
```

Pill: 5px 14px, border-radius 20px, border becomes accent when active.
The `<input>` is visually hidden (`display: none`) — the entire `<label>` is the click target.

## Form field hint / warning box

```html
<p class="field-hint field-hint-warn">Warning text</p>
```

```css
.field-hint { font-size: 11px; color: var(--color-text-muted); margin-top: 4px; }
.field-hint-warn {
  color: var(--color-warning);
  background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2);
  border-radius: 5px; padding: 6px 10px;
}
```

Used when CPU threshold ≥ 95% to warn about 100% CPU reliability.

**Note**: `.field-hint` is defined per-component (scoped styles), not globally — it exists independently in `PolicyFormPage.vue`, `GlobalPoliciesPage.vue`, and `TenantsPage.vue`. Adding it to a new component that doesn't already have it needs its own copy of the CSS rule (`display:block; font-size:11px; color:var(--color-text-muted); margin-top:6px;`), not just the class name — Vue scoped styles don't leak across components.

## Optional-condition checkbox (checkbox toggles between a value and `null`)

Used for the Add Monitor drawer's optional numeric conditions (disk's min-size filter, ping's packet-loss/latency thresholds) — the checkbox's checked-state *is* whether the field is `null`, there's no separate boolean flag:

```html
<label class="mf-check-row">
  <input type="checkbox" :checked="form.x !== null"
    @change="form.x = ($event.target as HTMLInputElement).checked ? DEFAULT_VALUE : null" style="accent-color:var(--color-primary)" />
  <span>Alert when...</span>
</label>
<div v-if="form.x !== null" class="mf-row" style="margin-top:6px">
  <input v-model.number="form.x" type="number" class="mf-input" style="max-width:90px"/>
</div>
```

Uses `:checked`/`@change` rather than `v-model` on the checkbox itself, since `v-model` would need a separate boolean ref to bind to — deriving checked-state from `!== null` keeps the number field as the single source of truth.

## Segmented-bar-driven conditional fields (distinct from the checkbox variant above)

Used in `JobFormPage.vue`'s Schedule section — when the "reveal more fields" trigger is itself a mutually-exclusive choice (not a single yes/no), drive the `v-if` off a `seg-bar` selection instead of a checkbox:

```html
<div class="seg-bar">
  <button :class="['seg-btn', { active: recurrence === 'immediately' }]" @click="recurrence = 'immediately'">Immediately</button>
  <button :class="['seg-btn', { active: recurrence === 'scheduled' }]" @click="recurrence = 'scheduled'">At a scheduled time</button>
</div>
<template v-if="recurrence === 'scheduled'">
  <input type="datetime-local" v-model="scheduledAtLocal" class="pf-input" style="max-width:280px" />
  <select v-model="expirationChoice" class="pf-input" style="max-width:240px">...</select>
</template>
```

Reach for the checkbox-toggles-`null` pattern above when there's exactly one optional value being turned on/off (disk min-size, ping thresholds); reach for this seg-bar variant when the trigger itself has real, named alternatives worth surfacing as their own labeled choice (Immediately vs. a scheduled time) rather than a bare "enable this?" toggle — same reasoning as choosing `seg-bar` over a checkbox anywhere else in this doc.

## Per-check-type field visibility in the Add Monitor drawer

Each check type's own fields are a single `v-if="monPanel.form.checkType === 'x'"` block, inserted before the shared `mf-pair` (period/check-interval/priority). When a check type doesn't need one of the *shared* fields (e.g. `software` has no sustained-period or check-interval concept, and never auto-resolves), wrap just those fields in `<template v-if="monPanel.form.checkType !== 'x'">` rather than hiding the whole shared block — `mf-pair` is one flex row and usually only some of its fields are irrelevant (priority still applies even when period/interval don't).

Type-specific config values that don't make sense for a given type should be force-set when that type is selected, not left to a stale default — the type-card click handler is a named function (`selectCheckType(ct)`), not an inline `@click` assignment, specifically so it has a place to do this:
```typescript
function selectCheckType(ct: CheckType) {
  monPanel.form.checkType = ct;
  if (ct === 'software') {
    monPanel.form.sustainedMinutes = 0;
    monPanel.form.autoResolve = false;
  }
}
```

## Active client block (sidebar)

Appears inside the Companies `sec-body`, after "All Companies" link, when a company is selected:
```css
.client-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px 5px 32px; margin: 2px 8px 0;
  border-radius: 5px;
  background: rgba(78,126,247,.08);
  border-left: 2px solid var(--color-primary);
}
```

Sub-links (e.g., Devices) use `.sbi-leaf` with `padding-left: 48px`.

## Auth-shell pages (Login, SSO callback)

`LoginPage.vue` and `SsoCallbackPage.vue` share a visual family (`.lp-bg` full-screen centered wrapper + `.lp-card`), duplicated per-component (not shared) matching this codebase's established duplication-over-sharing convention — keep both in sync by hand if you tweak one.

- Card: **440px** max-width (not the general 400px — matches the modal-width precedent), `44px 40px 36px` padding, radial accent gradient behind it (`radial-gradient(ellipse 70% 45% at 50% 0%, rgba(78,126,247,.20) 0%, transparent 70%)` over `var(--color-canvas)`).
- Use `var(--*)` custom properties for every color in these files, not hardcoded hex — they were originally hand-authored with raw hex matching the tokens, which drifts silently if the token palette ever changes. Converted this session.
- **Input-with-leading-icon** pattern (mail/lock icons inside email/password fields):
  ```html
  <div class="lp-input-wrap">
    <svg class="lp-input-icon" ...>...</svg>
    <input class="lp-input" ... />
  </div>
  ```
  ```css
  .lp-input-wrap { position: relative; display: flex; align-items: center; }
  .lp-input-icon { position: absolute; left: 13px; color: var(--color-text-muted); pointer-events: none; }
  .lp-input { padding: 12px 14px 12px 38px; /* left padding clears the icon */ }
  ```
- **Gotcha**: don't put `letter-spacing` on a shared input class meant to space out password-dot rendering — it also tracks out any *typed plain text* sharing that class (an actual bug this session: email addresses rendered with unnatural character spacing because `.lp-input` applied `letter-spacing: .08em` to both the email and password fields). If you want wider password-dot spacing, scope it to `input[type="password"]`, not the shared class.
- No footer branding repeating the product name — it's already in the header directly above; a repeated "Beacon RMM" at the bottom reads as filler, not polish.

## Async search-as-you-type combobox

Distinct from the client-side-filter combobox already documented above (`.pf-site-drop` in PolicyFormPage, which filters an already-loaded in-memory list) — this variant debounces and calls a backend API per keystroke, for searching data that isn't (and shouldn't be) fully loaded client-side, e.g. `SsoSettingsPage.vue`'s Entra group search:

```typescript
const query = ref('');
const results = ref<T[]>([]);
const searching = ref(false);
const searchError = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchError.value = '';
  const q = query.value.trim();
  if (!q) { results.value = []; return; }
  searchTimer = setTimeout(() => runSearch(q), 300);
}

async function runSearch(q: string) {
  searching.value = true;
  try { results.value = await api.someSearch(q); }
  catch (e) { searchError.value = e instanceof Error ? e.message : 'Search failed.'; results.value = []; }
  finally { searching.value = false; }
}
```
Dropdown markup reuses the same `position: relative` wrapper / `position: absolute` dropdown shape as `.pf-site-drop`, with `@mousedown.prevent` on each option (fires before the input's `@blur` would otherwise close the dropdown first) and a `setTimeout(..., 150)` delay on `@blur` itself for the same reason. Show three states in the dropdown: searching, error (surface `searchError` — don't swallow it, these calls can fail for real infra reasons like a missing API permission), and empty/no-match — not just a bare list.

## Device detail page: one-page-with-anchor-nav (not tabs)

`DeviceDetailPage.vue`'s left-nav (Summary/System/Alerts/Policies/Software/Services/Memory/Storage/Network/Security/Change Log) looks like a tab bar but isn't one — every section renders simultaneously; the nav only scrolls to and highlights a section. This shape was arrived at after an explicit correction (an initial `v-if`/`v-else-if` tabs implementation was rejected: "it is still supposed to be one page. The links just make it quicker to navigate").

**Nav order and per-section scope is copied directly from a real Datto RMM device page, not invented** — a session that started with a single merged "System" section (OS + all hardware facts combined, itself replacing an even earlier standalone "Hardware" nav item) went through two corrections once actual Datto screenshots were shown:
1. "stuff is getting scattered and duplicated" — fields were showing up in two places at once (Summary *and* System *and* Hardware all had OS/Serial/BIOS/CPU/RAM overlap), because System was bolted on without reconciling what already existed. Fix: each fact lives in exactly one section.
2. Datto keeps Memory, Storage, and Network as their **own** nav items, not folded into System — an initial merge-everything-into-System pass was the wrong direction and had to be split back out. **System is identity-only** (OS/build/architecture/domain/last-user/AV product/firewall/warranty/services-count on one side, manufacturer/model/motherboard/serial/processor/cores/BIOS/display-adapters on the other) — no RAM, no disks, no network adapters. Those three get their own single-topic sections instead, each just `.inv-tab-body` > `.inv-section` with no internal grid (unlike System's two-column `.ddev-grid` layout, these sections only have one concern each).

Skipped from the reference on purpose, not by oversight: Patch Management (no patch-management feature), Related Devices, Activities, Notes, UDFs (all deferred — "not need it for the moment"), and a historical-metrics-over-time tab (Beacon only stores the latest check-in snapshot per device, no time-series table — a real new feature, not a quick add, deferred until asked for explicitly). `.NET Version` and real vendor-API warranty lookups (Dell/HP/Lenovo warranty APIs — each needs its own partner-account registration, and would still miss VMs/white-box builds) were evaluated and explicitly declined; Warranty Expiration is a manually-entered date field instead (`devices.warranty_expires_at`, migration `0019`), since no OS/hardware API on any platform exposes real OEM warranty status.

**Section separation** — each section gets a distinct title-bar treatment, not just a thin divider (a thin border alone read as "runs together"):
```css
.ddev-page-section { border-bottom: 6px solid var(--color-canvas); scroll-margin-top: 16px; }
.ddev-page-section:last-child { border-bottom: none; }
.ddev-section-heading {
  display: flex; align-items: center;
  font-size: 14px; font-weight: 700; color: var(--color-text-primary);
  padding: 13px 20px; margin: 0;
  background: var(--color-surface-raised); border-bottom: 1px solid var(--color-border);
}
```
The 6px `var(--color-canvas)`-colored gutter between sections (not a 1px border) is what actually reads as visual separation at a glance.

**Left-nav + sticky positioning gotcha**: the nav's wrapping element needs its own class overriding `.section-card`'s global `overflow: hidden` (which otherwise silently breaks `position: sticky` on any descendant — found only by testing actual scroll behavior, not by reading the CSS):
```css
.section-card.ddev-card { overflow: visible; }
.ddev-nav { position: sticky; top: 12px; align-self: flex-start; }
```

**Scroll-spy** (nav highlight tracks scroll position automatically) — see CLAUDE.md's "Scroll-spy nav" coding pattern for the full `IntersectionObserver` implementation and its bottom-of-scroll edge case. Nav item active-state CSS matches the app's existing active-state formula (`App.vue`'s `.sbi.active`, `GlobalPoliciesPage.vue`'s `.al-pill-active`) — accent-tinted background + left border + accent text color.

**Deep-linking**: `?section=` on the same route (not a URL hash fragment — the app already uses `createWebHashHistory()`, so a second `#fragment` would collide with vue-router's own hash). Clicking a nav item does `router.replace` (not `push`, so scrolling around doesn't spam history) and calls `scrollIntoView`; a dedicated `watch(() => route.query.section)` handles the case where `?section=` changes while already mounted on the same device (e.g. a second click) — watching only `route.params.id` misses this.

## Inline-editable date field (Warranty Expiration)

Only editable field on the whole device detail page (everything else is agent-reported and read-only) — a bare native `<input type="date">`, no separate "Edit"/"Save" button, saves immediately `@change`:
```html
<input
  type="date"
  class="mono text-sm ddev-date-input"
  :value="warrantyDateInput"
  :disabled="warrantySaving"
  @change="onWarrantyChange"
/>
```
```css
.ddev-date-input {
  background: var(--color-canvas); border: 1px solid var(--color-border-strong); border-radius: 4px;
  padding: 3px 6px; color: var(--color-text-primary); font-family: var(--font);
}
.ddev-date-input:focus { outline: none; border-color: var(--color-primary); }
```
`:value`/`@change` rather than `v-model`, same reasoning as the optional-condition checkbox pattern above — the source of truth is `device.value.warrantyExpiresAt` (a unix timestamp or `null`), and the date string is a derived, one-way-bound view of it. Convert at UTC midnight in both directions (`new Date(ts * 1000).toISOString().slice(0, 10)` to display; `Math.floor(new Date(\`${val}T00:00:00Z\`).getTime() / 1000)` to save) — `<input type="date">` works in unzoned calendar days, so mixing in local-timezone `Date` parsing would drift the displayed date by one day near midnight in some timezones.

## Identity header (device/entity detail pages)

Large bold name with the status dot inline (not a separate meta line below it), and an optional trailing OS/type icon on the header's opposite edge:
```css
.ddev-header { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
.ddev-header-name { display: flex; align-items: center; gap: 10px; }
.ddev-status-dot { width: 10px; height: 10px; border-radius: 50%; }
.dot-online  { background: var(--color-success); box-shadow: 0 0 0 3px rgba(45,207,160,.15); }
.dot-offline { background: var(--color-text-muted); }
.ddev-hostname { font-size: 22px; font-weight: 700; color: var(--color-text-primary); }
```
A previous version had a secondary meta line below the name (status/approved/OS, `·`-separated) — dropped per feedback once the dot moved inline, since it read as clutter rather than useful context.

**OS icon**: a plain geometric glyph (e.g. a static 2×2 square grid for Windows), not a licensed vendor logo asset — inline SVG, `currentColor` fill, shown conditionally (`v-if="isWindows(device)"`) rather than always rendering a generic fallback for other OSes.

## Status badges (ok / warn / danger / muted)

Four-state badge palette, used for things like antivirus status where "unknown" is a real, distinct state from "bad":
```css
.inv-badge-ok     { background: rgba(45,207,160,.12); color: var(--color-success); }
.inv-badge-warn   { background: rgba(240,168,64,.12);  color: var(--color-warning); }
.inv-badge-danger { background: rgba(232,86,106,.12);  color: #e8566a; }
.inv-badge-muted  { background: rgba(97,100,128,.15);  color: var(--color-text-muted); }
```
(all four share `font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px;`). Same status vocabulary as `OverviewPage.vue`'s antivirus widget (`running_up_to_date` / `running_not_up_to_date` / `not_running` / `not_detected` / `unknown`) — labels/colors duplicated per-component rather than shared, matching this codebase's established convention.

## List-page stat cards

A row of at-a-glance counts above a list-page table. Two visual variants exist in the codebase:

### Plain variant (Components page, also GroupsPage)

```html
<div class="stat-row">
  <div class="stat-card">
    <span class="stat-label">Total</span>
    <span class="stat-value">{{ stats.total }}</span>
  </div>
</div>
```
```css
.stat-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  padding: 14px 18px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px;
}
.stat-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 22px; font-weight: 700; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
```

### Colored top-border + inline label/value variant (Jobs page)

Modeled on a real Datto RMM Jobs page screenshot: label and number on the same horizontal line, colored top border to visually categorize each card:

```html
<div class="stat-card stat-blue" @click="setStatusFilter(null)" style="cursor:pointer">
  <span class="stat-label">Total</span>
  <span class="stat-value">{{ jobs.length }}</span>
</div>
```
```css
.stat-card {
  flex: 1; display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-top-width: 3px; border-radius: 8px;
  transition: border-color .12s, filter .12s;
}
.stat-card:hover { filter: brightness(1.06); }
/* color modifier classes — pick one per card: */
.stat-blue   { border-top-color: #3b6fd4; }
.stat-accent { border-top-color: var(--color-primary); }
.stat-purple { border-top-color: #9c6af7; }
.stat-teal   { border-top-color: var(--color-success); }
.stat-muted  { border-top-color: var(--color-text-muted); }
.stat-label { font-size: 11px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-value { font-size: 20px; font-weight: 700; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
```

**Clicking a stat card sets `filterStatus` only** — never `filterUser`. An earlier version also set `filterUser` (pinning the current user filter) and was explicitly corrected. Total/type cards clear the status filter (`filterStatus = null`); status cards set it to a specific value.

**Counts reflect the whole (unfiltered) collection** — compute stats from the raw data array, not the `computed` that already has filters applied.

## Filter chip bar

Pattern for an active-filter indicator with per-chip × dismiss and a "Reset Filters" text-link. Established in `JobsPage.vue`, reusable for any list page with default filters:

```html
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
  <span class="filter-by">Filtered by:</span>
  <span v-if="filterStatus" class="filter-chip">
    Status: {{ filterStatus }}
    <button class="chip-x" @click="filterStatus = null">×</button>
  </span>
  <span v-if="filterUser" class="filter-chip">
    Created by: {{ filterUser }}
    <button class="chip-x" @click="filterUser = null">×</button>
  </span>
  <button v-if="!isDefaultFilters" class="btn-reset" @click="resetFilters">Reset Filters</button>
</div>
```
```css
.filter-label { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }   /* section title */
.filter-count { background: var(--color-border-strong); color: var(--color-text-muted); font-size: 10px; padding: 1px 6px; border-radius: 3px; font-variant-numeric: tabular-nums; }
.filter-by    { font-size: 11px; color: var(--color-text-muted); }
.filter-chip  { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--color-text-primary); background: var(--color-surface-raised); border: 1px solid var(--color-border-strong); border-radius: 4px; padding: 2px 6px 2px 8px; }
.chip-x       { background: none; border: none; cursor: pointer; color: var(--color-text-muted); font-size: 13px; line-height: 1; padding: 0; display: flex; align-items: center; }
.chip-x:hover { color: var(--color-text-primary); }
.btn-reset    { background: none; border: none; cursor: pointer; font-size: 11px; color: var(--color-primary); font-family: var(--font); padding: 0; }
.btn-reset:hover { text-decoration: underline; }
.btn-link     { background: none; border: none; cursor: pointer; color: var(--color-primary); font-size: inherit; font-family: var(--font); padding: 0; }
.btn-link:hover { text-decoration: underline; }
```

Key behaviors:
- **"Reset Filters" appears only when `!isDefaultFilters`** (a computed prop) — hidden once filters are back at defaults. This is a `computed`, not a watcher, so it's always in sync.
- **"Reset Filters" restores defaults, not blank** — this was explicitly corrected once (initial version set both filters to `null`). "Blank" is a separate UX: remove each chip individually.
- `isDefaultFilters = filterUser.value === currentUserName() && filterStatus.value === 'active'` — encode your default state here.
- The "Filtered by:" label and chip row are always visible (even when no chips are active, the label anchors the layout) or you can `v-if` the whole row on `filterUser || filterStatus`.

## Pagination bar

Client-side pagination pattern, established in `JobsPage.vue`. Use when all rows are already loaded (e.g. for stat card counts) — server-side paging adds query complexity for no UX gain at small scale.

```html
<div v-if="totalPages > 1 || pageSize !== 20" class="pagination">
  <span class="page-info">{{ rangeStart }}–{{ rangeEnd }} of {{ visible.length }}</span>
  <div class="page-controls">
    <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--">‹</button>
    <template v-for="p in pageNumbers" :key="p">
      <span v-if="p === '...'" class="page-ellipsis">…</span>
      <button v-else class="page-btn" :class="{ 'page-btn-active': p === currentPage }" @click="currentPage = p as number">{{ p }}</button>
    </template>
    <button class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">›</button>
  </div>
  <select class="page-size-select" :value="pageSize" @change="onPageSizeChange">
    <option :value="20">20 / page</option>
    <option :value="50">50 / page</option>
    <option :value="100">100 / page</option>
  </select>
</div>
```
```css
.pagination     { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--color-border); }
.page-info      { font-size: 11px; color: var(--color-text-muted); margin-right: auto; font-variant-numeric: tabular-nums; }
.page-controls  { display: flex; align-items: center; gap: 3px; }
.page-btn       { min-width: 28px; height: 28px; padding: 0 6px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-surface-raised); color: var(--color-text-muted); font-size: 12px; font-family: var(--font); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .1s, color .1s; }
.page-btn:hover:not(:disabled) { background: var(--color-border-strong); color: var(--color-text-primary); }
.page-btn:disabled              { opacity: .35; cursor: not-allowed; }
.page-btn-active                { background: var(--color-primary) !important; color: #fff !important; border-color: var(--color-primary) !important; }
.page-ellipsis  { font-size: 12px; color: var(--color-text-muted); padding: 0 4px; }
.page-size-select { height: 28px; padding: 0 8px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-surface-raised); color: var(--color-text-muted); font-size: 11px; font-family: var(--font); cursor: pointer; }
```

Script-side computed props:
```typescript
const currentPage = ref(1);
const pageSize    = ref(20);

// Reset to page 1 whenever filters change
watch([filterA, filterB], () => { currentPage.value = 1; });

const totalPages = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize.value)));
const rangeStart = computed(() => visible.value.length === 0 ? 0 : (currentPage.value - 1) * pageSize.value + 1);
const rangeEnd   = computed(() => Math.min(currentPage.value * pageSize.value, visible.value.length));
const paginated  = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return visible.value.slice(start, start + pageSize.value);
});
const pageNumbers = computed(() => {
  const total = totalPages.value, cur = currentPage.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (cur > 3) pages.push('...');
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
  if (cur < total - 2) pages.push('...');
  pages.push(total);
  return pages;
});
function onPageSizeChange(e: Event) {
  pageSize.value = Number((e.target as HTMLSelectElement).value);
  currentPage.value = 1;
}
```

Use `v-for="row in paginated"` in the table (not `visible`). The bar hides itself when `totalPages === 1 && pageSize === 20` — no clutter on small datasets.

**Second real consumer: `DeviceChangeLogPage.vue`** — same computed props and markup verbatim, just with a `pageSize` default of `50` instead of `20` (matches a real Datto reference screenshot's own default) and the bar's hide-condition adjusted to `pageSize !== 50` to match. Confirms the pattern generalizes cleanly to a different default page size without other changes.

## Date-range filter (preset dropdown)

Used in `DeviceChangeLogPage.vue` for filtering by `detectedAt` — a plain `<select>` of preset day-counts, not a full date-picker, since technicians want quick relative ranges ("Last 30 Days") not arbitrary dates:
```html
<select v-model.number="dateRangeDays" class="page-size-select">
  <option :value="7">Last 7 Days</option>
  <option :value="30">Last 30 Days</option>
  <option :value="90">Last 90 Days</option>
  <option :value="0">All Time</option>
</select>
```
Reuses `.page-size-select` (already defined for the pagination bar's page-size dropdown) rather than a new class — visually it's the same small bordered dropdown, just a different set of options. `0` means "no cutoff" (All Time), not a literal zero-day range — same "sentinel value with real meaning" idiom as the optional-condition-checkbox's `null`. Paired with the existing filter-chip-bar's "Reset Filters" convention (`.btn-reset`, shown only when `dateRangeDays !== 30` — the default — or another filter is non-default).

## Live-connection overlay (Remote Shell terminal)

Used in `RemoteShellModal.vue` for showing connection state on top of an always-mounted xterm.js terminal (the terminal container itself is never conditionally rendered — only the overlay is — so `FitAddon.fit()` has a real DOM element to measure from the moment the modal opens, before any WebSocket data has arrived):
```html
<div class="rs-term-wrap">
  <div ref="termEl" class="rs-term"></div>
  <div v-if="status === 'connecting'" class="rs-overlay">
    <div class="rs-spinner"></div>
    <p>Connecting… this can take up to 60 seconds.</p>
  </div>
  <div v-else-if="status === 'closed' || status === 'error'" class="rs-overlay">
    <p>{{ statusMessage }}</p>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary btn-sm" @click="reconnect">Reconnect</button>
      <button class="btn btn-ghost btn-sm" @click="close">Close</button>
    </div>
  </div>
</div>
```
```css
.rs-term-wrap { position: relative; flex: 1; overflow: hidden; background: #0c0e16; }
.rs-term { position: absolute; inset: 0; padding: 8px; }
.rs-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; background: rgba(12,14,22,.88); color: var(--color-text-primary); font-size: 13px; text-align: center; padding: 20px;
}
.rs-spinner { width: 22px; height: 22px; border: 2px solid var(--color-border-strong); border-top-color: var(--color-primary); border-radius: 50%; animation: rs-spin .8s linear infinite; margin-bottom: 8px; }
@keyframes rs-spin { to { transform: rotate(360deg); } }
```
Three states (`connecting`/`closed`/`error`) share one overlay treatment (semi-transparent dark scrim + centered content) rather than three different visual languages — the *connected* state is just the absence of an overlay. Reusable for any future live-connection UI built on this same session/relay system (File Manager, Task Manager, etc.).

## Kind badge vs. Group badge (don't reuse one class for both)

`ComponentsPage.vue` has two independent badge concepts that look similar but must stay visually distinct, because they were previously conflated (a real, user-reported confusion this session fixed):
- **Group** (`.cat-badge`) — the freeform organizational tag (Maintenance/Diagnostic/etc.), same palette as the pre-existing policy-monitor chip colors.
- **Kind** (`.kind-badge`) — Script vs. Application, a real behavior-driving field. Deliberately a **separate CSS class**, not a repurposed `.cat-badge`:
```css
.kind-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.kind-script      { background: var(--color-surface-raised); color: var(--color-text-muted); }
.kind-application { background: rgba(78,126,247,.12); color: var(--color-primary); }
```
If you're ever tempted to reuse `.cat-badge` for a new "real" categorical field on this page, don't — that's exactly the naming collision this session had to un-do (the old `category` field vs. the new `type` field both being called "Category" in the UI at different points).

**Same collision risk resurfaced with the Device Groups feature** (a later session) — since `components.category` is already user-facing labeled "Group" on `ComponentsPage.vue`, the new device-collection feature is called **"Device Groups"** everywhere in copy/labels, never bare "Groups": the sidebar link, the target-flyout category option, the `JobFormPage.vue` target-row tag (`Device Group`, not `Group`), page titles. If you're adding UI copy for the Device Groups feature and are tempted to shorten it to just "Groups," don't — same reason as above.

## Add Site flyout (multi-select, stays open across picks)

Used in `ComponentFormPage.vue`'s Sites section — and now, unmodified, in two more places: `GroupFormPage.vue` (picking devices for a Device Group) and `PolicyFormPage.vue` (picking Device Groups to target a policy). Same `.sf-*` class names duplicated per-component each time (this codebase's established convention), same behavior. Treat this as the default answer for "let the user pick several of X for this record" — don't invent a new multi-select UI. **Not** a single-select combobox (that was the first, wrong attempt when this pattern was originally built, corrected once shown the real reference) — a right-side panel that stays open while the user adds/removes several items, each row toggling in place:

```html
<Teleport to="body">
  <div v-if="sitesFlyoutOpen" class="sf-overlay" @click.self="sitesFlyoutOpen = false">
    <div class="sf-panel">
      <div class="sf-head"><h2 class="sf-title">Sites</h2><button class="btn-icon" @click="sitesFlyoutOpen = false">×</button></div>
      <div class="sf-search"><input v-model="siteFlyoutQuery" class="pf-input" placeholder="Search" /></div>
      <div class="sf-list">
        <div v-for="t in siteFlyoutMatches" :key="t.id" class="sf-row" :class="{ selected: isSiteSelected(t.id) }">
          <span>{{ t.name }}</span>
          <button v-if="isSiteSelected(t.id)" class="btn btn-primary btn-sm" @click="removeSite(t.id)">Remove</button>
          <button v-else class="btn btn-ghost btn-sm" @click="addSite(t)">Add</button>
        </div>
      </div>
    </div>
  </div>
</Teleport>
```
```css
.sf-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 500; display: flex; align-items: stretch; justify-content: flex-end; }
.sf-panel { display: flex; flex-direction: column; width: 420px; max-width: calc(100vw - 80px); height: 100%; background: var(--color-surface); border-left: 1px solid var(--color-border); box-shadow: -8px 0 32px rgba(0,0,0,.4); overflow: hidden; }
.sf-row.selected { background: rgba(78,126,247,.06); }
```

Key behaviors, all confirmed against the real Datto reference (not guessed):
- Clicking "Add" does **not** close the flyout or remove the row from its list — the button flips to "Remove" in place (with the `.selected` background), so a user can add several sites in one open/close cycle.
- The panel's own list shows *every* site (selected or not) with the appropriate button state — it is not "available sites only."
- The main form page shows a separate, simpler read-only list of currently-selected sites (name only, no per-row actions) plus a page-level "Remove all" button — removal from the *main* list happens by reopening the flyout and clicking "Remove" there, or via "Remove all."
- Same right-side-panel shell as the Add Monitor drawer (`.mo-overlay`/`.mo-inner` — see below), just narrower (420px vs. 620px) and without the multi-section internal structure, since this only has one job (search + pick).

## Flyout selected-state pattern (consistent across component and target flyouts)

Both `JobFormPage.vue`'s component picker flyout (`.cf-`) and target picker flyout (`.tf-`) use the same selected-state interaction — established after a correction mid-session when the two flyouts had diverged:

**Row template (`v-if/v-else` on the right-side action slot):**
```html
<button v-if="!isSelected(item.id)" class="btn btn-ghost btn-sm" @click="addItem(item)">Add</button>
<span v-else class="cf-check" @click="removeItem(item.id)" title="Click to remove">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
</span>
```

**Row CSS:**
```css
.cf-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer; }
.cf-row.cf-row-selected { background: rgba(78,126,247,.08); border-left: 2px solid var(--color-primary); }
.cf-check { width: 22px; display: flex; align-items: center; justify-content: center;
            color: var(--color-success); flex-shrink: 0; cursor: pointer; }
```

The same `.tf-row-selected` / `.tf-check` naming applies for the target flyout — identical CSS, different prefix. Key behaviors:
- Left border (`border-left: 2px solid var(--color-primary)`) + background tint mark selected rows visually.
- The **teal checkmark is on the right**, replacing the Add button via `v-if/v-else` — not a separate column and not on the left side. Clicking the checkmark calls the same toggle function as clicking Add (a single `toggle(item)` helper is fine).
- The flyout stays open across multiple picks — never auto-closes on selection, matching Datto's pattern.
- Removing via the flyout checkmark is equivalent to clicking the chip's × on the main form — both call the same remove path.

**Target flyout also has a category dropdown** (no equivalent in the component flyout):
```html
<div class="tf-cat">
  <select v-model="flyoutCategory" class="pf-input" style="max-width:none">
    <option value="all">All Devices</option>
    <option value="sites">Sites</option>
    <option value="devices">Devices</option>
    <option value="groups">Device Groups</option>
  </select>
</div>
```
A 4th category (`groups`, added for Device Groups) is just another `v-else-if` template branch with its own `flyoutGroupMatches` computed — same row markup, same `toggleTarget({kind:'group',id,name})` call shape as the `sites` branch. Switching kind (e.g. from sites to devices) clears previously selected items of the other kind — enforced inside `toggleTarget()`:
```typescript
function toggleTarget(item: TargetItem) {
  if (item.kind === 'all') { targetItems.value = isTargeted('all') ? [] : [item]; return; }
  const id = (item as any).id as string;
  if (isTargeted(item.kind, id)) {
    targetItems.value = targetItems.value.filter(t => (t as any).id !== id);
  } else if (targetItems.value.length && targetItems.value[0].kind !== item.kind) {
    targetItems.value = [item]; // kind switch: clear previous
  } else {
    targetItems.value.push(item);
  }
}
```

**Not every `.tf-` flyout is kind-exclusive — check the semantics before copying this markup.** `PolicyFormPage.vue`'s Targets flyout (migration `0032`) reuses this exact `.tf-overlay`/`.tf-panel`/`.tf-row`/`.tf-check` markup and CSS verbatim, but its `toggleTarget()` is a flat push/remove with **no** kind-switch-clears-previous branch — a Policy's targets are a heterogeneous OR-list (a Site AND a Device AND a Device Group can all be selected simultaneously; a device qualifies if it matches any one of them). The two flyouts are visually identical and easy to assume behave the same way; they don't. Pick the exclusive-kind behavior above only when the underlying targeting model genuinely only supports one kind at a time (Jobs); pick the flat OR-list variant when multiple simultaneous target kinds are meant to combine (Policies).

## Job Detail page layout (`JobDetailPage.vue`)

New page at `/jobs/:id` — fourth full-page form/detail shell in the codebase. Patterns:

**Details card:**
```css
.jd-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px;
           padding: 20px 24px; margin-bottom: 20px; }
.jd-details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 32px; }
.jd-label { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.jd-value { font-size: 13px; color: var(--color-text-primary); }
```

**SVG flow diagram** (inline, viewBox `0 0 680 210`) — shows the job pipeline as three stages (Pending → Running → Successes/Warnings/Failures). Dynamic bindings use `flowStats` computed over all commands:
```typescript
const flowStats = computed(() => {
  let queued = 0, sent = 0, successes = 0, warnings = 0, failures = 0;
  for (const dev of (detail.value?.devices ?? [])) {
    for (const cmd of dev.commands) {
      if      (cmd.status === 'queued')                    queued++;
      else if (cmd.status === 'sent')                      sent++;
      else if (cmd.status === 'failed')                    failures++;
      else if (cmd.status === 'completed' && cmd.warning)  warnings++;
      else if (cmd.status === 'completed')                 successes++;
    }
  }
  return { queued, sent, successes, warnings, failures };
});
```
Box fill is green/amber/red based on non-zero count; active (queued+sent > 0) box uses `var(--color-primary)`. Connector path for the fork: `M 368 45 H 400 V 175 M 400 45 H 428 M 400 110 H 428 M 400 175 H 428`.

**Command status badges** (`.jd-status-*`):
```css
.jd-status-success { color: var(--green); }
.jd-status-failed  { color: var(--danger); }
.jd-status-warning { color: var(--color-warning); }
.jd-status-sent    { color: var(--color-primary); }
.jd-status-queued  { color: var(--color-text-muted); }
```
Use a `badgeClass(cmd)` / `badgeLabel(cmd)` helper pair (same pattern as `JobsPage.vue`'s `.mini-badge`) — class and label change together, so a template ternary would have to be duplicated.

**Output expansion** — one row open at a time (not a Set), using a discriminated object ref:
```typescript
const expandedOutput = ref<{devId: string, cmdId: string, type: 'stdout'|'stderr', content: string} | null>(null);
```
Toggle: if the same `{devId, cmdId, type}` is already open, set to `null`; otherwise replace. Rendered in a `<tr class="jd-output-row">` inserted after the device's last command row.

**Result caching** — `cmd.result` is a JSON string; parse it once per `cmd` object using a `WeakMap`:
```typescript
const resultCache = new WeakMap<JobDeviceCommand, CmdResult | null>();
function parseResult(cmd: JobDeviceCommand): CmdResult | null {
  if (resultCache.has(cmd)) return resultCache.get(cmd)!;
  let r: CmdResult | null = null;
  try { r = cmd.result ? JSON.parse(cmd.result) : null; } catch { r = null; }
  resultCache.set(cmd, r);
  return r;
}
```

## Mini-badge palette (Jobs page per-device command status)

`JobsPage.vue`'s `.mini-badge` family (queued/sent/completed/failed) gained a fifth state this session:
```css
.mini-warning { background: rgba(240,168,64,.12); color: var(--color-warning); }
```
Shown instead of the `completed` badge specifically when `status === 'completed' && warning === true` (post-condition match) — computed via a small `badgeClass(cmd)`/`badgeLabel(cmd)` helper pair rather than a template ternary, since both the badge's class *and* its label text need to change together. `warning` never changes the underlying `status` value itself or the stdout/stderr/exit-code display — it's a purely additive visual state. This same helper pattern is now used in `JobDetailPage.vue` for `.jd-status-*` badges.

## Table row padding standard

Data table cells use `12px 14px` (`jf-td` in `JobFormPage.vue`). Header cells use `10px 14px` (`jf-thead`). Footer/summary rows use `10px 14px`. These were corrected from the original `9px` (cell) / `7px` (header) — the tighter values made tables look cramped against adjacent filter/chip bars. When adding a new data table, use `padding: 12px 14px` for `<td>` and `padding: 10px 14px` for `<th>` as the baseline; only go tighter if the table is inside a constrained panel (e.g. a flyout or a card, where the surrounding padding already provides breathing room).

## `.pf-tbl-head` labels must mirror the row's own flex children, not just its content

A real bug (`CustomFieldsSettingsPage.vue`, user-reported from a screenshot): the header row had two flat `<span>`s ("Name", "Key") sized with `min-width`, while the actual data rows (`.pf-mon-row`) had a **leading reorder-arrows column** (`.pf-mon-order`, ~46px: two 22px `.btn-icon` buttons + 2px gap) before the Name input. The header never accounted for that leading column, so both labels sat one column left of what they were labeling — easy to miss when eyeballing the template (the JSX/HTML looks "close enough"), only obvious once actually rendered side by side.

Fix: give the header the *same* flex children as the row, including an empty spacer for any leading icon/button column, and size each label span to match its input's actual sizing (not just an approximate `min-width`):
```html
<div class="pf-tbl-head">
  <span class="pf-tbl-head-spacer"></span>          <!-- matches .pf-mon-order's width -->
  <span style="flex:1;max-width:320px">Name</span>   <!-- matches the Name input's flex:1;max-width:320px -->
  <span style="max-width:160px">Key</span>            <!-- matches the Key input's max-width:160px -->
</div>
```
```css
.pf-tbl-head-spacer { width: 46px; flex-shrink: 0; }
```
Also matched the header's flex `gap` to the row's own `gap` (both `12px` — they'd drifted to `8px`/`12px` respectively). **Whenever a `.pf-tbl-head`/`.pf-mon-row` table gains a leading column that isn't a plain data cell** (reorder arrows, a checkbox, a drag handle, an icon), audit the header for a matching spacer before assuming the existing `min-width`-per-label approach still lines up — it silently won't.

## Sidebar resizer

```css
.sidebar-resizer {
  position: absolute; top: 0; right: -3px; bottom: 0;
  width: 6px; cursor: col-resize; z-index: 10;
}
.sidebar-resizer:hover { background: rgba(78,126,247,.35); }
body.sidebar-resizing { cursor: col-resize !important; user-select: none !important; }
```

## Sidebar collapsed icon rail + flyout

When `.sidebar.collapsed` (44px wide), section labels/chevrons/badges/sec-body are hidden and section icons are centered. Clicking an icon opens a `position: fixed; left: 44px` flyout panel to the right.

**State (App.vue)**:
```typescript
const openFlyout = ref<string | null>(null);  // section key
const flyoutTop  = ref(0);                     // viewport top of clicked header

function handleSectionClick(key: string, event: MouseEvent) {
  if (!sidebarCollapsed.value) { toggleSection(key as keyof typeof openSections.value); return; }
  if (openFlyout.value === key) { openFlyout.value = null; return; }
  flyoutTop.value = (event.currentTarget as HTMLElement).getBoundingClientRect().top;
  openFlyout.value = key;
}
const flyoutTitle = computed(() => ({ dashboards: 'Dashboards', sites: 'Companies', ... }[openFlyout.value ?? ''] ?? ''));
```

Close on route change: `watch(() => route.path, () => { openFlyout.value = null; })`.  
Close on expand: `toggleSidebar()` also sets `openFlyout.value = null`.

**Template structure**:
```html
<!-- Backdrop closes flyout on outside click; sits at z-index 598 -->
<div v-if="sidebarCollapsed && openFlyout" class="flyout-backdrop" @click="openFlyout = null" />
<!-- Flyout panel at z-index 599, fixed to right of icon rail -->
<div v-if="sidebarCollapsed && openFlyout" class="nav-flyout" :style="{ top: flyoutTop + 'px' }">
  <div class="flyout-head">{{ flyoutTitle }}</div>
  <template v-if="openFlyout === 'sectionKey'">
    <!-- same .sbi RouterLinks as the normal sec-body, duplicated here -->
  </template>
</div>
```

**CSS** (scoped in App.vue):
```css
.sidebar.collapsed .sec-label, .sidebar.collapsed .sec-chevron,
.sidebar.collapsed .sec-badge, .sidebar.collapsed .sec-body { display: none; }
.sidebar.collapsed .sec-head { justify-content: center; padding: 10px 0; }
.sidebar.collapsed .sec-head.flyout-active .sec-icon { color: var(--color-primary); }
.sidebar.collapsed .sidebar-footer, .sidebar.collapsed .sidebar-resizer { display: none; }

.flyout-backdrop { position: fixed; inset: 0; z-index: 598; }
.nav-flyout {
  position: fixed; left: 44px; min-width: 180px;
  max-height: calc(100vh - 16px); overflow-y: auto;
  background: var(--color-surface); border: 1px solid var(--color-border-strong);
  border-radius: 0 6px 6px 0; box-shadow: 4px 0 20px rgba(0,0,0,.3); z-index: 599;
}
.nav-flyout .sbi { padding-left: 14px; }    /* override the normal 32px */
.nav-flyout .sbi-leaf { padding-left: 28px; }
```

Active icon: bind `:class="{ 'flyout-active': sidebarCollapsed && openFlyout === 'key' }"` on each `.sec-head`.

Toggle button position: `left: (sidebarCollapsed ? 44 : sidebarWidth) + 'px'` (the `transform: translateX(-50%)` straddles the edge).

**`position: fixed` is required for the flyout** — the sidebar has `overflow: hidden`; absolute positioning within it would clip at the sidebar boundary. `left: 44px` pins to the right edge of the icon rail without coordinate math.

## Alert status 3-state pill

Alerts have three states that need distinct colors everywhere they appear (mini-table in DeviceDetailPage, detail page topbar, etc.):

```typescript
function alertStatusClass(a: AlertState) {
  if (!a.is_alerting) return 'status-resolved';
  if (a.acknowledged_at)  return 'status-acked';
  return 'status-open';
}
function alertStatusLabel(a: AlertState) {
  if (!a.is_alerting) return 'Resolved';
  if (a.acknowledged_at)  return 'Acknowledged';
  return 'Open';
}
```

```css
.status-open     { background: rgba(232,86,106,.12); color: var(--color-danger); }
.status-acked    { background: rgba(240,180,40,.12);  color: var(--color-warning); }
.status-resolved { background: rgba(34,197,94,.12);   color: var(--green); }
```

## Alert Detail page layout (`AlertDetailPage.vue`)

Follows `JobDetailPage.vue`'s shell (breadcrumb + title topbar + section cards). Class prefix: `.ad-`.

**Overview card**: `.ad-grid` — `display: grid; grid-template-columns: 1fr 1fr; gap: 0 32px`. Each field is a `.ad-row` with `.ad-label` / `.ad-val`.

**Timeline card**: vertical event spine. Each event: `display: flex; gap: 12px`. Left column: relative time string + absolute date in `.ad-time-abs`. Right column: icon + title + detail text. Events connected by a vertical line (CSS `border-left: 2px solid var(--color-border-strong)` on a wrapper div, offset so it runs through the icon centers).

**Device Alerts card**: plain `<table>` of the same device's alert history, loaded via `api.alerts.list('all', '', '', alert.value.device_id)`. Current alert highlighted: `.ad-row-current { background: rgba(78,126,247,.06); }`. Row click navigates to that alert's detail (self-referential navigation, flyout closes naturally via route-change watch).

**Acknowledge action**: optimistic update — set `alert.value.acknowledged_at = new Date().toISOString()` and `acknowledged_by = authState.user?.displayName ?? ''` before API call. Button hides via `v-if="!alert.acknowledged_at && alert.is_alerting"`. No rollback on API failure (acceptable — the page will show stale state until next refresh, which is acceptable for an ack action).

**Hono route order gotcha**: `GET /:id` must be registered *before* `/:id/resolve` and `/:id/acknowledge` in `alerts.ts`. Hono matches in registration order — `/resolve` would match `:id = 'resolve'` and 404 if registered first.

Lock cursor on `document.body` during drag (via class) so fast mouse movement over other elements doesn't snap the cursor.

## Attach a lone checkbox to an adjacent control, don't give it its own row

A checkbox that's the only thing in its grid cell reads as visually "detached" — floating with no clear association to anything nearby — even with normal spacing (real user feedback on `ComponentFormPage.vue`'s Variables "Required" checkbox, which sat alone in a `.field` grid row right after Description). Fix: nest it beside the field it actually relates to, in a small flex wrapper, rather than giving it a standalone `.field`:

```html
<div class="field">
  <label>Type</label>
  <div class="type-required-row">
    <select v-model="varForm.type">...</select>
    <label class="checkbox-label"><input type="checkbox" v-model="varForm.required" /> Required</label>
  </div>
</div>
```
```css
.type-required-row { display: flex; align-items: center; gap: 12px; }
.type-required-row select { flex: 1; }
```

**CSS-specificity gotcha found in the same fix**: a `.checkbox-label` nested inside a `.field` div gets its intended styling (12px, normal-case text) silently overridden by the global `.field label` rule (uppercase, muted, 11px, letter-spacing) — `.field label` (class + element selector) outweighs a bare `.checkbox-label` (single class) regardless of scoped-style load order. Invisible until compared against an identical `checkbox-label` used correctly elsewhere on the same page (e.g. Post-conditions' "Enabled" checkbox, which isn't nested inside `.field` and never hits the collision). Fix by bumping specificity, not `!important`:
```css
.field .checkbox-label { text-transform: none; font-size: 12px; color: var(--color-text-primary); letter-spacing: normal; }
```
Any time a `checkbox-label` (or similar small inline control) ends up nested inside a `.field` wrapper, check it isn't silently inheriting the field-label look before assuming the scoped CSS "just works."

## Bulk action modal: pick existing or create new (Devices list "Add to Group")

`DevicesPage.vue`'s bulk toolbar (already had Reboot/Audit/Maintenance actions) gained "Add to Group" using the same `.modal-backdrop`/`.modal` shell as the existing Maintenance modal. The pick-existing-or-create-new choice is a plain `<select>` with a sentinel empty value meaning "new," not a separate toggle/tab:
```html
<select v-model="groupPickId" class="field-input">
  <option value="">+ New group…</option>
  <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
</select>
<input v-if="!groupPickId" v-model="newGroupName" class="field-input" placeholder="New group name" />
```
Submit either creates the group first (if `groupPickId` is empty) or uses the picked id, then calls the bulk-add endpoint once for the whole selection — one API round trip regardless of how many devices are checked. Reasonable default for the next "assign selection to an existing-or-new bucket" bulk action.
