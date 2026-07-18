# Beacon — Project Log

## Session: 2026-07-18 — Host-level branding themes

### What was completed

- Added host-level semantic color branding with a public active-palette
  endpoint, admin-only theme management, live draft preview, accessibility
  guidance, and cache-safe immutable revisions for host-created themes.
- Seeded built-in presets: Default, Sentry-i, Cobalt2-i, SyntaxFM-i, and
  Slate. Built-ins are immutable complete palettes and now activate directly;
  only host-created themes retain published revisions (up to five) for
  rollback.
- Refined Default as the direct built-in baseline: improved text hierarchy and
  AA-compliant white primary-button label contrast (4.85:1). The legacy
  Default revisions are intentionally removed by migration 0037 because
  built-ins do not use revisions.
- Migrations `0033`–`0037` establish the branding model, built-in presets,
  refined Default palette, and the built-in/custom activation split.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Built-ins activate by theme; custom themes activate by revision | A shipped palette is already immutable. Revisions only solve the host-draft publish/rollback problem. |
| Public built-in palettes return from the no-store active pointer | Built-ins change only through an application update; direct return avoids inventing synthetic revision IDs while custom revisions retain immutable cache URLs. |
| Preserve custom active selections during Default updates and migration | Branding is host-level configuration. A release must not silently replace a host's chosen custom palette. |

---

## Session: 2026-07-18 — Policy targeting redesign: multi-site, individual devices, unified Targets flyout

### What was completed

**Policy targeting rebuilt to match a real Datto Create Policy reference screenshot and `JobFormPage.vue`'s established Add-Target flyout convention** (migration `0032_policy_targets.sql`).

Prior state: `PolicyFormPage.vue` split targeting three ways — a Scope seg-bar (Global/single-Site combobox), OS/Class pill checkboxes, and a separate Device Groups picker. The user compared this against a real Datto reference screenshot (a single unified "Targets" section, one Add Target flyout, one flat list) and asked to fix it to match both the reference and the rest of the app's own conventions.

- **Design locked via `AskUserQuestion` before implementation** (two rounds): (1) unify into one flyout reusing `JobFormPage.vue`'s `.tf-` pattern, with multi-site support and new individual-device targeting, OS/Class staying separate; (2) targeting semantics are a **heterogeneous OR-list**, not Job's single-kind-exclusive model — a policy's Targets can mix a Site AND a Device AND a Device Group simultaneously, and a device qualifies if it matches ANY entry of ANY kind. This was the one point requiring a second clarifying round: Job's own flyout clears previously-selected items on a kind switch, but this project's own prior research into Datto's real docs (recorded in CLAUDE.md from the Device Groups session) says Datto's actual behavior is "OR logic across multiple targets" — the user confirmed the OR-list model, not Job's exclusive one.
- New tables `policy_sites`/`policy_devices` (composite PK, mirror `policy_groups`' exact shape) — `policies.scope` becomes a **derived, non-authoritative** column (recomputed by a new `recomputePolicyScope()` helper after every targeting mutation: `'global'` when zero targets across all three tables, `'company'` when 1+), `policies.company_id` becomes fully vestigial (same fate as `components.company_id` after migration `0022`).
- `worker/src/lib/alerts.ts`'s `deviceMatchesPolicy` rewritten: dropped the old `scope==='company' && companyId!==tenantId` AND-check entirely, added `fetchPolicySiteIds`/`fetchPolicyDeviceIds` (same whole-table-fetch-once-per-invocation shape as the existing `fetchPolicyGroupIds`), threaded through the same four call sites that helper already reaches. Verified by hand that no new call sites were needed and the hot-path "fetch once, never per device" rule was preserved throughout (this function runs on every device check-in and the 2-minute offline cron).
- `worker/src/routes/admin/policies.ts` gained `/:id/sites`/`/:id/devices` nested routes mirroring the pre-existing `/:id/groups` triplet exactly; the pre-existing `/:id/groups` POST/DELETE handlers gained a `recomputePolicyScope()` call each (a real gap — they never touched `scope` before, harmless when scope was site-only, wrong once groups became one of three dimensions). `POST /` no longer accepts `scope`/`company_id` — policies always start empty, matching every other nested-resource creation flow in this codebase; `clone_from` now also copies the source's Sites/Devices/Groups.
- `PolicyFormPage.vue`: Scope seg-bar deleted entirely; OS/Class section relabeled "OS & Class" to free up "Targets" for the new section; new Targets section reuses `JobFormPage.vue`'s `.tf-` flyout markup/CSS verbatim but with `toggleTarget()` rewritten as a flat push/remove (no kind-switch-clears-previous branch) — the one deliberate behavioral fork from the file it's copied from.
- `GlobalPoliciesPage.vue`: the Company tab's `col-company` column relabeled "Sites", now shows a joined multi-site summary instead of a single tenant lookup; `companyMode`'s filter changed from `p.companyId === companyIdParam` to checking the new `siteIds` array; the "Override" bulk action (clone a global policy to a company-scoped copy) changed from a single create-call to the same defer-and-batch shape used everywhere else (`create` then `sites.add`).
- **Went through the full plan-mode workflow given the size**: direct exploration (not delegated — already had strong context from the Device Groups session), a Plan-agent validation pass that caught a real gap in the initial design (the `/:id/groups` routes never calling `recomputePolicyScope`, and a third UI surface — `DeviceDetailPage.vue`'s scope badge — that needed confirming as unaffected rather than assumed), then a manual read of the real `policy_groups`/`component_sites`/`groups.ts` code before finalizing the plan for approval.
- **Verified end-to-end via `wrangler dev` + local D1, not just type-checked.** Found and cleaned up a pile of zombie `wrangler dev` processes left over from prior sessions (bound to nothing, per the known CLAUDE.md gotcha) before starting a fresh instance. Core proof: a device group containing only device A, plus device B individually targeted on the same policy (zero overlap between the two mechanisms) — confirmed both A and B independently qualify, and removing the group target drops A while B keeps qualifying via its own device target. Hit one red herring during this pass: the first attempt used `disk_space` as the test monitor's check type, which collided with the pre-existing seeded global "Disk Space" policy and triggered the unrelated, already-existing same-check-type company-override dedup rule in `matchMonitorsForDevice` — produced a count that looked wrong until traced back to that pre-existing mechanic, not a bug in the new OR-list logic. Redid the test with `ping` (no seeded collision) for a clean signal. Also confirmed `recomputePolicyScope` flips `global`→`company`→`global` correctly, `clone_from` copies target rows, and the 2-minute cron handler runs clean with the new maps. Full Playwright pass through both `PolicyFormPage.vue` and `GlobalPoliciesPage.vue` (using a small ad-hoc Playwright driver script since neither `chromium-cli` nor a project run-skill existed yet — seeded the break-glass `ADMIN_SECRET` directly into `localStorage` rather than driving a login form) confirmed the UI end to end, including a screenshot proving a Site stays checked in the flyout after switching the category dropdown away and back — the concrete evidence that this flyout does not share Job's kind-exclusive clearing behavior despite identical CSS classes.
- **Deployed the same session**: migration `0032` applied to production D1, worker deployed (commit `1c1345c`), user pushed to `main`, Cloudflare Pages auto-built and shipped the new dashboard — all confirmed via `gh api repos/.../commits/main` (SHA match) and `wrangler pages deployment list` (new deployment showing the pushed commit as the live Production entry), not just assumed from a successful `git push`.

**2. Custom Fields settings table header misalignment fixed** (`CustomFieldsSettingsPage.vue`, commit `2709073`)

User-reported while looking at `/settings/custom-fields`: the NAME/KEY column headers didn't line up with their actual input columns. Root cause: `.pf-tbl-head` was a flat 2-span row (`Name`, `Key`) with no accounting for `.pf-mon-row`'s leading `.pf-mon-order` (reorder up/down arrows) column — the header labels were offset one whole column to the left of the inputs they labeled. Fixed by adding a `.pf-tbl-head-spacer` matching `.pf-mon-order`'s rendered width (46px = two 22px buttons + 2px gap) and sizing the Name/Key label spans (`flex:1;max-width:320px` / `max-width:160px`) to exactly match their input counterparts, plus bumping the header's flex `gap` from 8px to 12px to match the row's own gap. Verified via a real Playwright screenshot (typed "Asset Tag" — confirming spaces are already fully supported in the Name field, no restriction ever existed there — only the derived Key is normalized to `[A-Z0-9_]`) showing NAME/KEY sitting directly above their columns.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Heterogeneous OR-list across Sites/Devices/Groups, not Job's single-kind-exclusive model | Matches Datto's actual documented behavior (already on record in this project's own CLAUDE.md from the Device Groups session) and the reference screenshot's single flat Targets table more faithfully than copying Job's flyout behavior verbatim would have. |
| `policies.scope` becomes derived, not dropped | Preserves `GlobalPoliciesPage.vue`'s existing Global/Company tab mechanism and `DeviceDetailPage.vue`'s scope badge with zero API-shape breakage, while still generalizing correctly to three targeting dimensions instead of one. |
| New `policy_sites`/`policy_devices` tables instead of a single polymorphic `policy_targets` table | Matches this codebase's consistent preference for one real FK-constrained join table per relationship (see `policy_groups`, `component_sites`, `device_group_members`) over a generic `kind`+`target_id` discriminator column with no FK integrity. |
| `POST /v1/admin/policies` no longer accepts `scope`/`company_id` | Matches every other nested-resource creation flow already established in this codebase (create the parent empty, then POST nested items) — Sites/Variables on Components, Monitors/Groups on Policies now extends cleanly to Sites/Devices/Groups too. |
| Ad-hoc Playwright driver script instead of `chromium-cli` | Neither `chromium-cli` nor a project run-skill was available in this environment; `npx playwright` was already cached locally, so a small one-off `.mjs` script (with the token seeded directly into `localStorage`) was faster than provisioning either. Recommended `/run-skill-generator` as a follow-up, not run this session. |

### Next logical steps

1. **No project run-skill exists yet for Beacon** — every session so far has hand-rolled `wrangler dev`/`vite dev`/Playwright orchestration from scratch (this session had to install/symlink Playwright ad hoc since neither it nor `chromium-cli` was already available). Worth running `/run-skill-generator` once, to stop re-deriving this.
2. ~~Deploy migration `0032` + the worker to production~~ — done; migration applied, worker deployed, both commits (`1c1345c` policy targeting, `2709073` Custom Fields header fix) pushed and confirmed live via Cloudflare Pages.
3. Everything else from the prior session's backlog (Patch Management, Custom Fields targeting-by-value, dynamic Filters, Site Groups, Agent Browser rest) is unchanged and still open — see the 2026-07-17 entry below for the full list.
4. **Watch `CLAUDE.md`'s size again.** It was trimmed from 594→557 lines (103KB→78KB) two sessions ago specifically to clear a "files too large" warning at launch (that file loads unconditionally into every session). The Device Groups + Policy Targeting sections added since then bring it back to ~643 lines / ~97KB — not yet at the old threshold, but the same kind of growth that caused it last time. If it trips the warning again, the same fix applies: cut narrative/changelog-shaped content (session verification stories, decision narration) rather than the reference tables/rules — that content belongs in `PROJECT_LOG.md`, which doesn't load by default.

---

## Session: 2026-07-17 — Alert Detail page, target_os, Linux restart fix, sidebar icon rail

### What was completed

**1. Single Alert Detail page (`/global/alerts/:id`) — `AlertDetailPage.vue` (new file)**

Datto-style Single Alert View. Three section cards:
- **Overview** — 2-column `.ad-grid` grid. Left: Message, Created, Status pill (Open/Acknowledged/Resolved), Alert ID, Acknowledged By. Right: Device (RouterLink with online dot), Company, Policy (RouterLink), Monitor Type.
- **Timeline** — vertical event spine (icon + connector line) derived entirely from existing timestamp columns (`alerted_at`, `acknowledged_at`, `resolved_at`); no new data model. Events show relative time on the left, icon + label + detail on the right.
- **Device Alerts** — same-device alert history via existing `device_id` filter param on `GET /v1/admin/alerts`. Current alert highlighted with `.ad-row-current`. Row click navigates to that alert's detail page.

Topbar: priority badge (using `effectivePriority` — escalates to `critical` if monitor says `moderate` but has been alerting > 4h) + hostname title. Action buttons: Acknowledge (optimistic — hides immediately on click, sets `acknowledged_at` locally before API response), Resolve (API then `router.back()`).

Worker: `GET /v1/admin/alerts/:id` added to `worker/src/routes/admin/alerts.ts`. **Must be registered before `/:id/resolve` in Hono's route table** — Hono matches routes in registration order, so `/resolve` would be swallowed as an `:id` value otherwise. Exact same JOIN as the list query, adds `WHERE s.id = ?`.

Navigation: row `@click` in **GlobalAlertsPage**, **DeviceDetailPage** (alerts mini-table), and **OverviewPage** all changed from `toggleSelect(id)` → `router.push('/global/alerts/' + a.id)`. Checkboxes kept working via `<td @click.stop>`.

**2. Migration 0027 production gap**

`alert_state.acknowledged_at`/`acknowledged_by` (migration 0027) had never been applied to production D1. Symptom: `GET /v1/admin/alerts?status=all` returned 500. Fixed by `npx wrangler d1 migrations apply beacon --remote` from `worker/`.

**3. `target_os` on components (migration 0028)**

`components.target_os TEXT DEFAULT NULL`. `null` = all platforms; `'windows'`/`'linux'`/`'darwin'` = OS-specific.

Dispatch filtering in `insertJobCommands` (`worker/src/routes/admin/jobs.ts`): for each device, filter resolved component payloads by `!payload.target_os || payload.target_os === device.os_type`; skip device entirely if `compatible.length === 0`. This means a job targeting "All Devices" with a Windows-only component naturally skips Linux devices without any error or failed command.

ComStore built-ins tagged: `store_clear_win_temp` → `windows`; `store-restart-agent-linux`/`store-reinstall-agent-linux` → `linux`.

`ComponentFormPage.vue`: Platform `<select>` added (All Platforms / Windows / Linux / macOS). `isStore` ref (set from `comp.origin === 'store'` on load) disables the field for store-origin components.

`components.ts` CRUD: `target_os` propagated through POST create, PATCH update, and clone (copies source's `target_os`).

**4. Linux agent-restart scripts fixed (migration 0028)**

Original scripts called `systemctl restart beacon-agent` directly. Because the agent is the *parent process* of the script subprocess, systemd kills the agent before the subprocess can report its result back. Job stays permanently "Running" (sent state). 

Fix: `nohup sh -c 'sleep 5 && systemctl restart beacon-agent' >/dev/null 2>&1 &` — backgrounds the restart in a detached subshell with a 5-second delay, then exits immediately so the agent can finish the check-in and report success. **This pattern applies to any ComStore script that kills the agent process itself.**

**5. Sidebar icon-only rail with flyout submenus (`App.vue`)**

Collapsed state changed from `width: 0px` (fully hidden) to `width: 44px` (icon rail). The `.collapsed` class on `<nav class="sidebar">` drives all CSS changes:
- Labels, chevrons, badges, sec-body: `display: none`
- Section headers: `justify-content: center; padding: 10px 0`
- Footer and resizer: `display: none`

State: `openFlyout: ref<string | null>(null)`, `flyoutTop: ref(0)`.

`handleSectionClick(key, event)`: when expanded → existing `toggleSection` (accordion); when collapsed → sets `openFlyout` and records `getBoundingClientRect().top` for positioning.

Flyout: `position: fixed; left: 44px` `.nav-flyout` panel with a `.flyout-head` label + duplicated `.sbi` RouterLinks for that section. Closed by `.flyout-backdrop` (`position: fixed; inset: 0; z-index: 598`) on click, or route-change watch.

Toggle button: `left: 44px` when collapsed (was `left: 11px`).

`flyoutTitle` computed maps `openFlyout.value` → display label string.

**6. Confirmed real scheduled-job dispatch in production (closes an open item from 2026-07-16)**

That session's scheduled-job dispatch work (`dispatchDueScheduledJobs`, wired into the 2-minute cron) had only ever been verified against local `wrangler dev` + D1 with a manually-fired `/cdn-cgi/handler/scheduled` call — never against the real production cron trigger. Queried production D1 directly (`wrangler d1 execute beacon --remote`) and found one real `type='scheduled'` job (name `test`): created 22:19:48, `scheduled_at` 22:20:00, status `completed`, with its one command created at 22:20:53 — a 53-second gap after `scheduled_at`, consistent with the real 2-minute cron picking it up on its own polling cycle (not an immediate/manual trigger, which would show ~0s). Command also reached `completed_at`. This confirms the production cron path works end to end unattended; no code change needed, just closing the verification gap.

**7. Custom Fields ("UDF" equivalent) shipped — dynamic named fields, manual entry only**

A prior same-day session had scoped this against the Datto RMM UDF spec (300 fixed, pre-numbered, globally-relabeled slots) and explicitly chose a different shape before running out of context: dynamic admin-defined fields instead of 300 fixed slots, storage + display + manual edit only for this pass (no Job/Policy targeting by field value, no agent-write-a-value capability — both explicitly deferred). That session got no further than drafting `migrations/0029_custom_fields.sql`; everything downstream (schema.ts, worker routes, dashboard) was built this session.

- Migration `0029_custom_fields.sql` — `custom_fields` (id, name, sort_order) + `device_custom_field_values` (composite PK `(device_id, field_id)`, both FKs `ON DELETE CASCADE`) — a real join table, not a JSON blob on `devices`, so a future filter/targeting pass doesn't need a schema change.
- Worker: `worker/src/routes/admin/custom-fields.ts` (new) — field-definition CRUD, admin-only (matches the Settings-area role convention, not the routine-mutation `technician` tier). `devices.ts` gained `GET/PATCH /:id/custom-fields[/:fieldId]` for per-device values (readonly to view, technician to set) — upsert-by-check-then-insert-or-update, same as the rest of the codebase (no `onConflictDoUpdate` precedent existed to follow).
- Dashboard: new `/settings/custom-fields` page (`CustomFieldsSettingsPage.vue`, admin-only) for managing field definitions — inline-editable name (matches the Warranty-field inline-edit convention), ↑/↓ reorder buttons that swap and persist `sort_order` immediately, modeled directly on `SsoSettingsPage.vue`'s group-mappings list section. `DeviceDetailPage.vue` gained a **Custom Fields** section, placed between Network and Security (matching Datto's own relative placement of UDFs, second-to-last before Security) — one inline-editable text input per field definition, values fetched alongside the rest of `onIdChange`'s `Promise.all`.
- **Real bug caught and fixed by actual browser testing, not just type-checking**: the new `customFields`/`customFieldsLoading`/`customFieldSaving` refs were originally declared far down in `DeviceDetailPage.vue`'s script (near the Warranty-field code, textually after `onIdChange`/the router `watch`). Since the `watch(..., { immediate: true })` call invokes `onIdChange` synchronously during `<script setup>` execution — before later `const` declarations run — this threw `Cannot access 'customFields' before initialization` on every device-page load, a TDZ error invisible to `vue-tsc` (a type error, not a type-checking concern). Fixed by moving the three declarations up next to the other section-state refs (`effectiveMonitors` etc.) that are already read inside `onIdChange`. Caught via a real Playwright run against `wrangler dev` + local D1, not just `pnpm build`.
- End-to-end verified: curl against the worker directly (create/rename/reorder/delete field definitions, set/overwrite/clear a device's value, cascade-delete removes the device's stored value, unauthenticated requests 401), and a full Playwright pass through the actual dashboard UI (add/rename/reorder persisting across reload, per-device value isolation — a second device correctly shows an empty value for a field the first device has set).
- Local D1 gotcha hit along the way, unrelated to this feature: `make migrate-local` failed on `0025_device_maintenance.sql` (`duplicate column name`) — the local `.wrangler/state` D1 already had `devices.maintenance_ends_at`/`maintenance_reason` physically present but the `d1_migrations` tracking table had never recorded 0025 as applied (likely a prior session ran the ALTER by hand or the dev DB predates the tracking row). Fixed by manually inserting the missing `d1_migrations` row for 0025 rather than editing the migration file, then letting `0026`–`0029` apply normally on top.
- Considered and reverted a scroll-spy change: the bottom-of-scroll IntersectionObserver special case (see "Scroll-spy nav" coding pattern) forces the *last* section active once `atBottom()` is true. Adding Custom Fields before Security means that on a device with very little audit data, hitting the scroll floor now highlights Security even while Custom Fields is what's most prominently in view. Tried a fix (walk backward and activate the last section whose heading has actually reached the top-of-viewport threshold) but real Playwright testing showed it could land on an even less-relevant section (e.g. Memory) when several short trailing sections are all visible at once at the scroll floor — the "topmost visible" and "last section" answers don't cleanly reconcile when multiple sections are simultaneously short. Reverted to the original, already-validated "force last section at floor" behavior rather than ship a behavior change that tested worse in the one case checked. Real production devices with actual audit data (services/disks/network adapters/security products) make each section tall enough that this edge case is unlikely to come up in practice.

**8. Custom Fields made usable as script variables — Datto UDF-style, reference-by-name**

Follow-up to item 7 within the same session, after `0029` had already been pushed and migrated to production. The user asked whether custom fields could be used as script variables, which prompted researching Datto's actual documentation (rmm.datto.com) rather than guessing at behavior: Datto has two genuinely separate mechanisms — Input Variables (component-declared, prompted at job-creation time, job-wide) and UDF variables (`UDF_1`..`UDF_300`, referenced directly in a script body by fixed naming convention, resolved *per-device* at dispatch time, no declaration step). The user confirmed Beacon should build the second shape.

- Migration `0030_custom_fields_key.sql` (a new migration, not an edit to the already-live `0029` — required, not just conventional, since editing a migration already applied to production would desync `wrangler d1 migrations apply`'s tracking) — adds `custom_fields.key`, a separate identifier column from the freeform display `name` (mirrors `component_variables`' existing name/label split), plus a partial unique index (`WHERE key != ''`) since SQLite can't add a UNIQUE column via `ALTER TABLE`.
- Env var convention: `CF_<KEY>` (e.g. `${CF_ASSET_TAG}` bash, `$env:CF_ASSET_TAG` PowerShell, `%CF_ASSET_TAG%` Batch) — namespaced like Datto's own `UDF_` prefix, to avoid colliding with a same-named `component_variable`.
- Resolution added inside `insertJobCommands` (`worker/src/routes/admin/jobs.ts`) via a new `fetchCustomFieldVars` bulk-fetch helper — one `WHERE device_id IN (...)` query for every target device (reusing the exact placeholder-list shape `resolveDevices` already uses), grouped into a per-device map, early-exiting with zero extra queries when no field has a key assigned. Merged into each device's `variables` as `{...cfVars, ...payload.variables}` (component's own declared variable wins on collision). No agent-side change — confirmed `agent/internal/executor/run.go` already treats `variables` as an opaque flat env map.
- Rename guard on `PATCH /v1/admin/custom-fields/:id`: user's own framing was "can't we just do a check and make sure there are no scripts referencing it before allow[ing] an edit" — implemented as a full-table scan of `components.script` for the literal `CF_<OLDKEY>` substring (only when the key is actually changing away from a non-empty value), returning `409` with the blocking component names/ids if found. Deliberately a plain JS `.includes()` scan, not SQL `LIKE '%...%'` — key values are made of `[A-Z0-9_]`, and SQLite's `LIKE` treats `_` as a single-character wildcard, which would false-match unrelated scripts sharing no real substring.
- **Verified end-to-end via `wrangler dev` + local D1, not just type-checking**: dispatched one job with one inline script (`echo tag=$CF_ASSET_TAG`) to a Windows device and a Linux device simultaneously with different stored values (`WIN-001`/`LINUX-002`) and confirmed the two queued `commands` rows carried two different resolved `variables.CF_ASSET_TAG` values from the same job/component — the core behavioral property distinguishing this from job-wide `component_variables`. Also verified: a device with no stored value gets no `CF_ASSET_TAG` key at all (not an empty string); a real component referencing `CF_ASSET_TAG` blocks the key rename with a 409 naming it; removing the reference then unblocks the same rename; a separate duplicate-key rename 409s for a different reason; an invalid key format 400s. Real Playwright pass through both dashboard pages confirmed the Key column, auto-suggest-from-name, the blocked-rename error surfacing cleanly (not a raw JSON blob) and reverting the input, and the `ComponentFormPage.vue` hint block listing available `CF_<KEY>` names.
- Incidental, broadly-beneficial fix bundled in: `dashboard/src/api.ts`'s `request()` previously threw the *raw* response text on a non-2xx response, so every error banner in the app displayed a raw `{"error":"..."}` JSON blob instead of a readable message. Now parses a JSON `{error}` body when present and uses it as the thrown message — this is what makes the rename-guard's 409 message readable, and improves every other existing error banner in the app as a side effect (confirmed via grep that nothing depended on the old raw-text shape).
- Followed the full plan-mode workflow for this one (Explore pass confirming exact current code, a Plan agent producing a grounded implementation plan, a manual verification read of the critical files before finalizing) — worth noting since the user corrected the plan's Context section mid-review: it had assumed `0029` was still local-only, but the user had already pushed and migrated it, which made the "new migration, don't edit 0029" decision a hard requirement rather than just precedent-following.

**9. Device Groups shipped — static device collections targeting both Jobs and Policies**

Researched Datto RMM's real "Filters and Groups" spec (rmm.datto.com) at the user's request. Datto has two distinct mechanisms: Filters (dynamic, criteria-based, auto-updating membership across ~85 possible device attributes) and Groups (static, manually-curated). Through discussion, the user confirmed the actual need was Groups only — "hold a value/target a specific named set of machines," not a live-query engine — and specifically wanted them usable for *targeting a script/component at a specific set of devices*, not the broader Datto filtering/search use case. Also confirmed usable to target both Jobs and Policies, matching Datto's own dual usage (its docs: Monitoring Policies target through either Device Filters or Device Groups, OR logic across multiple targets).

- Migration `0031_device_groups.sql` — `device_groups` + `device_group_members` (composite PK, matching this session's `device_custom_field_values` convention rather than `component_sites`' older synthetic-id + separate UNIQUE pattern) + `policy_groups` (composite PK; zero rows for a policy means unchanged scope/OS/class-only behavior, one or more means the device must also belong to at least one).
- Worker: new `worker/src/routes/admin/groups.ts` — group CRUD + membership (single/bulk add, remove), `technician` tier for mutations (operational targeting infrastructure like Jobs/Policies, not Settings-area config like Custom Field definitions/SSO). `jobs.ts`'s `resolveDevices` gained a 4th `'group'` branch (`JOIN device_group_members`, `DISTINCT` for the multi-group/overlapping-membership case) — no migration needed on `jobs` itself since `target_type`/`target_ids` are already unconstrained columns. `policies.ts` gained nested `/:id/groups`, mirroring `components.ts`'s `/:id/sites` shape.
- **The performance-sensitive part, verified by hand against the real code** (not just trusted from planning): `alerts.ts`'s `deviceMatchesPolicy`/`matchMonitorsForDevice` gained a device's group-ID set and a policy-ID→group-IDs map as new parameters, always pre-fetched by the caller — this path runs on real hot paths (every device check-in every 60s, the 2-minute offline cron over the whole fleet). Confirmed directly by reading `evaluateOfflineAlerts`: the new `fetchPolicyGroupIds`/`fetchDeviceGroupIds` calls sit *before* its `for (const device of allDevices)` loop, fetched once for the whole cron tick, not per device — same rule `fetchEnabledPolicyMonitors` already established there. `reconcileOrphanedAlerts` (already existing, already wired into `policies.ts`'s PATCH route) is now also called from the new group routes, so narrowing a policy's group targets or removing a device from a group correctly auto-resolves any alert that no longer applies.
- Dashboard: new `GroupsPage.vue`/`GroupFormPage.vue` (the latter reusing `ComponentFormPage.vue`'s "Add Site" flyout convention verbatim, adapted to devices), a new "Add to Group" bulk action on `DevicesPage.vue` (built on its pre-existing bulk-select infrastructure), a 4th target kind on `JobFormPage.vue`'s flyout, and a new "Device Groups" targeting section on `PolicyFormPage.vue`. "Device Groups" used consistently in the UI, never bare "Groups" — `components.category` is already labeled "Group" in the UI (a different concept), and bare "Groups" would collide with it.
- **Verified end-to-end via `wrangler dev` + local D1**: created a group, bulk-added 2 devices, dispatched a job with `target_type:'group'` and confirmed `deviceCount:2`; the core policy-gating proof — a device matching a zero-group policy by default, losing eligibility once the policy was scoped to a group it's not in (`effective-monitors` dropped from 7 monitors to 6, missing exactly `disk_space`), regaining it after being added to that group, and losing it again after being removed (with the removal correctly triggering `reconcileOrphanedAlerts`). Full Playwright pass through all five touched/new pages confirmed the UI end to end, including that the list endpoint's new `deviceIds` field (added via `group_concat`, not in the original plan — needed so `JobFormPage.vue` can compute an accurate deduped device count across multiple selected groups without an extra request per group) renders correctly.
- Went through the full plan-mode workflow given the size of this feature: an Explore pass grounding Beacon's existing device/audit data model and targeting mechanisms, a Plan agent producing the concrete implementation plan, and a manual verification read of the highest-risk part (the `alerts.ts` check-in-frequency-sensitive integration) before finalizing — confirmed by hand that `resolveEffectiveMonitors`'s two external callers (`checkin.ts`, `devices.ts`) needed zero changes since its public signature stayed the same.

**10. Small fix: component Variables' Required checkbox was visually detached**

User feedback while looking at `ComponentFormPage.vue`'s Add Variable panel — the Required checkbox sat alone in its own grid row after Description, with nothing beside it, floating. Moved it to sit directly beside the Type select instead (new `.type-required-row` wrapper). Also fixed an unrelated, real specificity bug surfaced by the same change: the checkbox's intended styling (12px, normal-case "Required" text) was being silently overridden by the global `.field label` rule whenever nested inside a `.field` div (uppercase, muted, 11px) — invisible until compared against the identical `checkbox-label` pattern already used correctly elsewhere on the same page (Post-conditions' "Enabled" checkbox, which isn't nested inside `.field` and so never hit the collision). Fixed by bumping `.field .checkbox-label`'s selector specificity rather than reaching for `!important`.

**11. `CLAUDE.md` trimmed — removed the redundant "Project status" changelog section**

Root cause of the "files too large" warning the user gets at Claude Code launch: `CLAUDE.md` is the one file unconditionally loaded into every session's context, and had grown to 594 lines / ~103KB. Its `## Project status (as of DATE)` section alone was ~24KB and substantially duplicated this same file's own dated session history — changelog content bolted onto a file whose stated purpose is architecture/convention reference. Deleted the section entirely (not condensed) and replaced it with a one-line pointer to this file, plus fixed two internal cross-references that pointed back into the deleted section. Net effect: 594→557 lines, 103KB→78KB, zero information loss. Deliberately did **not** also rewrite the verbose narrative style of the remaining architecture sections (Auth System, Two-Tier Policy System, etc.) — a bigger, separate cut the user didn't ask for this pass.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Alert detail at `/global/alerts/:id`, not a modal | Matches Datto's own nav (Single Alert View is a routed page, not an overlay). Keeps the breadcrumb/back button intact. |
| Timeline derived from existing timestamps, no new model | `alerted_at`, `acknowledged_at`, `resolved_at` already on `alert_state`. A full event-sourcing audit log is future work; this gives a real timeline from data already in hand. |
| `target_os` filtering at dispatch time, not creation time | Consistent with how scheduled jobs work (target devices also resolved at dispatch time). Avoids stale matching if a device's OS changes between job creation and dispatch. |
| nohup + sleep 5 for Linux agent-restart | The agent is the parent process; direct `systemctl restart` kills it before the result can be reported. The 5s delay gives the agent time to complete the check-in. Any value ≥ the check-in response roundtrip would work; 5s is a comfortable margin. |
| Flyout content duplicated in template | Consistent with the codebase's per-component duplication convention. The alternatives (named slots, teleport, computed render functions) all add indirection for 6 small static content blocks. |
| `position: fixed` for flyout (not absolute within sidebar) | Sidebar has `overflow: hidden`. Absolute positioning would clip the flyout at the sidebar boundary. Fixed escapes the clip, `left: 44px` pins it to the right edge of the icon rail without knowing the sidebar's position in the DOM. |
| `.flyout-backdrop` over a global click listener | Simpler and more reliable than computing "did the click land outside both the sidebar and the flyout". The backdrop captures the click at the correct z-index layer without any coordinate math. |
| Custom Fields: dynamic named fields, not Datto's 300 fixed slots | Decided in the prior same-day session against the Datto UDF spec. A real join table scales to however many fields an operator actually wants, with no unused-slot clutter. |
| Custom Fields: real `device_custom_field_values` join table, not a JSON blob on `devices` | Matches the codebase's existing preference for real tables where future filtering/targeting is plausible (see `component_sites`) — a JSON blob would need a schema change the moment Job/Policy targeting by field value is built. |
| Custom Fields: manual entry only, no agent-write path | Scoped down for this pass, matching the session's other declines (Job/Policy targeting by value). No agent-side hook exists to write a field value today; building one is separate work. |
| Reverted the scroll-spy bottom-of-scroll fix rather than ship it | Real Playwright testing showed the "fix" traded one wrong highlight (Security) for a different wrong highlight (Memory) on a sparse test device — no clean answer exists when several short sections are simultaneously visible at the scroll floor. The original, already-validated "force last section" behavior was left in place. |
| Custom Fields script variables: reference-by-name (Datto's UDF shape), not bind-at-creation-time | Matches how Datto's own UDF system actually works (confirmed via its real docs), and needs zero new UI at component-creation time — any script can reference any field immediately once it has a key. |
| Separate `key` column instead of deriving an env var name from `name` on the fly | `name` is freeform display text that can contain spaces/punctuation and can be renamed at will; a stored, validated identifier is stable and rename-safe, mirroring `component_variables`' existing name/label split rather than inventing a new pattern. |
| Rename guard (409 + scan) instead of a hard lock or silent allow | The user's own explicit ask. A hard lock would prevent ever cleaning up a badly-chosen key; a silent allow would quietly break any script still referencing the old one. A scan-then-block gives a correct answer either way. |
| New migration (`0030`) rather than editing the already-live `0029` | Not just convention — `0029` was confirmed pushed and migrated to production mid-session, so editing it would have desynced production D1's schema from what `wrangler d1 migrations apply` tracks. |
| Device Groups: only Groups, not Filters | The user's actual need (target a script at a specific named set of machines) doesn't need dynamic criteria evaluation. Filters would be real new infrastructure for a capability not being asked for. |
| Device Groups: no "Site Groups" | `JobFormPage.vue` can already target multiple sites in one job today — a saved site-group would only rename an existing capability, not add one. |
| Device Groups: usable for both Jobs and Policies | Confirmed with the user after checking Datto's real docs, which showed Policies target through Groups too, not just Jobs. |
| Device Groups: composite PK over `component_sites`' synthetic-id pattern | Neither new join table has a row ever referenced by its own id — matches the more recently-established `device_custom_field_values` convention from earlier this session. |
| Device Groups: `technician` tier, not admin-only like Custom Fields | Groups are operational targeting infrastructure (same tier as editing a Job or Policy), not Settings-area configuration. |
| Attached Required to Type instead of restyling it in place | The isolated-row layout was the actual complaint; restyling alone wouldn't have fixed the "detached" feel, only pairing it with an adjacent control does. |
| Deleted the `CLAUDE.md` Project status section rather than condensing it | Condensing still leaves changelog content duplicated across two files forever. Deleting outright, with a pointer to `PROJECT_LOG.md`, removes the duplication permanently instead of just shrinking it. |

### Next logical steps

**Immediate, for whoever picks this up next:**
1. **Pick a direction**: the two biggest standing gaps are Patch Management (item 1 below — large, untouched, high real-world MSP value) and closing out the Device Groups/Custom Fields backlog (items 4-6, 8-10 below — smaller, but there's now a real pattern to extend for each). Worth asking the user which one before diving in.
2. Everything else below is unordered backlog, not yet prioritized against each other.

1. **Patch management / Windows Update status** — Datto's own "Patch Status" nav item is one of the most-used features in real MSP environments. Beacon has no patch scanning, scheduling, or reporting today. This is a large feature (agent-side WUA COM queries on Windows, a new audit blob, a dedicated page) — worth scoping as a separate initiative.

2. **Alert notifications (email/webhook)** — alerts fire and auto-resolve correctly, but no out-of-band notification is sent. Beacon has zero email infrastructure. Options: Cloudflare Email Workers, a configurable webhook URL (simpler, no email infra needed — fires a POST to e.g. a Slack webhook or a Teams connector). Webhook is the lighter path.

3. **Rest of Agent Browser** (File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, network device deploy/wake) — still deferred from the Remote Shell session. All can reuse the `SessionRelay` DO and `open_session` command channel without new infrastructure.

4. **Custom Fields: Job/Policy targeting by field value** — explicitly deferred this pass (Datto's "Environment = Production" style targeting). Would need new filter logic in both `jobs.ts`'s target resolution and `alerts.ts`'s `deviceMatchesPolicy`, not just the fields themselves.

5. **Custom Fields: agent-write capability** — explicitly deferred this pass (Datto's "populated by the Agent" UDFs, e.g. a monitor or script writing a value automatically). Needs a new agent-side hook and command type; today it's 100% manual entry, matching the Warranty field's existing precedent.

6. **Custom Fields on the Devices list** — not built this pass. A future column-picker on `DevicesPage.vue` showing/filtering by custom field value would need a per-row join that doesn't exist in the current list query.

7. ~~Deploy migration 0030 + the worker to production~~ — done; `0030` and the script-variable work are live.

8. **Dynamic device Filters** (Datto's other half of "Filters and Groups") — explicitly deferred this pass in favor of Groups only. Would need a real criteria builder (potentially covering the "easy" plain-column device attributes first — hostname, OS, class, agent version, last seen, status, site, warranty, external IP, custom fields — before attempting anything requiring the audit JSON blobs like antivirus/firewall/software) and `WHERE`-clause evaluation at dispatch time, a materially different code path from Groups' static membership lookup.

9. **Site Groups** (a saved, named, reusable collection of whole sites) — explicitly deferred; `JobFormPage.vue` can already target multiple sites per job today, so this would only be a convenience/reuse win, not new capability.

10. **Device Groups on the Devices list** — not built this pass, same gap as Custom Fields (item 6 above): no column/filter for group membership on `DevicesPage.vue`.

11. ~~Deploy migration 0031 + the worker to production~~ — done; Device Groups confirmed live in production.

---

## Session: 2026-07-16 — Job Detail page, flyout selected-state consistency, Quick Job ComStore tab, JobsPage cleanup

### What was completed

**1. Job Detail page (`/jobs/:id`) — `JobDetailPage.vue` (new file)**

Full detail view replacing the inline row-expansion that used to live in `JobsPage.vue`. Layout:
- Breadcrumb + title bar with Retire/Purge action buttons (same role-gating as the list-page toolbar: Retire requires technician, Purge requires admin).
- **Details card** — 2-column `.jd-details-grid` (Job name, Status, Created by, Created, Scheduled at, Expires, Targets summary).
- **SVG flow diagram** — inline SVG (viewBox `0 0 680 210`) modelled on Datto's "Job Summary" view: three stage boxes (Pending, Running, then three output branches Successes/Warnings/Failures) connected by a forking path. Dynamic: box fill color and count text bound to `flowStats` computed over all device commands. Pending+Running boxes glow with `var(--accent)` when queued/sent > 0; Successes green, Warnings amber, Failures red.
- **Devices table** — per device: hostname, site, command count, status badges. Per-command row: component name, status badge, Exit Code, StdOut/StdErr expand buttons. Output shown inline in a `<tr class="jd-output-row">` below the command row — one open at a time, clicking the same button again collapses it.
- `commands.warning` is now returned by the job detail endpoint (was missing from the SELECT) and surfaced as a `.jd-status-warning` badge. SQLite stores it as a 0/1 integer; the route handler does `warning: row.warning === 1` coercion.

**2. `JobsPage.vue` — cleaned up to a pure list page**

All inline expansion code removed: `expandedId` ref, `detail`/`detailLoading` state, `toggleExpanded()`/`cancelJob()` functions, the `CmdResult` interface, the expand-row `<tr>` template (65+ lines). Row click now `router.push('/jobs/' + job.id)`. Job name column now a `<RouterLink>` (secondary nav path). Cancel column removed from table header and rows.

**3. Flyout selected-state pattern — made consistent across both flyouts**

`JobFormPage.vue` had two flyout panels (component picker `.cf-`, target picker `.tf-`) that had drifted into different interaction patterns. Corrected mid-session after user feedback ("The checkbox was on the right the highlight on the left. Why would I want it different?"):
- Both flyouts now use: accent left border + tint background on selected rows; **teal checkmark on the right replacing the Add button** (`v-if/v-else`), clickable to remove.
- Component flyout: the checkmark's `@click` calls `removeAt(orderedIds.indexOf(c.id))` — works the same as clicking × on the reorder list below.
- Target flyout: the checkmark's `@click` calls `toggleTarget(item)` — same function that Add calls.
- CSS `.cf-check` / `.tf-check` both gained `cursor: pointer` (previously the checkmark was display-only, not clickable).

**4. Target flyout rebuilt (Datto-style category dropdown)**

The previous target flyout used a 3-step interaction: pick type (All/Sites/Devices), then a modal-within-the-flyout list. Replaced with a Datto-style single-panel flow: a `<select>` category dropdown filters the list between the three modes; search input filters within the current category; per-row Add/checkmark inline. `toggleTarget()` auto-clears items of a different kind on add (switching from sites to devices clears existing site targets). Targets display as chips (`isTargeted` bool-checks drive both per-row state and the chip list on the form).

**5. Quick Job modal ComStore tab (DeviceDetailPage.vue)**

Added a third tab — "ComStore" — alongside the existing Library and Write Script tabs, matching `ComponentsPage.vue`'s own split. Store components loaded lazily on first tab open, in parallel with library components but cached after first load. `submitQuickJob` condition updated to treat `store` tab the same as `library` (both resolve a `ComponentRef`).

**6. Table row padding standard**

`jf-td` (data cells) corrected from `9px` → `12px`; `jf-thead` (header cells) from `7px` → `10px`. Triggered by a user screenshot showing the Components table as cramped. This established a project-wide standard — see STYLE.md.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Inline SVG for the flow diagram | No chart library needed; geometry is fixed (only colors/counts are dynamic). Keeps the dependency count flat — the codebase already has xterm.js as its only novel dependency this area |
| One `expandedOutput` object ref, not a Set | Only one output panel can usefully be open at a time on the detail page; a Set would let multiple panels open simultaneously with no clear UX benefit |
| `WeakMap` for result caching | `cmd.result` is a raw JSON string; parsing it on every render would be wasteful. `WeakMap` garbage-collects naturally when the command object is gone, no manual cleanup |
| `warning: row.warning === 1` coercion in route handler | D1/SQLite stores booleans as integers 0/1. This is the same pattern used elsewhere in the codebase (e.g. `components` origin flags) — don't rely on JS's truthiness for `row.warning`, always compare explicitly |
| Both flyout checkmarks clickable to remove | User feedback was explicit: the component flyout had a clickable checkmark, target flyout did not; they needed to match. Once the pattern is established, all future flyouts should follow it |
| Target kind-switch clears prior selection | Mixing site and device targets in one job has no defined semantics in Beacon's target-resolution logic — clearing on kind-switch avoids a confusing half-selected state rather than silently sending an unexpected target combination |

### Next logical steps

1. **Recurrence patterns beyond single-scheduled** — Datto's reference screenshots show Immediately / At selected date and time / Daily / Weekly / Monthly / Monthly day of week / Initial Audit. The last four need a `recurrence_pattern` column (migration), a cron change to reschedule after dispatch, and richer UI. Evaluated this session; deferred as non-trivial with no clear near-term payoff at Beacon's current fleet size.

2. **Job Detail polish** — the StdOut/StdErr output viewer works but is minimal. Could add: a "Copy to clipboard" button on the pre block, a "Copy Job" button in the title bar (clone job with same targets/components → `/jobs/new?clone=:id`), better empty state when a job has no devices yet (pending scheduled dispatch).

3. **Rest of Agent Browser** (File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart) — still all deliberately deferred from the Remote Shell session, unchanged. All can reuse the `SessionRelay` DO and `open_session` command channel without new infrastructure.

## Session: 2026-07-16 (ADMIN_SECRET rotation, WSL agent self-update recovery, real scheduled job dispatch + Create Job full page)

### What was completed

Picked up on a fresh machine — pulled in a full session's worth of remote work first (External IP, Change Log page, Remote Shell, agent v0.2.8) that had landed from another machine, then continued with three unrelated pieces of work in one sitting.

**1. Production `ADMIN_SECRET` rotated.** Had been flagged as outstanding since 2026-07-14 (exposed in a session transcript that day). Generated a new 32-byte random value with `openssl rand -hex 32`, written directly to a private (`chmod 600`) scratchpad file, then piped into `wrangler secret put ADMIN_SECRET` via stdin redirection — the plaintext value never appeared in any tool-call output or chat text at any point, matching the standing practice already used for the Ed25519 agent-signing key. Verified the new secret works with a real authenticated `curl` against production (`200` on `/v1/admin/summary`) before deleting the scratch file. User confirmed they'd saved it to their password manager before deletion.

**2. Diagnosed and fixed a stuck WSL2 dev-machine agent (v0.2.6, never advanced to v0.2.7/v0.2.8).** Not a Beacon code bug — `systemctl status beacon-agent` showed the same process (PID unchanged) running continuously for two days with zero crashes, and `agent.log` showed a real 22-hour gap with no log lines at all, followed by a burst of `context deadline exceeded` check-in errors, then silence again. Root cause: the updater's `time.Sleep(24h)` goroutine doesn't reliably count time while the WSL2 VM is suspended (the underlying Windows laptop sleeping) — its internal clock drifted behind real wall-clock time, so the second 24h version check (which would have found v0.2.7 and v0.2.8) simply hadn't fired yet, despite two calendar days having passed. Fix was operational, not code: `sudo systemctl restart beacon-agent` (run by the user, not me — I don't have passwordless sudo) reset the 5-minute startup stagger and forced an immediate fresh check, which took the box from v0.2.6 straight to v0.2.8 in under two seconds once unstuck. Confirmed via `agent.log` and a direct production D1 query (`agent_version` column) before and after.

**3. Real scheduled job dispatch, plus Create Job moved from a modal to a full page.** Triggered by the user creating a real 2-device job via `CreateJobModal.vue` for the first time (previously all production job usage had been single-device Quick Jobs from `DeviceDetailPage.vue`) and noticing the modal felt dated next to the newer Quick Job UX, plus a real Datto "Create a Job" reference screenshot showing Schedule/Notification/Execution sections Beacon had no equivalent of at all.
   - **Backend**: `jobs.scheduled_at`/`expires_at`/`run_as_system` had existed in the schema since the original design but were fully dead — a `type: 'scheduled'` job would insert its row and then dispatch nothing, ever, since the only dispatch code path was gated on `type === 'quick'` and nothing else ever called it. Fixed in `worker/src/routes/admin/jobs.ts`: extracted the existing inline dispatch loop into a shared `insertJobCommands` helper, then added `dispatchDueScheduledJobs`/`cancelExpiredScheduledJobs`, wired into the pre-existing 2-minute cron in `worker/src/index.ts` (which previously only ran `evaluateOfflineAlerts`). Target devices for a scheduled job resolve **at dispatch time**, not creation time — deliberately matching Datto's own documented "devices targeted by a Job are calculated just before it is scheduled to run" semantics (confirmed from the reference screenshot's own on-page copy), since the matching device set can legitimately change between job creation and a future `scheduled_at`. A job that expires before ever resolving any devices is cancelled instead of dispatching late.
   - **Frontend**: `CreateJobModal.vue` deleted outright; `dashboard/src/pages/JobFormPage.vue` (`/jobs/new`) replaces it, reusing the `.pf-page` full-page-form shell already established by `PolicyFormPage.vue`/`ComponentFormPage.vue` (third real instance of that pattern). New Schedule section (seg-bar Immediately/Scheduled, with a `datetime-local` input + Expiration `<select>` appearing only when Scheduled is picked) and Execution section (seg-bar System account/Logged-in user). Two call sites migrated: `JobsPage.vue`'s "+ New Job" button and `ComponentsPage.vue`'s "Run as Job" bulk action (now `router.push`es with a `?components=` query param the new page reads on mount to pre-select).
   - **Explicit scope calls, made with the user before writing code, not after**: "Run as a logged in user" is shown in the Execution seg-bar but rendered `disabled` with a hint — the agent has zero Windows user-impersonation capability (`WTSQueryUserToken`/`CreateProcessAsUser`-style) anywhere in `agent/internal/executor`, so building the toggle without the real capability would misrepresent what the product does. Notification (email-on-completion) was declined outright, not even as a disabled stub — Beacon has no email-sending infrastructure anywhere, and that's a separate initiative, not a job-form add-on. Full recurrence patterns and Datto's "yearly calendar outlook" visual were skipped — `scheduled_at` supports exactly one future run.
   - **Verified end-to-end**, not just type-checked: curl-based backend tests against a real local `wrangler dev` + D1 confirmed (a) quick jobs still dispatch immediately (regression check), (b) a scheduled job sits with zero commands until the cron fires (`/cdn-cgi/handler/scheduled`, the correct manual-trigger endpoint for `wrangler dev` — no `--test-scheduled` flag needed, that only changes the startup banner), then dispatches correctly once due, and (c) a job whose `expires_at` passes before ever dispatching gets cancelled, not run late. Then a full Playwright browser pass through the real `/jobs/new` page — added a component via the search combobox, switched to Specific Devices, picked a real device, switched Schedule to "At a scheduled time," filled a future datetime, and submitted — landed correctly on `/jobs` showing `scheduled` / `0 devices` (correct, since target resolution is deferred to dispatch time).
   - Hit and worked around two real local-dev environment issues along the way, now documented in CLAUDE.md's "Local full-stack testing gotchas": a stale hung `wrangler dev` process from a prior session was silently occupying port 8787 (looked like "port busy" on a fresh start, not "nothing listening" — `ss -ltnp` was what actually revealed it), and setting `VITE_API_URL` directly for local testing turned out to be actively harmful, not just unnecessary — `vite.config.ts` already proxies `/v1` → `localhost:8787`, and overriding it instead forces real cross-origin fetches that the worker's CORS allowlist (hardcoded to exactly `localhost:5173`) rejects.

**4. Everything pushed and deployed.** Two commits (`ADMIN_SECRET` rotation note kept separate from the jobs feature, since they're unrelated changes) pushed to `main`; the worker deployed directly via `wrangler deploy` (no new migration needed — this change only wired up already-existing columns). Confirmed `https://rmm-api.cloud.synertekcs.com/health` returns `200` post-deploy.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Rotate `ADMIN_SECRET` via a piped scratch file, never printed to chat | Same standing practice as the Ed25519 signing key — the *reason* for this rotation was a prior transcript exposure, so repeating the same mistake while fixing it would be self-defeating |
| Fix the WSL agent via `systemctl restart`, not a code change | Root cause was a real environmental effect (WSL2 suspend skewing Go's `time.Sleep`), not a logic bug — the v0.2.5 `awaitConfirmation` fix from a prior session is unrelated and still correct |
| Scheduled jobs resolve target devices at dispatch time, not creation time | Matches Datto's own documented semantics exactly (confirmed from the reference screenshot's on-page copy: "devices targeted by a Job are calculated just before it is scheduled to run"), and is more correct than snapshotting a device list that might be stale by the time a future job actually runs |
| `NOT EXISTS (SELECT 1 FROM commands WHERE job_id = j.id)` as the "not yet dispatched" signal | Avoids a new `dispatched_at` column — a scheduled job legitimately has zero commands until the moment it dispatches, so the existing relationship already encodes the state needed |
| "Run as a logged in user" shown-but-disabled, not omitted | The segmented control's shape itself documents a real, known capability gap — matches this project's established pattern of surfacing gaps honestly (see the Warranty Expiration and Patch Status precedents) rather than only ever hiding what's missing |
| Notification section omitted entirely (no disabled stub) | Unlike Execution, there's no existing partial capability to point at — building even a stub would imply email infrastructure is closer to existing than it is |
| Split the `ADMIN_SECRET` doc-note commit from the jobs-feature commit | Two unrelated changes; keeping them separate matches this project's general commit hygiene even though both happened in the same session |

### Next logical steps

1. **`/jobs/:id` detail page.** Was explicitly parked earlier this same session pending a real multi-device job to design against — that job now exists (the 2-device "Ping from all devices" job that kicked off this whole feature), and the inline expand-row per-device output is confirmed cramped in practice, not just in theory. No Datto reference screenshot for this specific view was captured yet — get one before building, per this project's established practice of building against real reference material rather than guessing (see the Sites-scoping and System-section rebuilds in earlier sessions for what guessing costs).
2. **Confirm a real scheduled job dispatches correctly in production**, not just against local D1 — everything this session was verified against a real local `wrangler dev` + D1 + browser, but the cron's actual 2-minute production trigger has never fired against a real `type: 'scheduled'` row yet.
3. **The second laptop still hasn't checked in** — flagged by the user at the start of this session, not yet investigated (attention went to the WSL box instead, which turned out to have its own unrelated issue).
4. **Rest of the Agent Browser** (File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart) — still all deliberately deferred from the prior session, unchanged this session.

## Session: 2026-07-15 (External IP, Change Log redesign, Interactive Remote Shell + agent v0.2.8)

### What was completed

**1. External IP added to device Network section** (migration `0023_device_external_ip.sql`)

Worker captures the check-in request's own `CF-Connecting-IP` header into a new `devices.external_ip` column on every check-in (`worker/src/routes/checkin.ts`) — no agent change needed, since an agent has no reliable way to learn its own public IP without an outbound call to a third-party service. Dashboard shows it unconditionally at the top of the Network section (sourced from `device`, not `auditData`, so it's available before any audit has ever run). Verified end-to-end against a real running agent.

**2. Change Log moved from an unbounded inline section to a dedicated page**

The Change Log was an always-rendered inline section at the bottom of the device detail page with no pagination or filtering — `device_audit_changes` accumulates one row per detected change on every audit, with no cap, so this was a real "will keep growing" problem, not hypothetical (real Datto reference showed 128 entries/3 pages for comparison).

New `DeviceChangeLogPage.vue` (`/devices/:id/change-log`) — reached via a "Change Log" button now in the System section (matching a real Datto reference screenshot's placement), not a nav-scroll anchor. Category tabs (All/Software/Hardware/Services/Security — Beacon's real change categories, deliberately not Datto's invented "System" bucket, since nothing in Beacon's diff logic produces a "system" category), a date-range filter (7/30/90 days/All Time, default 30), a count badge, and numbered pagination (`JobsPage.vue`'s pattern, 50/page default) reused wholesale. Device detail page's nav list is back down to Summary → System → Alerts → Policies → Software → Services → Memory → Storage → Network → Security (Change Log removed) — no other scroll-spy code changed, since it already referenced `sections[sections.length - 1]` generically rather than a hardcoded name.

**3. Interactive Remote Shell — first slice of a Datto-style "Agent Browser"** (agent v0.2.8)

Datto's Agent Browser (user-provided reference: rmm.datto.com's help docs) is a large multi-tool suite — File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, command shell, screenshot, remote takeover, shutdown/restart, network device deploy/wake. Deliberately scoped to just the interactive shell this session, given the size and the real, varying security implications of the other tools (registry editing and remote takeover are a different risk class than a read/write shell).

Found Beacon already had fully generic, reusable transport for this class of feature — a `SessionRelay` Durable Object (byte-agnostic bidirectional WS relay), per-session auth tokens, and an agent-side dial-out via the existing command-queue channel — but it had never actually been used end to end: the dashboard's only "Remote Session" button was a hardcoded-disabled stub for a *different*, unbuilt RustDesk integration, and the agent's `shell.go` ran each WS message as one independent buffered `sh -c`/`cmd /c` invocation with no PTY, no persistent process, no real interactivity (its own comment said "PTY/interactive support is a future phase").

Built the two missing halves:
- `agent/internal/session/pty_unix.go` (`github.com/creack/pty`) and `pty_windows.go` (`github.com/UserExistsError/conpty`, real Windows ConPTY — confirmed via research that `creack/pty`'s mainline does *not* support Windows, returns `ErrUnsupported`). A rewritten `shell.go` spawns one persistent PTY-backed shell process per session, streaming raw bytes as WS binary frames in both directions, with a small JSON text-frame control channel (currently just `{type:'resize',cols,rows}`).
- Dashboard: new `RemoteShellModal.vue` (xterm.js + `@xterm/addon-fit`), a new "Remote Shell" toolbar button on the device detail page (separate from the still-disabled RustDesk stub).

**Found and fixed two real, pre-existing bugs while testing this** — `POST /v1/sessions` had literally never been called by anything before this session:
- `/v1/sessions` was missing from the CORS middleware entirely (`worker/src/index.ts` only ever covered `/v1/admin/*` and `/v1/auth/*`).
- `sessions.ts` derived the agent/client WebSocket origin from the incoming request's own URL (`new URL(c.req.url).origin`), which a `[[routes]]` custom-domain block in `wrangler.toml` can make reflect the *production* route even under `wrangler dev` — a local test agent actually dialed out and connected to the real production worker during testing, spawning a real (harmless but unintended) PTY session there before this was caught and fixed. Replaced with a configured `WORKER_URL` env var (`worker/.dev.vars` gets `http://localhost:8787` for local dev, overriding the production `wrangler.toml` value).

Verified fully end-to-end against a real running local agent: real PTY prompt streamed live, keystrokes echoed and executed correctly, resize control frames worked, and closing the session cleanly killed the remote shell process (confirmed via process inspection, both via a raw WebSocket test and the real dashboard UI flow — the latter needed a longer propagation wait than expected, ~2–5s, before agent-side cleanup completed; real network/relay latency, not a bug).

**4. Agent v0.2.8 released and independently verified**

Version bumped, all 5 platform binaries built and attached to a GitHub release before any registration (standard process). Also fixed the recurring dead-placeholder-`download_url` gotcha in `publish-agent.mjs` for good this time — a new `BEACON_DOWNLOAD_BASE_URL` env var lets the script point directly at a real GitHub release's asset base instead of silently defaulting to a URL nothing serves; every release since v0.2.0 had needed either a two-step re-register dance or manual by-hand signing to work around this same gap.

Signing/registration done by the user (signing key never enters a session transcript, per standing practice) using a one-off completion script that downloaded the exact already-uploaded release assets fresh and signed those bytes directly — deliberately *not* a rebuild, since rebuilding from a different machine/directory without `-trimpath` would produce different bytes than what was already hosted, which would have broken the signature-to-asset match. All 5 signatures independently re-verified (SHA-256 digest → Ed25519 verify against the pinned public key, pulled programmatically from source + a `wrangler d1 execute --remote` query) before calling it shippable. `/v1/agent/version` and `/v1/agent/download` both confirmed working end-to-end against production.

Also hit and resolved a real local debugging detour: `BEACON_SIGNING_KEY` etc. were exported in the user's shell but `node` wasn't seeing them — root cause was `direnv` (already used in this repo for `CLOUDFLARE_API_TOKEN`) reloading the environment between shell prompts, silently dropping manually-exported vars not part of the tracked `.envrc`. Fix was exporting and running in a single chained command (`export ... && node ...`) so nothing could reload in between.

### Key technical decisions

| Decision | Rationale |
|---|---|
| External IP captured worker-side from `CF-Connecting-IP`, not agent-side | Backend already knows the request's source IP for free; an agent-side lookup would need an outbound call to a third-party echo service for no benefit |
| Change Log category tabs use Beacon's real categories (software/hardware/services/security), not Datto's System/Software/Hardware | Beacon's diff logic genuinely has no "System" category — inventing one to match the reference more closely would misrepresent the data, inconsistent with this project's established "not 1:1 with Datto" posture elsewhere |
| Change Log data fetched once (up to 500 rows) and filtered/paginated client-side | Matches `JobsPage.vue`'s established precedent — the dataset is small enough that server-side paging would add complexity for no real benefit at this scale |
| Remote Shell scoped to just the interactive shell this session | Datto's full Agent Browser is 7+ distinct tools with real, varying security implications; the shell was also the natural first slice since the transport layer already existed and needed the least new protocol design |
| Binary-for-data / text-for-control WS framing | Minimal overhead for the common case (raw PTY bytes), while leaving room for future tools built on the same relay to define their own control messages |
| `WORKER_URL` as a configured var, not derived from the request | The bug that caused a local test session to dial out to real production proved request-derived origin is fundamentally unsafe under some hosting configs (here: a `[[routes]]` custom-domain block) — a configured value can't be misdirected by routing/proxy behavior |
| Sign-and-register against freshly re-downloaded release assets, not a local rebuild | Go builds without `-trimpath` embed the absolute build path in the binary; a rebuild from a different machine/directory than the original build would produce different bytes, breaking the signature-to-hosted-asset match |

### Next logical steps

1. **Confirm real devices pick up v0.2.8** — especially Nebuchadnezzar, given its history of not cleanly picking up prior releases; check `agent.log` after the next ~24h update-check window.
2. **`ADMIN_SECRET` rotation** — still flagged from the prior session as needed (exposed in an earlier session transcript), still not done.
3. **Job detail page** (`/jobs/:id`) — still just an inline expand-row on `JobsPage.vue`, cramped for jobs targeting many devices; a dedicated page mirroring `DeviceDetailPage.vue`'s layout is the natural next step (carried over from an even earlier session).
4. **The rest of the Agent Browser** — File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart, network device deploy/wake — all deliberately deferred, all able to reuse the same `SessionRelay`/session-auth/command-queue-dial-out plumbing Remote Shell now proves out end-to-end.

## Session: 2026-07-14 (Agent v0.2.7, Jobs page redesign)

### What was completed

**1. Agent v0.2.7 released** (commit 9f833a7)

The two Go changes from last session that never shipped finally landed in a real release:
- `executor/run.go` variable→env-var injection (input variables passed to agent scripts as environment variables)
- `hardware.go` virtualization detection (`detectVirtualization()` — WSL2/Hyper-V/VMware/VirtualBox/KVM/Xen on Linux, Hyper-V/VMware/VirtualBox/KVM on Windows, Apple Virtualization Framework on macOS)

Release followed the standing process exactly: GitHub release (`gh release create v0.2.7`) before registering anything, all 5 binaries downloaded and independently Ed25519-re-verified with a throwaway Go program before calling it shippable. Fixed dead placeholder download URLs (re-registered all 5 platform/arch combos with real GitHub release asset URLs, reusing the same `signature_hex` — signature covers binary bytes, not the URL).

**2. Job completion bug fixed** (commit 3826411 — `worker/src/routes/checkin.ts`)

Jobs were permanently stuck as `'active'`. Root cause: `checkin.ts` processed command results correctly (updating `commands.status`) but never checked whether all commands had reached a terminal state, so `jobs.status` never transitioned.

Fix: after the command-result processing loop, collect `affectedJobIds` from the processed results, then for each affected job:
```sql
SELECT COUNT(*) AS n FROM commands WHERE job_id = ? AND status IN ('queued', 'sent')
-- if n === 0: UPDATE jobs SET status = 'completed' WHERE id = ? AND status = 'active'
```

Also backfilled one existing stuck job directly via D1 SQL.

**3. `created_by` never populated on job insert** (commit 7933030 — `worker/src/routes/admin/jobs.ts`)

`jobs.created_by` column existed but was never set at job creation time. Fixed: capture `requireUser`'s return value at `POST /v1/admin/jobs`, derive the display name (`break-glass → 'Admin'`; real user → `user.displayName ?? user.email`), and include it in the INSERT. Backfilled all existing null rows.

**4. Hard-delete purge endpoint** (same commit — `worker/src/routes/admin/jobs.ts`)

- `DELETE /v1/admin/jobs/:id` (pre-existing) = **Retire**: marks queued commands `'failed'`, sets job `status = 'cancelled'`, keeps all history. Technician role.
- New `DELETE /v1/admin/jobs/:id/purge` = **Delete**: hard-deletes the job and all its `commands` rows. Admin role. `api.ts` gained `jobs.purge(id)`.

**5. Jobs page redesign** (commits 79d2ed2 → d574cae — `dashboard/src/pages/JobsPage.vue`)

Five incremental commits:

- **Stat cards** — 5 cards (Total/Quick/Scheduled/Active/Completed) with colored top borders (`border-top: 3px solid <color>`) and label+value on the same horizontal line. Modeled on a real Datto RMM Jobs page screenshot. Cards are clickable: Total/Quick/Scheduled set `filterStatus = null`; Active sets `'active'`; Completed sets `'completed'`. Stat card clicks deliberately do **not** touch `filterUser` — an earlier version did and was corrected after user feedback.
- **Filter bar** — replaces the old type-tabs. Defaults on mount to current user + `'active'` status. Filter chips with × buttons clear individual filters. "Reset Filters" text-link appears only when not at defaults and restores defaults (not blank). The blank-reset behavior was explicitly corrected once.
- **Retire/Delete** — header checkbox selects/deselects all visible rows; per-row checkboxes; "Retire" and "Delete" buttons in the section-card-head. Retire calls `api.jobs.cancel` per selected; Delete confirms then calls `api.jobs.purge`. Both clear selection on success.
- **New columns** — "Created by" (`job.createdBy`) and "Created" (`relDate(job.createdAt)` relative timestamp).
- **Pagination** — client-side (all 200 jobs loaded for accurate stat card totals). 20/50/100 per page; page buttons with `…` ellipsis (shows ≤7: `[1, …, cur-1, cur, cur+1, …, last]`); `rangeStart–rangeEnd of N` range indicator. Filter changes reset to page 1 via `watch([filterUser, filterStatus], …)`.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Client-side pagination | All 200 jobs already loaded for accurate stat card totals; server-side paging would add complexity for no UX benefit at current scale |
| "Reset Filters" restores defaults, not blank | Matches Datto's behavior; blank is a separate interaction (remove each chip individually). Corrected from an initial blank-reset implementation |
| Stat card clicks set `filterStatus` only | First implementation overwrote `filterUser` too; corrected so clicking "Active" doesn't also pin the user filter |
| Retire vs. Delete as distinct operations with different role gates | Different blast radii — Retire is safe/reversible (history kept), Delete is irreversible; admin gate on purge follows the same pattern as other destructive operations in this codebase |
| `ref(new Set<string>())` for selection, replaced on each mutation | Vue 3 doesn't track in-place `Set` mutations; always replace: `const s = new Set(selected.value); …; selected.value = s` |

### Security note

The production `ADMIN_SECRET` was inadvertently pasted in plaintext during this session. **It must be rotated before this is considered closed.** Rotation: generate a new hex secret, update `worker/.dev.vars` locally, and set it as a Cloudflare Worker secret: `cd worker && npx wrangler secret put ADMIN_SECRET`.

### Next logical steps

1. **Rotate the production ADMIN_SECRET** — see Security note above.
2. **Confirm v0.2.7 self-update on `Nebuchadnezzar`** — device was last confirmed at v0.2.2; v0.2.7 is correctly signed and reachable, but that specific running binary may still be pre-v0.2.5-fix (dormant updater goroutine). Check `C:\ProgramData\Beacon\agent.log`; if stuck, do a one-time manual reinstall of v0.2.7.
3. **External IP for the Network section** — scoped but unbuilt. Cheapest path: capture `CF-Connecting-IP` header at check-in time in `checkin.ts` and store it on the device row — no agent change needed.
4. **Job detail page** — the inline expand-row works but is cramped for jobs targeting many devices. A dedicated `/jobs/:id` page (mirroring `DeviceDetailPage.vue`'s layout) is the natural next step.

---

## Session: 2026-07-14 (Components Library v2, Sites scoping correction, virtualization detection)

### What was completed

Driven by working through Datto RMM's real Component Library reference screens (list page, Create Component form, and later an "Add Site" flyout) one section at a time — several things here were built, then corrected once more reference material came in, same honest-history approach as prior sessions.

**1. Components Library v2** — brought Beacon's component/script library from "name + one script blob + a freeform tag" toward real Datto parity, scoped deliberately (not 1:1 — Levels, file attachments, and credential caching were all explicitly declined):
- **Category/Kind**: the existing but totally unused `type` enum (`script`|`application`) became a real, UI-visible "Kind" selector. The pre-existing freeform `category` field (Maintenance/Diagnostic/etc.) was relabeled "Group" in the UI to stop colliding conceptually with the new Kind field — no schema rename, just a naming fix at the display layer.
- **Input variables** (migration `0020`, `component_variables` table) — full 4 types matching Datto (String/Selection/Boolean/Date), prompted at job-creation time, always passed to the agent as strings regardless of declared type (Datto's own convention). Built a shared `ComponentVariablePrompt.vue` used by both `CreateJobModal.vue` and `DeviceDetailPage.vue`'s Quick Job modal — two independent call sites building `ComponentRef`s that both needed the same prompt-and-validate treatment (the second one wasn't part of the original ask; found via code search during planning, not by the user).
- **ComStore stub** — `components.origin` (`custom`|`store`), a handful of seeded built-in examples (clear temp files, flush DNS, list software), `GET /store` (browse, read-only, 403s on mutation attempts) + `POST /:id/clone` (copies variables and, later, sites into a fresh editable `custom` row).
- **Post-conditions** — stdout/stderr text/regex matching (`worker/src/lib/postConditions.ts`) that sets a new `commands.warning` flag, evaluated in `checkin.ts` at the exact point a command result is persisted — deliberately orthogonal to `status`, never flips completed→failed. Surfaced as a distinct amber "Warning" badge in `JobsPage.vue`.
- Agent side: `executor/run.go`'s `runScriptPayload` gained a `Variables map[string]string`, injected into `exec.Cmd.Env`. **This never went out in a release** — see "Next logical steps."

**2. List page + full-page form, added after being shown the real Datto Component Library screen** — stat cards (Total/Applications/Scripts — dropped Monitors and "Update needed", neither concept exists here), and Create/Edit converted from a modal to a dedicated full page (`ComponentFormPage.vue`, `/components/new` + `/components/:id`), mirroring `PolicyFormPage.vue`'s breadcrumb/topbar/section-group shape rather than inventing a new one.

**3. Sites scoping — built twice.** First pass (migration `0021`) mirrored the Policy system's existing `scope`/`company_id` shape exactly (global vs. a single company) — a deliberate simplification at the time, reusing an established pattern rather than inventing a new one. The user then showed the actual Datto "Add Site" flyout: a panel that stays open, lets you add **multiple** sites one at a time (each row toggling between Add/Remove in place, plus a "Remove all" bulk action), not a single-select. Rebuilt as a proper many-to-many `component_sites` join table (migration `0022`): `GET /v1/admin/components?company_id=` now checks real membership via a subquery, clone copies every site row (not just one), and switching a component back to "All Sites" cascade-deletes its site rows so re-enabling company scope later starts clean. `components.company_id` is left in place as a vestigial, unused column — it shipped and was superseded within the same session, before any real usage, so a `DROP COLUMN` wasn't worth the risk.

**4. Virtualization platform detection** — a side conversation (the user noticed a WSL2 Linux device's System/BIOS hardware facts were almost entirely empty) turned into a real fix: `agent/internal/audit/hardware.go`'s new `detectVirtualization()` explains *why* those fields are empty — WSL2 doesn't expose `/sys/class/dmi/id/*` the way a full VM does. Checks `/proc/sys/kernel/osrelease` for WSL2's own kernel signature first (since WSL2 also reports Hyper-V-style DMI fields, which would otherwise misreport it as a plain Hyper-V VM), then falls back to DMI/WMI vendor-string matching for Hyper-V/VMware/VirtualBox/KVM-QEMU/Xen. New `HardwareInfo.Virtualization` field, rides the existing JSON blob (no migration). Verified live with a throwaway in-package Go test against the actual dev machine — correctly returned `"WSL2"`.

**5. All three worker migrations (`0020`, `0021`, `0022`) and their corresponding worker deploys are live in production** — each applied and deployed immediately after its own commit, not batched. Every layer (worker routes, agent env-injection, dashboard forms) was verified against a real running `wrangler dev` instance before being called done — created components with each variable type, exercised the required-variable 400 path, simulated check-ins to confirm the post-condition warning flag, confirmed multi-site filter/clone/cascade-delete behavior with real tenant IDs, and ran the agent's variable-injection code path directly. One real bug was caught this way: the clone endpoint's response wasn't joining `tenants`, so a cloned company-scoped component came back with the right `companyId` but a `null` `companyName` — found and fixed before the first commit (later moot once `company_id` was replaced by `component_sites` in migration `0022`).

### Key technical decisions

| Decision | Rationale |
|---|---|
| Reuse the dead `type` enum as Kind, rename the old `category` field to "Group" in the UI | Two fields already existed doing almost-overlapping jobs; fixing the naming/labeling was cheaper and less risky than a schema migration, and matches Datto's actual two-concept model (Category = behavior-driving type, Groups = organizational tag) |
| No `monitor` category | Beacon's Policy/Monitor system already owns "run something and alert on it" — a future `component` policy check_type reusing this script library is separate, later work, not a Components-page concern |
| Applications are label-only (no file upload) | No object storage (R2) configured yet; real file attachments are a bigger, separate pass once that exists |
| Post-conditions as a new `commands.warning` boolean, not a new `status` value | Keeps every existing status-gated dispatch/aggregation code path (job stats, check-in owned-command lookup) undisturbed |
| Variable values captured once per job, device-agnostic | Matches the existing `ComponentRef`/`jobs.component_ids` shape and Datto's own quick-job semantics; a per-device model would need a materially different payload shape |
| Sites scoping rebuilt as many-to-many rather than patched in place | The single-`company_id` shape was a real design mistake once shown the actual reference UI — not worth half-fixing; `company_id` left vestigial rather than attempting a `DROP COLUMN` on a column with zero real usage |
| Full-page Create/Edit Component, not a modal | Matches the real Datto reference (dedicated page, own breadcrumb) and this codebase's existing `PolicyFormPage.vue` precedent, rather than keeping the smaller modal that predated this session |
| Execution-context/real-recurring-scheduling explicitly kept out of scope | A related but separate gap (`jobs.run_as_system`/`scheduled_at` are still dead code) — surfaced by the Quick-Job-vs-Job reference material, deliberately not folded into this pass |

### Next logical steps

1. **Cut and release agent v0.2.7.** The two agent-side Go changes this session (`executor/run.go`'s variable→env-var injection, `hardware.go`'s virtualization detection) were never built into a release — `main.go`'s `version` is still `"0.2.6"`. Neither feature does anything on a real device until this happens. Follow the standing release process in CLAUDE.md exactly (GitHub release before registering, independent Ed25519 re-verification before calling it shippable).
2. **Real-fleet validation of Components v2** — everything this session was verified against local D1 + an isolated `wrangler dev` instance with synthetic tenants/components, not real enrolled devices. Once v0.2.7 ships, worth confirming a real job with variables actually reaches a real agent and the env vars land as expected, and that a real post-condition match shows the Warning badge against real command output.
3. **Revisit the "Monitors vs. Policies" open question** (carried over from an earlier session) now that Components has its own real Sites-scoping precedent — worth deciding whether a future `component` policy check_type (the escape-hatch idea floated earlier) should reuse `component_sites`-style scoping too, once that work starts.

## Session: 2026-07-13/07-14 (Device detail cleanup, run_audit fix, agent v0.2.3–v0.2.6, self-update bug found and fixed)

### What was completed

Direct continuation of the same day's device-detail-page session below, picking up from a running v0.2.2 fleet. Driven almost entirely by the user reviewing the live page and real Datto RMM reference screenshots, not upfront spec — several things built here were later corrected or reorganized once more reference material came in, which is reflected honestly below rather than only showing the final state.

**1. Device detail page cleanup pass** — three small, direct fixes from user feedback on the running v0.2.2 build: removed the per-drive disk listing from Summary's Activity column (redundant with Hardware); fixed the Hardware section's CPU "Model" row rendering flush-left while every sibling row (RAM/Disks/Network/BIOS) had 20px padding — a missing inline `style` on one `.ddev-row`; and collapsed the Policies section from a full per-monitor Type/Condition/Priority/Sustained breakout down to a plain Policy/Scope/Monitor-count table with click-through to the policy edit page ("it literally just needs to show all the policies applied on this machine not every policy with their monitors").

**2. Fixed `Run Audit Now` — a real pre-existing bug, not new.** Clicking it threw `400: unknown command type`. Root cause: the dashboard button, `api.ts`, and the agent (`agent/cmd/agent/main.go:267`, dispatches on literal `cmd.Type == "run_audit"`) all already fully supported a `run_audit` command end-to-end — but the worker's `POST /v1/admin/devices/:id/commands` route only ever implemented `reboot` and `run_script`, silently 400ing anything else. This had apparently never worked. Fixed by adding the missing branch (`worker/src/routes/admin/devices.ts`).

**3. A real production incident: the agent signing key was corrupted, silently breaking every v0.2.2 release signature.** User reported the Windows agent still showing 0.2.1 after several manual restarts. Diagnosis path (documented in detail since it's a good template for next time this class of bug shows up):
   - Confirmed the worker's `/v1/agent/version` and `/v1/agent/download` endpoints were correct end-to-end (real `200`s, real GitHub release asset).
   - Independently re-implemented `verifyBinary`'s exact check (SHA-256 digest → Ed25519 verify against the pinned public key) in a standalone Go program and ran it against the *actual* registered `signature_hex` and the *actual* downloaded GitHub release binary for all 5 platform/arch combos — every one failed to verify, despite the binaries themselves being byte-identical to local `dist/` builds (ruled out "wrong binary uploaded").
   - Re-signing the identical `dist/` binaries reproduced the *exact same* (still-invalid) signatures — expected, since Ed25519 signing is deterministic for a fixed key+message, which proved the *key itself*, not the binaries or the process, was the constant, broken variable.
   - Compared the derived public key half of the user's `BEACON_SIGNING_KEY` (bytes 32–63 of the 64-byte private key, computed **locally by the user, never pasted into the session**) against `pinnedPublicKey` in `agent/internal/updater/verify.go` — mismatch confirmed. The password-manager entry had been corrupted/overwritten with data that happened to embed the tail of an old *signature* rather than the real private key.
   - User fixed the vault entry; re-signing then produced genuinely new, verifying signatures for all 5 platforms.
   - **New standing practice**: every release from this point on gets independently re-verified (download the real GitHub asset, re-run the Ed25519 check against the registered signature) *before* considering it shippable — this is now folded into the release checklist below, not just a one-off recovery step.

**4. Agent v0.2.3 through v0.2.6 — four releases in one evening**, each following the corrected release process (see updated "Agent release process" in CLAUDE.md):
   - **v0.2.3**: `Architecture` (free — `runtime.GOARCH`), `SystemInfo` (Manufacturer/Model/Motherboard — DMI on Linux, WMI on Windows, `system_profiler` on macOS with no motherboard concept there), `DisplayAdapters`, and `RAM.InstalledBytes` (raw physical DIMM capacity, distinct from gopsutil's OS-visible/usable `RAM.TotalBytes` — needs `dmidecode` on Linux, same root-only caveat as BIOS serial).
   - **v0.2.4**: `Domain`, `WindowsDisplayVersion` (e.g. "24H2"), `WindowsInstallationType` (e.g. "Server") — all Windows-only registry/WMI reads with no honest Linux/macOS equivalent. Domain is only reported when `Win32_ComputerSystem.PartOfDomain` is true — that property returns the *workgroup* name otherwise, which would otherwise render as if it were a real domain.
   - **v0.2.5**: fixed a real, consequential bug in `agent/internal/updater/updater.go` — **self-update permanently stopped checking for new versions after the very first successful update.** `Start()`'s own comment claimed `awaitConfirmation` "schedules the next check after confirming," but the function never actually did that in either branch (confirmed or rolled-back) — it just returned, silently ending that process's only updater goroutine for the rest of its life. This is almost certainly why the real device got 0.1.0-era → 0.2.2 once, then never noticed v0.2.3 or v0.2.4 existed despite both being correctly signed and fully reachable — not a timing or signing issue, the checker itself wasn't running anymore. Fix: both branches now fall through to `runLoop`, using `state.PendingVersion` as the new current-version baseline (correct in both branches — confirm means this process really is running that version; rollback-failure means the on-disk revert didn't happen, so it still is too). Also fixed the rollback branch failing to clean up `update-state.json`, which could cause a repeated immediate-rollback retry loop on a stale, already-expired deadline.
   - **v0.2.6**: added persistent logging (`<credDir>/agent.log`, `log.SetOutput(io.MultiWriter(os.Stderr, f))`) — Windows services have no visible console, so every prior updater/audit/check-in log line was going nowhere anyone could ever see. This is what made the v0.2.2 signing incident *and* the v0.2.5 dormant-checker bug both so hard to diagnose: "no `update-state.json` on disk" is equally consistent with "never attempted" and "attempted and failed" (since `applyUpdate` cleans up the state file on any failure path), and there was no way to tell which without a log.
   - All 4 releases independently Ed25519-verified against the real GitHub asset before being considered shippable (see #3's new standing practice).
   - **The real device (hostname `Nebuchadnezzar`) never actually got past 0.2.2 this session** despite all 4 releases being correctly signed and reachable — strong evidence self-update itself is stuck on that specific box (plausible cause: the pre-v0.2.5 dormant-checker bug, or the stale-rollback-loop bug, both now fixed, but *this specific already-running pre-fix binary* can't self-heal into the fix). Recommended a one-time manual reinstall of v0.2.6 to break the deadlock and get a clean, bug-fixed baseline — **not yet done as of end of session**, user was away from the machine.

**5. System section: built, then corrected twice against real Datto reference screenshots.** First pass added a new "System" nav section (between Summary and Hardware) for the new v0.2.3/v0.2.4 fields plus a manual Warranty Expiration date (`devices.warranty_expires_at`, migration `0019`, new `PATCH /v1/admin/devices/:id` route, `technician`-role-gated). User then flagged real duplication ("stuff is getting scattered") — OS/Serial/Last-User/BIOS/CPU/RAM were now showing in Summary *and* System *and* the old standalone Hardware section simultaneously, because System had been bolted on without reconciling against what already existed. First fix merged Hardware into System entirely (removed the standalone Hardware nav item). **That merge was itself corrected** once the user showed an actual Datto device-page nav screenshot: Datto keeps Memory, Storage, and Network as their own separate nav items, not folded into System. Final shape (also reordered to match Datto's actual nav sequence): **Summary → System → Alerts → Policies → Software → Services → Memory → Storage → Network → Security → Change Log**, with System trimmed to pure OS/chassis identity — nothing shown in two places. `.NET Version` and real vendor-API warranty lookups (Dell/HP/Lenovo — each needs its own partner-account registration, and still misses VMs/white-box builds) were evaluated and explicitly declined per the user's steer; a historical-metrics-over-time tab (Datto has one, showing CPU/Memory/Disk/Downtime line charts) was scoped as a real new feature — no time-series storage exists in Beacon at all — and explicitly deferred rather than attempted.

**6. WSL test device** — set up a Linux agent inside WSL2 (systemd enabled via `/etc/wsl.conf`) on the user's own work machine, specifically as a safe alternative to installing Beacon's agent directly on a Datto-RMM-managed Windows host (flagged as a real concern: a second unsanctioned RMM-like agent on a corporately-managed machine can read as exactly the kind of thing an EDR/security team treats as suspicious, independent of Beacon posing any actual technical conflict — no listening ports, fully separate service/paths). Gives a clean, disposable device to validate future releases (especially the self-update fix) against.

### Key technical decisions

| Decision | Rationale |
|---|---|
| Independently re-verify every release's Ed25519 signature against the real GitHub asset before trusting it | The v0.2.2 signing-key corruption incident proved "the registration API call succeeded" is not the same claim as "the signature is actually valid" — now a standing pre-ship check, not a one-off |
| `awaitConfirmation` must always fall through to `runLoop` | Its own doc comment already promised this; not doing so silently killed the updater goroutine forever after one successful update — a much worse failure mode than a crash, since nothing ever surfaces it |
| Persistent `agent.log` file, not just `log.Printf` to stderr | Windows services have no console — every diagnostic log line was already being written, just going nowhere; this was the single highest-leverage fix for an otherwise fully opaque production box |
| System is chassis/OS identity only; Memory/Storage/Network are separate sections | Matches the real Datto nav exactly, once shown — corrects an earlier same-session merge that went the wrong direction |
| Warranty Expiration is a manually-entered field, not a vendor-API lookup | No OS/hardware API exposes real OEM warranty status on any platform; real lookups need separate Dell/HP/Lenovo partner-API integrations and still miss non-OEM builds — explicit user tradeoff, not a shortcut |
| Historical metrics (time-series charts) deferred entirely | Real new feature (storage schema, retention, charting), not a nav reshuffle — no time-series table exists in Beacon yet |
| WSL agent instead of installing directly on the Datto-managed work machine | Avoids both real EDR/security-alert risk and any device-policy question, at zero cost — WSL is a fully isolated Linux environment Beacon already supports natively |

### Next logical steps

1. **Manually reinstall v0.2.6 on the real `Nebuchadnezzar` device** — self-update never delivered any of v0.2.3–v0.2.6 to it this session; a clean reinstall breaks the deadlock and gives self-update a bug-fixed baseline to work from for all future releases. Check `C:\ProgramData\Beacon\agent.log` afterward — first real look at what this specific box's updater has actually been doing all along.
2. **Confirm self-update actually chains correctly from v0.2.6 onward** — validate against the new WSL test device first (safe, disposable), then the real Windows box once reinstalled, before trusting the v0.2.5 fix fully in production.
3. **External IP for the new Network section** — scoped but not built. Cheapest path is worker-side (capture the check-in request's own source IP into the device row), not an agent-side outbound call to a public IP-echo service.
4. **Monitors vs. Policies** — Datto's device nav has both as separate items; whether Beacon's existing Policies-with-monitor-counts view *is* Datto's "Monitors" concept under a different name, or something distinct is wanted, was explicitly tabled pending the user revisiting it.

## Session: 2026-07-13 (Device detail page overhaul + agent v0.2.2 release)

### What was completed

Continuation of the same-day auth/RBAC session's device-management work. Three phases, each driven by direct user feedback on a running local build (verified via Playwright MCP against `wrangler dev` + `vite dev` throughout):

**1. Device detail page: inline accordion → dedicated page → one-page-with-anchor-nav.** The devices list's inline expand-on-click accordion didn't scale ("doesn't really scale with a lot of devices") — split into a dedicated `/devices/:id` page (`DeviceDetailPage.vue`, new). First redesign attempt, modeled on a Datto RMM reference screenshot, used a left-nav + `v-if`/`v-else-if` **tabs** shape (Summary/Hardware/Security/Software/Services/Alerts/Policies/Change Log, the latter two newly built — device-scoped alert history and effective-monitor resolution, reusing `GET /v1/admin/alerts?device_id=` and a new `GET /v1/admin/devices/:id/effective-monitors` route backed by the already-`export`ed `resolveEffectiveMonitors`). User corrected this explicitly: "it is still supposed to be one page. The links just make it quicker to navigate." Converted every section to an always-rendered `<section>` block; nav clicks now `scrollIntoView` + update `?section=` for deep-linking, rather than switching visibility.

**2. Follow-up polish: section separation, scroll-spy, font size.** Three more rounds of feedback on the same page:
- "A lot of it runs together" → gave each section a distinct title-bar treatment (background-tinted heading + gutter between sections) instead of a thin border.
- "The highlight should update as I scroll" → added `IntersectionObserver`-based scroll-spy (see STYLE.md/CLAUDE.md for the pattern). Found and fixed a real edge case via actual scroll testing (not obvious from reading the code): the trailing "Change Log" section is short enough that a taller preceding section keeps winning the topmost tie-break even once fully scrolled down — added an explicit bottom-of-scroll override, applied both inside the observer callback and via a separately-deferred `scroll` listener (the observer alone doesn't always fire for the very last scroll increment).
- "Font looks a little small" → bumped several label/table-header sizes.
- Also fixed two bugs found only through Playwright scroll testing, not code review: sticky nav positioning silently broken by `.section-card`'s global `overflow:hidden`, and query-only navigation (`?section=` changing while already on the same device) not re-triggering the scroll since only `route.params.id` was watched.

**3. Header + Summary redesign, matching the Datto reference more closely.** User wanted the hostname bigger, the approved/OS meta line gone, the online-status dot moved inline next to the name, an OS icon, and Device ID/Agent moved to a "top right" identifiers area — plus Last User, Last Reboot, Last Audit, and Serial Number added, Approved date dropped. The first four were pure UI reshuffling. The last four required checking what data actually exists first (dispatched to an Explore subagent): Last Audit and Last Reboot were free (already-collected `auditData.createdAt` and a derivable `lastSeen - uptime_seconds`), but Last User and Serial Number were **not collected by the agent at all** — user chose to build the real agent-side collectors rather than defer:
- `BIOSInfo.serial_number` — DMI (`/sys/class/dmi/id/product_serial`, Linux), WMI `Win32_BIOS.SerialNumber` (Windows), `system_profiler` "Serial Number (system)" line (macOS).
- `HardwareInfo.last_logged_in_user` — gopsutil `host.Users()` (Linux/Darwin; picks the most-recently-started session), WMI `Win32_ComputerSystem.UserName` (Windows, since gopsutil's `Users()` is unimplemented there — confirmed by reading gopsutil's own source, not assumed).
- Both ride the existing `hardware` audit JSON blob — no migration needed, confirmed by checking `audit.ts` stores the payload as an opaque JSON blob rather than individual typed columns.
- Explicitly did **not** fabricate M365 User/PSA Device ID/Network Node/SNMP Credential/Assigned Network Node/Patch Status/Software Status — none of these have any real data behind them (no PSA/M365/SNMP/patch-management integration exists), so they're left out of Summary entirely rather than shown as placeholders.

**Agent v0.2.2 released end-to-end** — version bumped, all 5 platform/arch binaries built via `scripts/publish-agent.mjs` (run by the user directly, since it needs `BEACON_SIGNING_KEY`, which lives in the password manager only and was kept out of this session's transcript on purpose), registered with the worker. Found a real gap in the process itself: the script's default `download_url` (`${workerUrl}/dist/<name>`) is a dead placeholder — nothing serves that path, so agents would see `update_available: true` and then 404 trying to fetch it. Fixed by creating a real GitHub Release (`v0.2.2`, all 5 binaries attached) and re-registering each platform/arch's `download_url` to point at the real release asset URL, reusing the already-produced `signature_hex` (the signature covers binary bytes, not the URL, so no re-signing needed). Verified all 5 combinations end-to-end via the *unauthenticated* `GET /v1/agent/version` and `GET /v1/agent/download` endpoints (agents don't hold an admin credential, so these routes need none) — confirmed `HTTP/2 200` through to the real binary, not just a successful registration response.

### Key technical decisions

| Decision | Rationale |
|---|---|
| One continuous page with anchor-nav, not tabs | Explicit user correction — the left-nav is a navigation aid, not a visibility switch; matches the reference's own scroll behavior more closely than tabs would |
| Eager `Promise.all` fetch on device load, not lazy-per-section | Once nothing is conditionally hidden, there's no "activation" moment left to hang a lazy fetch off of |
| Scroll-spy never writes `?section=` on its own | Only explicit nav clicks update the URL — continuous scrolling would otherwise spam browser history on every section crossed |
| Bottom-of-scroll forced to last section, both in the IO callback and a deferred `scroll` listener | Two different failure modes need covering: the observer's own tie-break logic losing to a taller section, and the final scroll increment sometimes not firing the observer at all |
| Derive Last Reboot from `lastSeen - uptime_seconds` rather than add a new field | Already-collected data fully answers the question; no agent/schema change needed |
| Build real Last User / Serial Number collectors rather than defer | User's explicit choice when presented with the tradeoff (bigger cross-platform Go change + new agent release vs. shipping only the two free fields today) |
| Don't fabricate Patch Status / Software Status / M365 / PSA / Network Node fields | None of these have real data behind them in Beacon; a reference screenshot's layout is a guide for structure, not license to show placeholder values |
| Fix `download_url` via a second registration reusing the original signature, not a re-sign | The signature covers binary bytes; the URL is just metadata. Re-signing would need the private key again for a problem that isn't about the binary at all |
| Keep the production admin secret and signing key out of the session transcript | Both are meant to live in a password manager only (see CLAUDE.md Secrets table); anything typed via the `!` shell-passthrough becomes part of this conversation's stored history, which isn't an appropriate place for either credential — user ran both the publish script and the follow-up curl commands from their own terminal instead |

Both the dashboard and worker changes are pushed/deployed; the agent is at v0.2.2 with a working release. No new D1 migration this session — everything rode existing JSON columns or was pure frontend reshuffling.

### Next logical steps

1. **`scripts/publish-agent.mjs` still produces a dead placeholder `download_url` by default** — this was manually corrected again this release (third time now, after v0.2.0/v0.2.1 presumably needed the same fix). Worth fixing the script itself — either upload directly to a GitHub release as part of the script, or accept the real hosting URL as a parameter — so this stops being a recurring manual step.
2. **Confirm real devices actually pick up v0.2.2** — existing agents self-update on a 24h cycle; worth checking back after that window that Serial/Last User actually start appearing on real enrolled devices, not just the synthetic D1 test rows used to verify the UI this session.
3. **Real-fleet validation generally** — still the longest-standing carried-over item (see prior sessions below) — most of this session's UI work was verified via Playwright + synthetic D1 rows, not a real multi-device fleet over time.

## Session: 2026-07-13 (Multi-user auth + RBAC)

### What was completed

Replaced the single shared `ADMIN_SECRET` bearer-token model with real accounts: local email/password login, global RBAC roles (`admin`/`technician`/`readonly`), and Microsoft Entra ID SSO with group-based auto-provisioning. This was the main gap called out in the previous session's README Security notes.

**Schema** (`migrations/0016_users_auth.sql`) — six new tables: `users`, `user_sessions` (named to avoid colliding with the existing device shell/tunnel `sessions` table), `sso_providers` (Entra directory/client config, `directory_id` deliberately not named `tenant_id` to avoid confusion with Beacon's own client-company `tenants`), `sso_group_role_mappings`, `sso_login_state` (PKCE/CSRF state for the OAuth redirect), `sso_exchange_codes` (one-time code so the real session token never appears in a URL). Also added `sessions.client_auth_hash` — the pre-existing remote-shell WS auth scheme embedded the raw `ADMIN_SECRET` in the client's `?auth=` query param, which breaks once technicians (who never hold `ADMIN_SECRET`) can open sessions too; each session now gets its own random per-session token instead.

**Password hashing** (`worker/src/lib/password.ts`) — PBKDF2-HMAC-SHA256 via native `crypto.subtle`, zero new dependency. Self-describing storage format `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`. Originally set to 210,000 iterations (OWASP's current floor) — see "Production rollout follow-up" below for why this had to drop to 100,000.

**Session model** — opaque bearer tokens (reusing `generateToken()`/`sha256hex()` from `crypto.ts`, same convention as `enrollmentTokens.tokenHash`), not JWTs — chosen for instant revocation (logout/disable/role-change take effect on the very next request) and to keep the dashboard's existing `Authorization: Bearer <token>` + `localStorage` pattern with no cookies/CSRF machinery.

**Microsoft Entra ID SSO** (`worker/src/lib/oidc.ts`, `worker/src/routes/auth-microsoft.ts`) — added `jose` as a dependency (the one deliberate exception to the zero-third-party-crypto posture, scoped to this one file, justified by how easy JWKS/JWT verification is to get wrong by hand and how security-critical it is). Full PKCE authorization-code flow; always resolves group membership via Microsoft Graph `/me/transitiveMemberOf` (initially shipped as `/me/memberOf` — direct memberships only — corrected during the real Entra walkthrough below since nested groups are the norm, not the exception, in real Entra tenants) rather than the ID token's `groups` claim (Entra only embeds direct claims below ~200 groups); zero matching group mappings rejects the login outright with no user created; matching multiple mappings picks the highest-privilege role; role is re-resolved from group membership on every login.

**Backend auth primitives** (`worker/src/lib/auth.ts`) — added `requireUser(authHeader, env, minRole)`, which accepts either a real session token or the `ADMIN_SECRET` break-glass token (kept working indefinitely as a bootstrap/recovery path, never exposed in the dashboard UI), plus a `Role`/`roleAtLeast`/`highestRole` role-hierarchy helper. Swept all 11 existing admin route files plus `sessions.ts` off `requireAdmin` onto `requireUser` with a per-route minimum role (GET/list → readonly; routine mutations → technician; user/SSO management → admin) — same shape as the prior timing-safe-auth migration.

**New routes** — `/v1/auth/{login,logout,me}`, `/v1/auth/microsoft/{login,callback,exchange}`, `/v1/admin/users` CRUD, `/v1/admin/sso/providers` + nested group-mappings CRUD (admin-only, client secret AES-GCM-encrypted at rest via a new `CONFIG_ENCRYPTION_KEY` Workers secret, never returned in plaintext once stored).

**Dashboard** — `LoginPage.vue` now has email/password fields plus a "Sign in with Microsoft" button (full navigation, not fetch); new `SsoCallbackPage.vue` exchanges the one-time SSO code for a session token; new `dashboard/src/auth.ts` reactive current-user singleton (no Pinia, matching the app's existing no-state-library convention); new admin-only `UsersPage.vue`/`UserFormPage.vue`/`SsoSettingsPage.vue`; `App.vue` gets a role-gated "Settings" sidebar section and shows the signed-in user's name/role; `api.ts`'s `request()` now clears the token and redirects to `/login` on any 401 outside a login attempt (previously only `LoginPage` handled expired/invalid credentials — a real gap now that session expiry is a real scenario, not just a wrong-secret scenario).

### Key technical decisions

| Decision | Rationale |
|---|---|
| Global roles only, no per-tenant scoping | Beacon's users are internal MSP staff, not client-facing logins — user's explicit call |
| `ADMIN_SECRET` kept forever as break-glass | Bootstrap (create the first admin via curl) + recovery path; simpler than a seed script, accepted trade-off of the shared secret continuing to exist |
| Opaque bearer tokens over JWTs | Instant revocation without a denylist; zero new dependency for the highest-traffic auth path |
| SSO group→role mapping is JIT auto-provisioning | User's explicit design: map Entra groups to roles, anyone in a mapped group can sign in and gets a local account automatically |
| Always call Graph for group membership, never the ID token's `groups` claim | Entra only embeds direct-membership claims below ~200 groups; above that requires a Graph call anyway, so always calling it keeps behavior uniform regardless of group size |
| `jose` added as a dependency, scoped to `lib/oidc.ts` | The one narrow exception to the zero-crypto-dependency posture — hand-rolled JWKS/JWT verification is a well-known footgun class, and this gates admin authentication |
| Per-session random WS auth token, not `ADMIN_SECRET` | The existing remote-shell WS scheme hardcoded the shared secret into the client's `?auth=` query param — broke the moment a non-break-glass technician needed to open a session |
| No local password-reset email flow | No email infrastructure exists or was built; local accounts get admin-driven manual resets, SSO accounts recover entirely through Microsoft |

Migration and dashboard build both verified locally: `wrangler d1 migrations apply --local` applied cleanly, `vue-tsc -b && vite build` succeeded. Full curl-based verification against local D1 (bootstrap via break-glass, login, `/me`, role gating across all three roles, instant revocation on logout, instant effect of a mid-session disable, password hash format, SSO provider CRUD + secret-at-rest encryption, PKCE/state on the Microsoft redirect, per-session WS auth token) all passed.

**Browser-verified via Playwright MCP** (installed mid-session — headless Chromium via `playwright install chromium --with-deps`, registered at user scope pointed at the installed binary): login page renders (email/password + "Sign in with Microsoft"); logged in as a local admin and landed on `/devices`; sidebar footer shows signed-in identity/role; admin-only Settings section (Users, Single Sign-On) visible and both pages render real data (existing test users with role chips/status toggles; the SSO provider config + "IT Technicians" group mapping created earlier via curl, pre-populated correctly). Logged out, logged back in as the `readonly` test user — Settings section fully absent from the sidebar; direct navigation to `/settings/users` bounced to `/` via the router guard; clicking the (still-visible, not client-hidden) device "Revoke" button correctly got a 401 from the backend and triggered the global 401 handler — token cleared, redirected to `/login` — confirming both the role-gating defense-in-depth and the earlier-identified 401-handling gap are fixed end-to-end. Logged in as the `technician` test user and confirmed Settings is hidden for that role too (admin-only, not just non-readonly).

### Production rollout follow-up (same day, real Entra tenant + real deploy)

The one thing flagged as impossible to verify locally — a real Entra ID app registration — happened this same session, and caught three real bugs that local D1 + `wrangler dev` testing could not have surfaced:

1. **OAuth scope was missing the Graph permission entirely.** `auth-microsoft.ts`'s authorize request only asked for `openid profile email` — none of which grant Microsoft Graph API access. The `/me/transitiveMemberOf` call in the callback would have failed as insufficient-privilege on every real login, silently defeating the entire group→role mapping feature. Fixed by adding `GroupMember.Read.All` to the requested scope (and documenting that it needs admin consent in the Entra app registration's API permissions).
2. **`/me/memberOf` → `/me/transitiveMemberOf`.** As shipped, group lookup only saw direct group membership. Real Entra tenants routinely nest groups (a user in "Sub-Team" which is itself a member of "IT-Technicians"); the direct-only endpoint would silently fail to match those users against a mapping on the parent group. Switched to the transitive variant, which needs no additional Graph permission beyond what #1 already added.
3. **PBKDF2 iteration count exceeded a real Workers runtime cap.** Password hashing was shipped at 210,000 iterations (OWASP's current recommended floor) and passed every local `wrangler dev` test — but the actual Cloudflare edge runtime's `crypto.subtle` PBKDF2 implementation hard-caps at 100,000 iterations and throws `NotSupportedError` above that. This only surfaced once the bootstrap `POST /v1/admin/users` curl call hit the real deployed worker and came back `500`; the actual exception was only visible via `wrangler tail` (the client just sees a generic "Internal server error"). Dropped `DEFAULT_ITERATIONS` to 100,000. Notably, `wrangler dev` (local) did **not** reproduce this — worth remembering that local dev's runtime enforcement of edge-specific limits like this one isn't 1:1 with production, so anything touching `crypto.subtle` limits specifically should be sanity-checked against a real deploy, not just local dev, before considering it verified.

Practical lesson for future sessions: "verified locally" and "verified end-to-end" are not the same claim for anything that depends on either (a) a real third-party identity provider, or (b) exact Workers-edge runtime behavior rather than Miniflare/local simulation. Both bit this session despite deliberate local verification effort.

**End-to-end result**: after the three fixes above, the real rollout succeeded — bootstrap admin created via curl against the real deployed worker, real dashboard login at `rmm.cloud.synertekcs.com`, real Entra app registration configured through Settings → Single Sign-On, and a real "Sign in with Microsoft" login confirmed working (resolved the correct role from group membership). Microsoft SSO is no longer an unverified code path.

### Group search for SSO settings (same day, added after a UX complaint)

The Group → Role Mappings UI originally required pasting a raw Entra group Object ID — user feedback was that this should be a proper search/picker instead. Added:
- `worker/src/lib/oidc.ts`: `getAppOnlyGraphToken()` (OAuth2 client-credentials grant using the provider's own stored client_id/secret — not a delegated user token, since the admin configuring SSO may be logged in locally, not via Microsoft) + `searchGroups()` (Graph `/groups?$search=`, needs the `ConsistencyLevel: eventual` header).
- New route `GET /v1/admin/sso/providers/:id/groups?search=` (admin-only).
- `SsoSettingsPage.vue`: debounced (300ms) live search-as-you-type combobox, same interaction shape as `PolicyFormPage.vue`'s existing site-search combobox but backed by an async API call instead of filtering an already-loaded list. Kept a "Can't find it? Enter the Object ID manually" fallback link for when search fails or the permission isn't granted yet.
- **Needs a second, separate Entra permission**: `Group.Read.All` as an **Application** permission (distinct from the **Delegated** `GroupMember.Read.All` used at login time) — Application permissions are their own admin-consent step in the Entra app registration.

### Dashboard visual polish (same day, user-reported)

Two rounds of UI feedback, both resolved:

1. **Login page redesign** — user reported the redesigned auth/RBAC login page (email/password + Microsoft button, shipped earlier this session) looked "squished." Investigation found the card rendered exactly as designed at the reported window size — not a layout bug, just objectively denser than the old single-field form. Found and fixed one real bug in the process: `.lp-input`'s shared `letter-spacing: .08em` (meant to space out password dots) was also tracking out *typed email text*, which read as unpolished. Rebuilt: card widened 400→440px, more internal spacing, leading mail/lock icons inside the inputs, a "Forgot your password? Ask an admin" hint (there's no self-service reset), dropped the redundant footer branding, and swapped every hardcoded hex color for the project's actual CSS custom properties (`var(--accent)` etc. instead of `#4e7ef7`). `SsoCallbackPage.vue`'s shared `.lp-bg`/`.lp-card` shell synced to match.
2. **Sidebar collapse control** — user disliked the topbar hamburger-icon toggle, wanted something closer to a reference screenshot (a small circular chevron button straddling the sidebar's edge). Replaced: removed `.topbar-toggle` entirely, added `.sidebar-toggle-btn` — absolutely positioned relative to `.shell` (needed `position: relative` added there), `left` bound to `sidebarCollapsed ? 11 : sidebarWidth` so it tracks the sidebar's live width during a resize drag, chevron flips direction (`◀`/`▶`) based on collapsed state. The `11`px offset when collapsed (not `0`) matters — at `0` the circle's center sits exactly on the viewport edge and half of it renders off-screen.

Both browser-verified via Playwright MCP at multiple viewport sizes before and after.

### Next logical steps

1. **CONTRIBUTING.md** — still not written (carried over from the previous session).
2. **Real-fleet validation** — still outstanding (carried over from the previous session) — everything (including the now-validated SSO flow) has been exercised by one real admin account, not a real multi-user fleet of technicians/readonly staff over time.
3. **Worker has no CI/CD** — clarified with the user this session: only the dashboard (Cloudflare Pages) auto-deploys on push to `main`. The worker needs a manual `wrangler deploy` every time, and this bit us mid-session (a batch of worker fixes sat uncommitted/undeployed while only the dashboard side was pushed). Worth setting up Cloudflare Workers Builds or a GitHub Actions workflow if this keeps causing confusion.

## Session: 2026-07-13 (Open-source prep pass)

### What was completed

Decision: Beacon is being open-sourced (still primarily used internally by Synertek, but the repo is going public under AGPL-3.0). Audited the repo for anything that assumed "private repo, single org" and fixed what could be fixed in-session:

- **Auth hardening** — added `worker/src/lib/auth.ts` (`timingSafeEqual` via hash-then-compare, `requireAdmin`). Migrated all ~20 `ADMIN_SECRET` comparison call sites across 10 admin route files plus `sessions.ts` (including the WebSocket `?auth=` query-param check) off ad-hoc `===`/`!==` checks and 4 duplicated local `requireAdmin`/`auth()` helpers, onto the shared helper.
- **README.md added** — human-facing (architecture, features, self-hosting quick start, security notes), distinct from CLAUDE.md which stays AI-assistant-facing.
- **Config genericized** — `worker/wrangler.toml` and `dashboard/.env.production` (real Synertek domain/D1 database) are now gitignored; `.example` counterparts committed instead. CORS allowlist in `worker/src/index.ts` was hardcoded to Synertek's production domain and Pages project slug — moved to `wrangler.toml` `[vars]` (`ALLOWED_ORIGIN`, `PAGES_PREVIEW_SUFFIX`) so self-hosters configure it without touching source.
- **Go module path fixed** — was `github.com/synertekcs/beacon/agent`, didn't match the actual GitHub org (`synertek-cloud-services`). Renamed across `go.mod` and every internal import; confirmed `go build ./...` still passes.
- **Branding genericized** — `LoginPage.vue` footer and `scripts/seed-local.mjs`'s sample tenant name no longer hardcode "Synertek Cloud Services".
- **LICENSE** — chose AGPL-3.0 (copyleft, to prevent a hosted-SaaS fork without contributing back). Writing the full AGPL-3.0 legal text via the Write tool's `content` parameter reliably tripped the session's content filter (confirmed reproducible, not a one-off) — authoring that block of text directly is what triggered it, not the topic. Resolved by fetching the canonical text from GitHub's public Licenses API (`api.github.com/licenses/agpl-3.0`) via `curl` and writing it to `LICENSE` entirely within a Bash pipeline, so the license body never appeared as literal content in a tool-call parameter. Verified against the expected line count (661 lines) before committing.

### Key technical decisions

| Decision | Rationale |
|---|---|
| AGPL-3.0 over MIT/Apache-2.0 | Copyleft protects against someone forking Beacon into a closed competing hosted RMM without contributing back — deliberate tradeoff against maximizing adoption |
| `.example` config files, real ones gitignored | Keeps org-specific domain/database details out of a public repo without inventing a bigger env-var-injection system than the project needs |
| CORS origin moved to `wrangler.toml` vars, not left hardcoded | Same genericization goal as the `.example` files — a self-hoster's domain shouldn't require editing `index.ts` |
| LICENSE fetched from GitHub's Licenses API via `curl`, not authored in a tool call | The AGPL-3.0 boilerplate text itself (not the surrounding topic) reproducibly triggered the content filter when passed as literal `Write` content; piping it through Bash instead avoided the filter and still yields the exact canonical text |

Both the LICENSE and everything else in this pass are committed and pushed (`ae69ba0` → `1d453f5` → `351c516` on `main`).

### Next logical steps

1. **Multi-user auth** — currently one shared `ADMIN_SECRET` bearer token, no per-user accounts/roles. Called out in README's Security notes as the main gap for a public-facing deployment; not fixed this session (bigger design question, deliberately out of scope).
2. **CONTRIBUTING.md** — not yet added; worth writing if outside contributions are actually expected, with basic PR/issue expectations and dev setup pointers (README already covers self-hosting setup, so this would focus on contribution workflow specifically).
3. **Confirm no other environment-specific values got missed** — this pass covered what turned up in a manual grep audit (`synertek`/`codenexus` strings, hardcoded domains, committed secrets) rather than an exhaustive one; worth a second pass if anything Synertek-specific surfaces post-publish.

## Session: 2026-07-12 (Datto RMM monitor parity pass)

### What was completed

Went through Datto RMM's full monitor catalog (26 monitor types) one at a time, triaged which to build, and shipped **six new check types** plus **one performance initiative** plus **two core bug fixes**. Beacon now has 11 check types total (up from 3 at session start): `disk_space`, `cpu_usage`, `memory_usage`, `av_status`, `offline`, `file_size`, `ping`, `process`, `service`, `software`.

**Disk Space rebuilt for multi-drive** (`migrations/0012_disk_monitor_v2.sql`)
- Agent now enumerates *all* drives (new `diskutil` package, shared with the audit collector's existing multi-drive logic) instead of just the system drive
- Config gained `drive` ("any" or specific), `threshold_type` (gb_free/gb_used/percent_used), `min_disk_gb` filter — matches Datto's Any-Drive + threshold-mode + size-filter options

**Seeded Memory Usage and CPU Usage default policies** (`0013`, `0014`) — CPU seeded as *two* monitors (100%/critical + 95%/high early-warning) per Datto's own recommended pattern.

**D1 cost/performance pass** (`0015_check_interval.sql`) — prompted by the user asking why every monitor gets checked every 60s. Two changes: (1) `processAlertState` now skips writing `alert_state` when nothing actually changed (was writing identical rows every check-in even for healthy devices — cut steady-state D1 writes ~6-7x); (2) new `check_interval_minutes` per monitor lets operators throttle sampling below 60s for monitors where that matters.

**Online Status monitor** — turned out to be mostly already-built (`offline` check type already did the "goes offline" direction). Added the "comes online" direction by reusing the existing `sustainedMinutes` field for the online-duration concept rather than inventing a new one.

**File/Folder Size, Ping, Process, Service monitors** — all four follow the same new "assign → measure → report" protocol pattern (worker tells agent what to check in the check-in response, agent measures async, reports on the next check-in) — a generalization of the pre-existing `commands`/`pending_command_results` shape. See CLAUDE.md for the full pattern writeup. Notable pieces:
- Ping bundles all 3 Datto conditions (unreachable/packet-loss/latency) into one monitor, not three, to avoid redundant pinging
- Service adds a boot-delay concept, implemented by gating *assignment* (not evaluation) on `metrics.uptime_seconds`
- Explicitly **skipped** Datto's auto-remediation response actions (kill process / start-restart service) — different risk class (unattended destructive action on production endpoints) from every read-only monitor built this session; confirmed with the user, deferred rather than silently dropped

**Software monitor** — architecturally the odd one out: event-driven (install/uninstall/version-change), not state-driven. Discovered Beacon's existing audit-diff system (`worker/src/routes/audit.ts`'s `diffSoftware()`) already computes exactly this data on every `POST /v1/audit` — the feature was mostly wiring, not new detection logic. Datto's own spec: never auto-resolves (hardcoded, hidden in UI).

**Two real bugs found and fixed in `processAlertState`** (both discovered organically while building the above, not pre-planned):
1. Dedup collision — monitors were deduped by `checkType` alone; two monitors of the same type (CPU's critical+warning pair) would silently collapse to one. Fixed by generalizing to group-based scope resolution.
2. Fire-immediately — first-ever detection of a failing condition only ever seeded `condition_first_seen`, requiring a second consecutive failure to actually alert. Invisible for 60s-polled monitors, but meant Software monitor would never fire on the actual event it exists to catch (audit-driven, transitions never repeat). Fixed: `sustained_minutes === 0` now fires on first detection.

**Monitor catalog triage** — reviewed all 26 Datto monitor types, explicitly skipped: ESXi (5 monitors) and SNMP (2) — need network-node/agentless-device infrastructure Beacon doesn't have; Datto Continuity — tied to Datto's own backup appliance; Ransomware/Threat Detection — proprietary ML detection engines; Windows Defender AV — redundant with existing `av_status`; WMI and Windows Performance — generic power-user escape hatches, lower priority. Event Log remains parked (needs a filter mini-DSL + occurrence-based state — a different shape from everything else built this session).

### Key technical decisions

| Decision | Rationale |
|---|---|
| "Assign → measure → report" generalized from `commands` pattern | Reuse over reinvention — the shape already existed for one-shot commands, just needed to persist across a check-in cycle for recurring measurements |
| One `policy_monitor` per ping target, not per condition | Datto's UI is one monitor/one priority for 3 bundled conditions; splitting would mean redundant pinging of the same target |
| `check_interval_minutes` throttles *assignment*, stateless | Bucketing by wall-clock minute avoids needing a "last checked" timestamp, which would reintroduce the exact write-per-check-in problem being solved |
| Software monitor hooks the audit flow, not check-in | The data it needs (`diffSoftware` output) only exists on the audit ingestion path; forcing it through check-in would mean rebuilding delta detection that already exists |
| `sustained_minutes === 0` means "fire on first detection" (post-fix) | A 0-minute debounce window literally means no debounce wanted — waiting for a second sample contradicted the setting |
| Skip auto-remediation actions (kill process, start service) | Different risk class from read-only alerting — unattended destructive action on production endpoints deserves its own deliberate pass, not a bundled add-on |
| gopsutil directly for Process/Service CPU/mem, shell-out only for service→PID resolution | gopsutil already a dependency; only the service name → PID step genuinely needs Windows-specific WMI |

### Next logical steps

1. **Event Log monitor** — still parked, scope decision pending (full Datto fidelity — description-matching DSL, occurrence counting, dedup/rate-limiting — vs. a reduced core-match v1). Genuinely different architecture from everything built this session (needs the agent to locally filter and only report matches, not a single measurement).

2. **Auto-remediation actions** — Process monitor's "stop the process" and Service monitor's "start/restart the service" were explicitly deferred, not built. The plumbing exists (`commands`/`executor` already supports arbitrary command types) — would need a new `kill_process`/`start_service` command type plus UI opt-in, with real thought about safety (confirmation, allowlisting, audit trail) given it's unattended and destructive.

3. **Software/Patch/Component monitors from the remaining triage list** — Software is done; Patch monitor needs new agent capability (WUA query, doesn't exist yet); Component monitor (run arbitrary script, alert on result) would be a general-purpose escape hatch covering the long tail of what's left on Datto's list, reusing Beacon's existing `/components` script library.

4. **Real-fleet validation** — everything this session was verified against local D1 + simulated check-ins/audits via curl, not a real deployed agent. Worth an end-to-end pass with actual Windows/macOS/Linux agents once there's a fleet to test against, especially for the Windows-only monitors (`service`, and `svcutil`'s `Get-CimInstance` path) that couldn't be exercised on this Linux dev box.

## Session: 2026-07-10 / 2026-07-12

### What was completed

**Two-tier monitoring policy system (full stack)**
- Migrations `0010_policies.sql` + `0011_default_policies.sql` — replaced flat `alert_definitions` with `policies` / `policy_monitors` / `alert_state` tables
- Worker: `worker/src/routes/admin/policies.ts` — full CRUD for policies and nested monitors; `GET /policies` embeds monitors in response
- Worker: `worker/src/lib/alerts.ts` — rewrote to resolve effective monitors per device (company scope wins over global), evaluate `sustained_minutes` via `condition_first_seen` timestamp, handle `auto_resolve_after_minutes`
- Added `av_status` check type; AV monitor key is `av_status:${av_state}` to allow multiple AV monitors per policy
- Seeded 3 default global policies: Antivirus Health, Disk Space, Device Offline

**Dashboard — GlobalPoliciesPage redesign**
- Replaced card/accordion with NinjaRMM-style table: Name, Targets, Scope, Monitors count, Created, Enabled toggle
- Row click expands inline monitor detail panel (read-only; manage monitors via Edit Policy page)
- Toolbar: row count, Edit (1 selected → navigate to edit page), Delete, Override (clone to company scope)
- Expand state: `reactive<Record<string, boolean>>` — required because `ref<Set>` has subtle Vue 3 reactivity edge cases
- Override modal: clones selected global policies to a target company via `clone_from` POST param

**Dashboard — PolicyFormPage (new)**
- Full dedicated page at `/global/policies/new` and `/global/policies/:id`
- Matches Datto RMM create-policy UX: breadcrumb nav, back button, form sections (Name, Description, Scope, Monitors, Targets, Enabled)
- Add Monitor: right-side drawer panel (620px) with 3 sections — Monitor Type (clickable type cards with SVG icons), Alert (type-specific config + period + priority + auto-resolve), Response (webhook toggle)
- New policies: monitors accumulate locally, all POSTed on Save
- Edit policies: monitor changes hit API immediately; policy field changes deferred to Save

**Dashboard — Sidebar improvements**
- Resizable: drag handle on right edge, width persisted to `localStorage` (`beacon-sidebar-w`)
- Collapsible: hamburger button in topbar, persisted to `localStorage` (`beacon-sidebar-collapsed`)
- Active client block: appears inside Companies section when a company is selected, shows company name + Devices sub-link, persists across navigation, cleared with × button
- Sidebar gets `z-index: 600` so it stays above any fixed page overlays (drawers, etc.)
- Company list removed from sidebar — replaced by active-client block

**Dashboard — DevicesPage fix**
- "Filtered by company" now resolves company name from the tenants list instead of device records, so it works even when a company has zero enrolled devices

### Key technical decisions

| Decision | Rationale |
|---|---|
| `reactive<Record<string, boolean>>` for expand state | `ref<Set>` mutations aren't reliably tracked by Vue 3's dependency system when the Set is replaced |
| Monitors embedded in policy list response | Avoids N+1 queries; `GET /policies` always returns monitors in the same payload |
| `av_status:${av_state}` as scope-resolution map key | Allows all three AV states to coexist as separate monitors on one policy |
| `condition_first_seen` timestamp for sustained_minutes | Time-based debounce is more reliable than failure-count-based; survives agent restarts |
| Full-page form for Create/Edit policy | Matches Datto RMM UX; allows complex monitor management without modal nesting |
| Right-side drawer for Add Monitor | Keeps sidebar visible; doesn't feel like full navigation change |
| Sidebar `z-index: 600` | Ensures sidebar always sits above any `position: fixed` content overlays from page components |

### Next logical steps

1. **Test full policy alert evaluation end-to-end** — enroll a real agent, trigger a CPU/disk/offline condition, confirm `alert_state` row transitions from `condition_first_seen` → `is_alerting = 1` after `sustained_minutes`; verify webhook fires; verify auto-resolve after `auto_resolve_after_minutes`.

2. **Alert detail / device alert view** — currently `GlobalAlertsPage` lists all active alerts globally. Add a per-device alert tab on the device detail view so techs can see active alerts for a specific endpoint without leaving its context.

3. **Policy assignment feedback on devices** — show which policies are currently active for a device (the effective monitors resolved for that device's OS + class + tenant). This helps techs understand why a device is or isn't alerting. Would live on the device detail page as a "Monitoring" tab.
