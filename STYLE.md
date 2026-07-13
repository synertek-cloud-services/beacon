# Beacon — UI/UX Style Guide

Dark-first design system. All tokens defined in `dashboard/src/style.css` as CSS custom properties.

## Design tokens

```css
--bg:        #0c0e16   /* page background */
--surface:   #141720   /* cards, sidebar, topbar */
--surface-2: #1c1f2e   /* table headers, expanded rows, hover states */
--border:    #232638   /* standard dividers */
--border-2:  #2d3148   /* form inputs, stronger outlines */
--text:      #d8daf0   /* primary text */
--muted:     #616480   /* labels, timestamps, secondary text */
--muted-2:   #8486a8   /* nav items unselected, sub-labels */
--accent:    #4e7ef7   /* primary blue — CTAs, active state, links */
--teal:      #2dcfa0   /* online/success/approved */
--amber:     #f0a840   /* warning, pending */
--red:       #e8566a   /* error, offline, danger */
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

## Typography scale

| Usage | Size | Weight | Color |
|---|---|---|---|
| Page title (`h1`) | 20px | 700 | `--text` |
| Section label (form groups in PolicyFormPage) | 15px | 600 | `--text` |
| Body / table cells | 13px | 400 | `--text` |
| Table column headers | 10–11px | 600–700 | `--muted`, uppercase, 0.04–0.08em spacing |
| Badges / chips | 10–11px | 700 | varies by type |
| Sub-labels / timestamps | 11–12px | 400 | `--muted` or `--muted-2` |

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
.check-chip.chip-offline       /* amber tint   — var(--amber) tint (also used for "Online Status" label) */
.check-chip.chip-cpu_usage     /* red tint     — rgba(240,80,60,.12)   / #e04040 */
.check-chip.chip-memory_usage  /* accent blue  — rgba(78,126,247,.14)  / var(--accent) */
.check-chip.chip-av_status     /* teal tint    — rgba(45,207,160,.14)  / var(--teal) */
.check-chip.chip-file_size     /* grey tint    — rgba(132,134,168,.16) / var(--muted-2) */
.check-chip.chip-ping          /* teal tint    — rgba(45,207,160,.14)  / var(--teal) (shares teal with av_status, contexts don't collide) */
.check-chip.chip-process       /* amber tint   — rgba(240,168,64,.16)  / var(--amber) (shares amber with offline) */
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
- Track: 28×16px, border-radius 8px, `--border` → `--accent` when enabled
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

Primary variant for the active state: add `.seg-primary` to the button — gives it `--accent` background instead of surface white.

## Modals

Centered modal pattern (used for Override, confirmation dialogs):
```html
<Teleport to="body">
<div class="modal-backdrop" @click.self="close">
  <div class="modal">
    <div class="modal-header">...</div>
    <div class="modal-body">...</div>
    <div class="modal-footer">...</div>
  </div>
</div>
</Teleport>
```

Modal: 440px wide, max 95vw, max 90vh, border-radius 10px, `var(--shadow)`.

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
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 32px rgba(0,0,0,.4);
}
```

Sidebar stays visible because `.sidebar { z-index: 600 }` is above the drawer's `z-index: 500`.

Use `<Teleport to="body">` so the drawer escapes any `overflow: hidden` parent.

## PolicyFormPage layout

Full-page form pattern:

```
.pf-page (flex column, min-height: 100%)
  .pf-crumb  (breadcrumb: 12px, --muted, accent links)
  .pf-topbar (back button + h1 + Cancel/Save)
  .pf-body (flex column)
    .pf-group (each section: flex column, gap 10px, padding 20px 0, border-bottom)
      .pf-label (15px, 600, --text)
      <content>
```

Each `.pf-group` is max-width 760px. The label font-size is larger (15px) than the global field label (11px uppercase) to match Datto-style section headers.

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
.field-hint { font-size: 11px; color: --muted; margin-top: 4px; }
.field-hint-warn {
  color: --amber;
  background: rgba(240,168,64,.08);
  border: 1px solid rgba(240,168,64,.2);
  border-radius: 5px; padding: 6px 10px;
}
```

Used when CPU threshold ≥ 95% to warn about 100% CPU reliability.

**Note**: `.field-hint` is defined per-component (scoped styles), not globally — it exists independently in `PolicyFormPage.vue`, `GlobalPoliciesPage.vue`, and `TenantsPage.vue`. Adding it to a new component that doesn't already have it needs its own copy of the CSS rule (`display:block; font-size:11px; color:var(--muted); margin-top:6px;`), not just the class name — Vue scoped styles don't leak across components.

## Optional-condition checkbox (checkbox toggles between a value and `null`)

Used for the Add Monitor drawer's optional numeric conditions (disk's min-size filter, ping's packet-loss/latency thresholds) — the checkbox's checked-state *is* whether the field is `null`, there's no separate boolean flag:

```html
<label class="mf-check-row">
  <input type="checkbox" :checked="form.x !== null"
    @change="form.x = ($event.target as HTMLInputElement).checked ? DEFAULT_VALUE : null" style="accent-color:var(--accent)" />
  <span>Alert when...</span>
</label>
<div v-if="form.x !== null" class="mf-row" style="margin-top:6px">
  <input v-model.number="form.x" type="number" class="mf-input" style="max-width:90px"/>
</div>
```

Uses `:checked`/`@change` rather than `v-model` on the checkbox itself, since `v-model` would need a separate boolean ref to bind to — deriving checked-state from `!== null` keeps the number field as the single source of truth.

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
  border-left: 2px solid --accent;
}
```

Sub-links (e.g., Devices) use `.sbi-leaf` with `padding-left: 48px`.

## Sidebar resizer

```css
.sidebar-resizer {
  position: absolute; top: 0; right: -3px; bottom: 0;
  width: 6px; cursor: col-resize; z-index: 10;
}
.sidebar-resizer:hover { background: rgba(78,126,247,.35); }
body.sidebar-resizing { cursor: col-resize !important; user-select: none !important; }
```

Lock cursor on `document.body` during drag (via class) so fast mouse movement over other elements doesn't snap the cursor.
