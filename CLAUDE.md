# Beacon — CLAUDE.md

Self-hosted RMM platform, originally built for Synertek Cloud Services (developed by CodeNexus), now open-sourced under AGPL-3.0. Monorepo: Go agent, Cloudflare Workers backend, Vue 3 dashboard. See `README.md` for the human-facing overview and self-hosting quick start — this file is the AI-assistant-facing architecture/convention reference.

## Project status (as of 2026-07-15)

- **Agent is at v0.2.8.** Eight releases across three consecutive sessions (v0.2.2 → v0.2.8) — see "Agent release process" below before cutting another one. v0.2.8 carries the Interactive Remote Shell's PTY backend (see below). The dead-placeholder-download-URL gotcha is now actually fixed in `publish-agent.mjs` itself (a `BEACON_DOWNLOAD_BASE_URL` env var), not just worked around by hand every time — see "Agent release process" below. **Every release must still be independently re-verified** (download the real GitHub asset, re-run the Ed25519 check against the registered `signature_hex`) before being considered shippable — a successful `/v1/admin/agent/versions` POST is not proof the signature is actually valid; this caught nothing new in v0.2.8 but remains standing practice after the real v0.2.2 signing-key corruption incident (below).
- **Interactive Remote Shell shipped — first slice of a Datto-style "Agent Browser."** Reused Beacon's pre-existing but never-actually-used `SessionRelay` Durable Object (generic bidirectional WS relay) end to end: rewrote the agent's `agent/internal/session/shell.go` from a one-shot-command-per-message stub into a real persistent PTY-backed shell (`creack/pty` on Linux/macOS, `UserExistsError/conpty` on Windows — `creack/pty` mainline does not support Windows), and built the dashboard's first-ever UI for this system (`RemoteShellModal.vue`, xterm.js). Testing this for the first time from a real browser surfaced two real, pre-existing bugs in `sessions.ts`/`index.ts` — see "Remote Shell / session system" below. Datto's full Agent Browser (File Manager, Task Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart, network device deploy/wake) is deliberately **not** built yet — scoped to just the shell this pass, given the size and varying security implications of the rest; all of it can reuse the same relay/auth/dial-out plumbing this proved out.
- **External IP added to the device Network section** (migration `0023_device_external_ip.sql`) — captured worker-side from the check-in request's own `CF-Connecting-IP` header, no agent change needed.
- **Change Log moved from an unbounded inline section to a dedicated, filterable, paginated page** (`/devices/:id/change-log`) — the old inline section had no pagination and `device_audit_changes` grows without a cap, so this was a real (not hypothetical) scaling problem. Reached via a "Change Log" button in the System section, matching Datto's actual placement.
- **Known outstanding**: production `ADMIN_SECRET` rotation, flagged since 2026-07-14 (exposed in a session transcript), still not done.
- **Self-update had a real, serious bug, fixed in v0.2.5**: `agent/internal/updater/updater.go`'s `awaitConfirmation` resolved a confirmed-or-rolled-back update and then just returned, despite its own comment claiming it "schedules the next check after confirming." It never did. Once a device went through **one** successful self-update, that process's updater goroutine permanently stopped checking for any future release — no crash, no error, nothing visible. This is almost certainly why a real production device got 0.1.0-era → 0.2.2 once, then silently never noticed v0.2.3 or v0.2.4 existed despite both being correctly signed and reachable. Fixed: both branches now fall through to `runLoop`. **v0.2.6 also added persistent logging** (`<credDir>/agent.log`) — Windows services have no console, so this whole class of bug had been completely undiagnosable in production up to this point; `agent.log` is now the first thing to check on any future self-update report.
- **Device detail page redesigned across two sessions.** Dedicated `/devices/:id` page (was an inline expand-accordion on the devices list) → Datto-RMM-style single continuous page with left-nav + scroll-spy (not tabs — see "Device detail page" below). Nav is now **Summary → System → Alerts → Policies → Software → Services → Memory → Storage → Network → Security → Change Log**, matching a real Datto device page nav exactly. This went through two real corrections after being shown actual Datto reference screenshots mid-build: an initial "System" section absorbed the old standalone "Hardware" section (to fix real field duplication across Summary/System/Hardware), and *that merge itself* had to be partially undone once Datto's actual nav showed Memory/Storage/Network as their own separate items, not folded into System. System is now identity-only (OS/BIOS/manufacturer/model/motherboard/serial/processor — no RAM, disks, or network adapters).
- **`Run Audit Now` was fully broken until this session** — a real pre-existing bug, not new: the dashboard, `api.ts`, and the agent all already spoke a `run_audit` command end-to-end, but the worker's command-queueing route never implemented that branch, silently 400ing every request. Fixed.
- **Warranty Expiration** is a manually-entered date field (`devices.warranty_expires_at`, migration `0019`) — deliberately not a vendor-API lookup. No OS/hardware API on any platform exposes real OEM warranty status; a real lookup needs separate Dell/HP/Lenovo partner-API integrations and still misses VMs/white-box builds. Evaluated and declined this session in favor of the manual field.
- **10 check types** shipped across the policy/monitor system (see Two-Tier Policy System below): `disk_space`, `cpu_usage`, `memory_usage`, `av_status`, `offline`, `file_size`, `ping`, `process`, `service`, `software`.
- **Multi-user auth + RBAC shipped and production-validated** (see Auth System below) — local email/password accounts, global roles (`admin`/`technician`/`readonly`), Microsoft Entra ID SSO with group-based auto-provisioning. The single shared `ADMIN_SECRET` model (previously the main open-source gap) is now a break-glass fallback only, not the primary auth path. This went through a real production rollout (real Entra app registration, real `wrangler deploy`, real Microsoft login) — not just local D1/curl testing — and that rollout caught three real bugs now fixed: a missing Graph OAuth scope, direct-only vs. transitive group membership, and a Cloudflare Workers PBKDF2 iteration cap. See PROJECT_LOG.md's "Production rollout follow-up" for details — worth reading before touching `worker/src/lib/password.ts` or `worker/src/lib/oidc.ts` again.
- **SSO group search** — Settings → Single Sign-On now has a live group-name search (backed by an app-only Graph client-credentials call) instead of requiring admins to paste a raw Entra group Object ID, with a manual-entry fallback.
- **Open-sourced under AGPL-3.0** — repo is public. `LICENSE`, `README.md` in place; org-specific config (`wrangler.toml`, `dashboard/.env.production`) moved to gitignored files with `.example` templates; Go module path corrected to match the actual GitHub org.
- **Known gap**: the worker has no CI/CD — only the dashboard (Cloudflare Pages) auto-deploys on push to `main`. Every worker change needs a manual `cd worker && npx wrangler deploy`; there's no GitHub Actions workflow and no Cloudflare Workers Builds git integration configured. Hit repeatedly this session (every migration + worker change needed manual `wrangler d1 migrations apply` + `wrangler deploy`).
- **First real-production-device validation this session** — the device detail work and several agent releases were checked against an actual enrolled Windows device (hostname `Nebuchadnezzar`), not just local D1 + synthetic rows, and that's exactly what surfaced the signing-key incident and the self-update bug above (neither would have shown up against local `wrangler dev` testing alone). That device still hasn't successfully self-updated past v0.2.2 as of end of session — see PROJECT_LOG.md's "Next logical steps."
- **Components Library v2 shipped**, moving Beacon's script/component library toward Datto RMM parity (deliberately not 1:1) across three passes in one session: (1) reused the previously-dead `type` enum as a real Script/Application "Kind" selector (the old freeform `category` field is now labeled "Group" in the UI so it stops colliding with `type`), added typed **input variables** (String/Selection/Boolean/Date, always passed to the agent as strings, prompted at job-creation time via a shared `ComponentVariablePrompt.vue`), a stub **ComStore** (`components.origin`: `custom`|`store`, seeded built-in examples, browse + clone-to-library), and **post-conditions** (stdout/stderr text/regex matching that sets a new `commands.warning` flag — a non-fatal "Warning" state, never changing pass/fail); (2) added list-page stat cards and converted Create/Edit from a modal to a full page (`ComponentFormPage.vue`, mirrors `PolicyFormPage.vue`); (3) added **Sites scoping**, which went through a real in-session correction worth knowing about — first shipped mirroring the Policy system's single `company_id` (migration `0021`), then rebuilt as a proper many-to-many `component_sites` join table (`0022`) once real Datto reference screenshots showed an "Add Site" flyout that adds multiple sites one at a time, not a single-select. `components.company_id` is now a vestigial, unused column — shipped and superseded within the same session, before any real usage. Full data model in "Components / Job System" below.
- **Virtualization platform detection added** to `HardwareInfo` (`agent/internal/audit/hardware.go`'s `detectVirtualization()`) — explains why a device's System/BIOS hardware facts are sometimes empty (WSL2 doesn't expose `/sys/class/dmi/id/*` the way a full VM does). Detects WSL2/Hyper-V/VMware/VirtualBox/KVM-QEMU/Xen on Linux, Hyper-V/VMware/VirtualBox/KVM on Windows, and Apple's Virtualization Framework guest flag on macOS. Verified live against this session's own WSL2 dev machine (correctly returned `"WSL2"`).
- **Migrations `0020`–`0022` and the corresponding worker deploys are done in production** (variables/ComStore/post-conditions, the superseded single-site attempt, and the real multi-site table respectively) — the dashboard side rode Cloudflare Pages' existing auto-deploy.
- **Agent v0.2.7 released** — carries the two previously-unreleased Go changes: `executor/run.go` variable→env-var injection (now live on real devices) and `hardware.go` virtualization detection. Release followed the standing process (GitHub release first, all 5 binaries independently Ed25519-re-verified before registering). Fixed dead placeholder download URLs before any device could attempt them.
- **Job completion bug fixed** (`worker/src/routes/checkin.ts`) — jobs were permanently stuck as `active`. `checkin.ts` processed command results but never checked whether all commands had reached a terminal state. Fix: after processing results, iterate `affectedJobIds` and flip `jobs.status = 'completed'` when no commands remain in `queued`/`sent` state.
- **`created_by` now populated on job insert** (`worker/src/routes/admin/jobs.ts`) — the column existed but was never set. Now captured from `requireUser`'s return value: break-glass → `'Admin'`, real user → `displayName ?? email`. Old null rows backfilled.
- **`DELETE /v1/admin/jobs/:id/purge` added** — hard-deletes a job and all its commands (admin-only). The existing `DELETE /:id` is now explicitly "Retire" (cancel + keep history, technician role).
- **Jobs page redesigned** (`dashboard/src/pages/JobsPage.vue`) — stat cards (Total/Quick/Scheduled/Active/Completed) with colored top borders; filter bar defaulting to current user + active status; filter chips with × dismiss; "Reset Filters" restores defaults (not blank); row checkboxes with Retire/Delete bulk actions; "Created by" and "Created" columns; client-side pagination (20/50/100 per page). See STYLE.md for the new filter chip bar and pagination bar patterns.

## Repository layout

```
agent/        Go agent (runs on managed endpoints)
worker/       Cloudflare Worker (Hono + D1)
dashboard/    Vue 3 + Vite SPA (Cloudflare Pages)
migrations/   D1 SQL migrations (0000 … 0023)
scripts/      Utility scripts
Makefile      Top-level task runner
LICENSE       AGPL-3.0
README.md     Human-facing overview + self-hosting quick start
```

## Commands

### Worker (Cloudflare Worker)
```bash
make dev              # wrangler dev (local)
make deploy           # wrangler deploy (production)
make migrate-local    # apply pending migrations to local D1
make migrate-remote   # apply pending migrations to production D1
make db-generate      # regenerate Drizzle schema types
make type-check       # tsc --noEmit
```

### Dashboard (Vue 3 / Vite)
```bash
cd dashboard
pnpm dev              # local dev server on :5173
pnpm run build        # type-check + vite build
```
CI/CD: Cloudflare Pages auto-deploys on push to main when `dashboard/*` changes.
Root dir: `dashboard`, build command: `pnpm run build`, output: `dist`.

### Agent (Go)
```bash
make build-agent-windows   # dist/agent-windows-amd64.exe
make build-agent-linux     # dist/agent-linux-amd64
make build-agent-darwin    # dist/agent-darwin-arm64
# or from agent/:
go build ./...
```

## Secrets — never commit these

| Secret | Where it lives |
|---|---|
| `ADMIN_SECRET` | `worker/.dev.vars` (gitignored) |
| `CONFIG_ENCRYPTION_KEY` | `worker/.dev.vars` (gitignored) — AES-GCM key (hex) encrypting SSO provider client secrets at rest |
| `CLOUDFLARE_API_TOKEN` | direnv `.envrc` (gitignored) |
| Ed25519 private key (agent signing) | Password manager only |

`worker/.dev.vars` already has `ADMIN_SECRET="beacon-local-admin-secret"`, a `CONFIG_ENCRYPTION_KEY`, and `WORKER_URL="http://localhost:8787"` for local dev.

`ADMIN_SECRET` is compared via `worker/src/lib/auth.ts`'s `requireAdmin`/`timingSafeEqual` (hash-then-compare, not `===`) — now only reachable through `requireUser` (see Auth System below) as the break-glass fallback path. Never add a new inline `auth === \`Bearer ${secret}\`` check or a second hand-rolled admin check; every route goes through `requireUser`.

## Self-hosting config (not secrets, but org-specific — gitignored with `.example` templates)

`worker/wrangler.toml` and `dashboard/.env.production` are gitignored (real values are Synertek's own domain/D1 database, not committed for a public repo). Tracked `.example` counterparts (`worker/wrangler.toml.example`, `dashboard/.env.production.example`) hold placeholder values — anyone self-hosting copies the `.example` file and fills in their own domain/database ID. `worker/wrangler.toml`'s `[vars]` block (`ALLOWED_ORIGIN`, `PAGES_PREVIEW_SUFFIX`) drives the CORS allowlist in `worker/src/index.ts` — don't hardcode a domain back into `index.ts`. `[vars]` also holds `WORKER_URL` (this worker's own public origin) — used by `sessions.ts` to build absolute agent/client WebSocket URLs. Deliberately a configured value rather than derived from the incoming request's own URL: with a `[[routes]]` custom-domain block present (as production's is), `c.req.url` reflects the production route even under `wrangler dev`, which previously caused local-dev remote-shell sessions to silently dial out to the real production worker instead of the local one — found and fixed during the Remote Shell session below.

## Production URLs

| Service | URL |
|---|---|
| Worker API | `https://rmm-api.cloud.synertekcs.com` |
| Dashboard | `https://rmm.cloud.synertekcs.com` |
| Pages previews | `*.beacon-dashboard-6f4.pages.dev` |

## Architecture

**Worker** (`worker/src/`)
- Framework: Hono on Cloudflare Workers
- Database: Cloudflare D1 (SQLite) via Drizzle ORM (`worker/src/db/schema.ts`)
- Cron: runs every 2 minutes (`*/2 * * * *`) — evaluates offline alerts
- Durable Object: `SessionRelay` for shell/TCP tunnel sessions — see "Remote Shell / session system" below
- All admin routes under `/v1/admin/*`, `/v1/auth/*`, and `/v1/sessions*` require `Authorization: Bearer <token>` — either a real user session token or the `ADMIN_SECRET` break-glass token, resolved by `requireUser` (see Auth System below)
- CORS allows: production domain, localhost:5173, `*.beacon-dashboard-6f4.pages.dev` — must be explicitly enabled per route prefix (`app.use('/prefix/*', corsMiddleware)` in `index.ts`); `/v1/sessions` was missing from this list entirely until this session, since nothing had ever called it from a browser before

**Agent** (`agent/`)
- Module: `github.com/synertek-cloud-services/beacon/agent` (matches the GitHub org this repo is published under)
- Check-in interval: 60 seconds
- Metrics sent on every check-in: hostname, OS, uptime, disk_free_bytes, disks[] (multi-drive), cpu_percent, memory_percent, detected_class, av_status, av_product
- Check-in request also carries `pending_{file_size,ping,process,service}_results`; response carries `{file_size,ping,process,service}_checks` — see "Assign → measure → report pattern" below
- Audit (full inventory snapshot) fires 5 min after startup, then every 24 h, or on `run_audit` command
- Unknown command types are silently ignored for forward compatibility
- New fields added to `Metrics` must remain optional (old agents won't send them)
- Internal packages worth knowing: `diskutil` (shared multi-drive enumeration between check-in and audit), `filesize`, `pingutil`, `procutil`, `svcutil` — each is a small `Find`/`Measure`/`Ping` function following the same shell-out-or-gopsutil convention as the older `audit` package's AV/BIOS collectors
- `agent/internal/audit/hardware.go`'s `collectBIOS{Linux,Windows,Darwin}()` also collect `BIOSInfo.serial_number` now (DMI `/sys/class/dmi/id/product_serial` on Linux — root-only permission, silently empty if the agent isn't running as root; WMI `Win32_BIOS.SerialNumber` on Windows; `system_profiler SPHardwareDataType`'s "Serial Number (system)" line on macOS), and `collectHardware()` also sets `HardwareInfo.last_logged_in_user` via `collectLastLoggedInUser()` (gopsutil `host.Users()` on Linux/Darwin — picks the most-recently-started session; WMI `Win32_ComputerSystem.UserName` on Windows, since gopsutil's `host.Users()` is unimplemented there). Both ride the existing `hardware` audit JSON blob — no new DB column/migration needed for either.
- `HardwareInfo` also carries (v0.2.3/v0.2.4, same "rides the existing JSON blob, no migration" pattern): `Architecture` (free — `runtime.GOARCH`, no collection needed); `System` (`SystemInfo`: Manufacturer/Model/Motherboard — DMI `sys_vendor`/`product_name`/`board_vendor`/`board_name` on Linux, `Win32_ComputerSystem`+`Win32_BaseBoard` on Windows, `system_profiler` "Model Name" on macOS with no motherboard concept there — Macs are unibody); `DisplayAdapters` (`lspci` parse on Linux, `Win32_VideoController` on Windows — wrapped in a `[PSCustomObject]` so `ConvertTo-Json` can't collapse a one-element result to a bare scalar, `system_profiler SPDisplaysDataType` "Chipset Model" on macOS); `RAM.InstalledBytes` (raw physical DIMM capacity, distinct from gopsutil's OS-visible/usable `RAM.TotalBytes` — `dmidecode --type 17` on Linux, same root-only caveat as BIOS serial; `Win32_PhysicalMemory` sum on Windows; `system_profiler` "Memory:" line on macOS); `Domain`/`WindowsDisplayVersion`/`WindowsInstallationType` (Windows-only, no Linux/macOS equivalent — `Domain` only set when `Win32_ComputerSystem.PartOfDomain` is true, since that property returns the *workgroup* name otherwise); `Virtualization` (detected guest platform — `detectVirtualization()` checks `/proc/sys/kernel/osrelease` for WSL2's own kernel signature first, then DMI vendor/product strings for Hyper-V/VMware/VirtualBox/KVM-QEMU/Xen on Linux; `Win32_ComputerSystem` Manufacturer/Model pattern-matching on Windows; `kern.hv_vmm_present` sysctl on macOS — empty string on bare metal or when undetectable. **Not yet in any released agent build** — see Project status above).
- `agent/internal/updater/` (self-update) — `runLoop` checks `/v1/agent/version` every 24h after an initial 5-minute stagger; a successful update writes `<credDir>/update-state.json` and hands off to `awaitConfirmation` on the next process start, which must fall through to `runLoop` again once resolved (a real bug, fixed in v0.2.5 — see Project status above) or the device permanently stops checking for updates after one successful cycle. `<credDir>/agent.log` (v0.2.6) is the first thing to check when self-update is ever in question — Windows services have no console, so nothing here was visible in production before this.
- `agent/internal/session/` — handles `open_session` commands (dispatched from `main.go`'s command loop in its own goroutine). `session.go` dials the relay WS and switches on `session_type`; `tunnel.go` is a raw byte pump for `tcp_tunnel` (Secure-RDP-style); `shell.go` (rewritten this session — see "Remote Shell / session system" below) spawns a real persistent PTY-backed shell via `pty_unix.go`/`pty_windows.go`. These two are genuine build-tag-separated files (`//go:build !windows` / `//go:build windows`), not a `runtime.GOOS`-switch single file like `hardware.go` — the Windows ConPTY library needs Windows-only Go packages that don't compile cross-platform, unlike `hardware.go`'s shell-out-to-native-CLI approach.

### Agent release process (`scripts/publish-agent.mjs`)

Builds all 5 platform/arch binaries, signs each with `BEACON_SIGNING_KEY`, and registers each with the worker via `POST /v1/admin/agent/versions` — needs `BEACON_WORKER_URL`, `BEACON_ADMIN_SECRET`, `BEACON_SIGNING_KEY` env vars (signing key lives in the password manager only, never export it into a session whose transcript you don't want holding a private key). **Must be run from the repo root**, not `agent/` — it resolves `scripts/publish-agent.mjs` and `agent/` relative to its own script location, but the working directory still matters for the relative build paths it shells out to.

**The dead-placeholder-`download_url` gotcha is now actually fixed, not just worked around by hand.** For v0.2.0–v0.2.7, the script's default `downloadUrl` (`${workerUrl}/dist/<name>`) was a dead URL nothing served — registration succeeded and `update_available` correctly flipped `true`, but any agent attempting the download got a 404. The standing workaround was creating the GitHub Release *before* registering, then hand-crafting the real asset URL. As of the v0.2.8 release, `publish-agent.mjs` accepts a `BEACON_DOWNLOAD_BASE_URL` env var (e.g. `https://github.com/<org>/<repo>/releases/download/v<version>`) and uses it to build `downloadUrl` directly — set it once the GitHub Release exists (`gh release create vX.Y.Z dist/beacon-agent-*` first, same as always) and the script does the rest in one pass; omitting it still falls back to the old dead placeholder with a loud warning, so a dry run without a release doesn't silently look successful.

**Known gotcha — a corrupted `BEACON_SIGNING_KEY` silently invalidates every signature without any error anywhere.** Happened for real with v0.2.2: the password-manager entry holding the signing key had been overwritten with data that happened to embed the tail of an old *signature* rather than the actual 64-byte Ed25519 private key. Every step of the release process (build, sign, register, download) reported success — `tools/sign` doesn't validate that its input key's derived public half matches `pinnedPublicKey`, it just signs with whatever it's given. The only symptom was real devices silently never updating, with no error surfaced anywhere (Windows services have no console — see the `agent.log` note above). **Standing practice now: independently verify every release's signature before considering it shippable** — download the real GitHub release asset, then re-run the exact check `verifyBinary` does (SHA-256 digest → `ed25519.Verify` against `pinnedPublicKey` from `agent/internal/updater/verify.go`) in a throwaway Go program, pulling both the public key and the registered `signature_hex` programmatically (from the source file and a `wrangler d1 execute --remote` query) rather than hand-transcribing either — a manual retyping mistake in the verification script itself is indistinguishable from a real failure otherwise. If you ever need to check the key itself without pasting the private key into a session: bytes 32–63 of the 64-byte `BEACON_SIGNING_KEY` *are* the embedded public key in Go's `ed25519.PrivateKey` format, so the user can compare that slice against `pinnedPublicKey` locally and only report back match/mismatch.

Verify a release actually works end-to-end via the **unauthenticated** `GET /v1/agent/version?os=&arch=&current=` and `GET /v1/agent/download?os=&arch=` endpoints (`worker/src/routes/agent-update.ts`) — no admin secret needed, since agents themselves call these. A `curl -sIL` through `/v1/agent/download` should end in `HTTP/2 200`, not a 404, before considering a release done. This is necessary but **not sufficient** — it proves the download resolves, not that the signature is valid; do the Ed25519 re-verification above too.

**Known gotcha — `direnv` (used in this repo for `CLOUDFLARE_API_TOKEN`, see Secrets above) can silently drop manually-`export`ed env vars between shell prompts.** If `BEACON_SIGNING_KEY`/`BEACON_WORKER_URL`/`BEACON_ADMIN_SECRET` are exported in one command and the release script run in a separate command afterward, direnv's hook re-evaluating on the next prompt can reset the environment to whatever `.envrc` defines, dropping anything exported outside it — the script then fails with "Required env vars" even though `echo $VAR` just showed them set. Fix: export and run in a single chained command (`export BEACON_SIGNING_KEY=... BEACON_WORKER_URL=... BEACON_ADMIN_SECRET=... && node scripts/publish-agent.mjs ...`) so nothing can reload in between. Confirmed real during the v0.2.8 release — `node -e "console.log(process.env.X)"` printed empty despite bash's own `echo $X` printing a value moments earlier, in the same terminal.

**If you already built and uploaded a GitHub release from one machine/directory but need to sign+register from another**, don't just re-run `publish-agent.mjs` — it always rebuilds from source, and without `-trimpath` a Go binary embeds its absolute build path, so a rebuild from a different machine/directory produces **different bytes** than what's already hosted, and the freshly-computed signature won't match the already-uploaded asset. Instead, download the exact already-uploaded release assets fresh (`gh release download vX.Y.Z`) and sign+register *those* files directly — this is what happened for real during the v0.2.8 release (binaries were built in one environment, signed from the user's own machine).

**Dashboard** (`dashboard/src/`)
- Router: Vue Router with hash history (`createWebHashHistory`)
- Routes defined in `main.ts`
- All API calls via `dashboard/src/api.ts`; base URL from `VITE_API_URL` env var
- `VITE_API_URL` set in `dashboard/.env.production` — must not be undefined in prod or all requests hit Pages origin
- Sidebar is resizable (drag handle, stored in `localStorage` as `beacon-sidebar-w`) and collapsible (floating chevron button at the sidebar's edge, stored as `beacon-sidebar-collapsed` — see STYLE.md, this used to be a topbar hamburger button)

## Database

Migrations live in `migrations/` (not inside `worker/`). Drizzle points there via `wrangler.toml`. When adding a schema change:
1. Add a new migration file `migrations/XXXX_description.sql`
2. Run `make db-generate` to regenerate Drizzle types
3. Run `make migrate-local` to test locally
4. Run `make migrate-remote` after deploying the worker

Latest migration: `0023_device_external_ip.sql` (single-column add, `devices.external_ip` — see Device detail page below). `0022_component_sites_multi.sql` adds the `component_sites` many-to-many join table (see "Components / Job System" above for why this replaced `0021`'s single-`company_id` design within the same session). `0020_component_variables_store_postconditions.sql` adds `component_variables`, `components.origin`/`post_conditions`, `commands.warning`, plus the ComStore seed rows. `0019_device_warranty.sql` adds `devices.warranty_expires_at` (manually-entered, no agent collector, see Device detail page below). `0017`/`0018` are small fixes (narrowing the seeded offline policy to servers-only; a `commands.component_id` FK `ON DELETE` fix) worth knowing exist since they're easy to miss between the bigger `0016_users_auth.sql` (adds `users`, `user_sessions`, `sso_providers`, `sso_group_role_mappings`, `sso_login_state`, `sso_exchange_codes`, plus `sessions.client_auth_hash` — see Auth System below) and this one.

`worker/src/db/schema.ts` is hand-kept in sync with the migrations rather than generated — `migrations/meta/_journal.json` only tracks through migration 0003, so running `drizzle-kit generate` now would diff against a stale snapshot and produce a bogus catch-up migration. Don't run `make db-generate`; hand-edit `schema.ts` to match new migrations instead, consistent with how 0004 onward were actually done.

## Auth System

Multi-user auth replacing the old single-`ADMIN_SECRET`-only model. Local accounts + Microsoft Entra ID SSO, global RBAC (no per-tenant scoping — Beacon's users are internal MSP staff, not client-facing).

### Roles
`admin` > `technician` > `readonly` (hierarchy in `worker/src/lib/auth.ts`'s `ROLE_RANK`/`roleAtLeast`). Per-route convention: GET/list → `readonly`; routine mutations (approve device, run job, resolve alert, edit policy) → `technician`; user accounts and SSO config → `admin` only.

### `requireUser` (`worker/src/lib/auth.ts`)
Every `/v1/admin/*` and `/v1/sessions` route calls `requireUser(c.req.header('Authorization'), c.env, minRole)` instead of the old `requireAdmin`. It accepts either:
1. `Bearer <ADMIN_SECRET>` — the break-glass token, resolves to a synthetic admin identity, kept working forever (bootstrap + recovery, never surfaced in the dashboard UI), or
2. `Bearer <session token>` — hashed and looked up in `user_sessions` joined to `users`; rejected if revoked, expired, or the user is `disabled`; role checked against `minRole`.

Sessions are opaque random tokens (`generateToken()`/`sha256hex()`, the same convention as `enrollmentTokens.tokenHash`), not JWTs — chosen so logout/disable/role-change take effect on the user's very next request, with no denylist. `user_sessions.last_used_at` is only bumped when stale by more than 5 minutes, to avoid a D1 write on every authenticated request.

### Local auth routes (`worker/src/routes/auth.ts`)
`POST /v1/auth/login` (email+password, generic error either way to avoid enumeration), `POST /v1/auth/logout` (revokes the current session), `GET /v1/auth/me`.

### Microsoft Entra ID SSO (`worker/src/lib/oidc.ts`, `worker/src/routes/auth-microsoft.ts`)
Admin configures one or more Entra security groups mapped to a Beacon role via `/v1/admin/sso/providers` + nested `/group-mappings` (client secret AES-GCM-encrypted at rest using the `CONFIG_ENCRYPTION_KEY` secret — the one place a secret is encrypted rather than hashed, since it must be recovered in plaintext to call Microsoft's token endpoint).

Flow: `GET /v1/auth/microsoft/login` generates PKCE + a `state` row in `sso_login_state` (the row's own id *is* the `state` value — no cookie needed) and redirects to Microsoft requesting `openid profile email GroupMember.Read.All` scope; `GET /v1/auth/microsoft/callback` exchanges the code, verifies the ID token via `jose` (the one deliberate third-party-crypto dependency in the codebase, justified by how easy JWKS/JWT verification is to get wrong by hand), then **always** calls Microsoft Graph `GET /me/transitiveMemberOf` for group membership (not `/me/memberOf` — that only returns direct membership and silently misses nested groups, which are the norm in real Entra tenants; caught during this session's real Entra rollout) — never the ID token's `groups` claim, since Entra only embeds direct-membership claims below ~200 groups and requires a Graph call above that anyway. Zero matching group mappings rejects the login with no user created; multiple matches pick the highest-privilege role (`highestRole()`); role is re-resolved from current group membership on every login. The callback hands the SPA a one-time `sso_exchange_codes` code (not the real token) via redirect, so the session token never appears in a URL; `POST /v1/auth/microsoft/exchange` trades it for the real token.

**Entra app registration requirements** (see README/PROJECT_LOG for the full walkthrough): redirect URI `<worker-url>/v1/auth/microsoft/callback`; API permissions need **two** separate Graph permissions added, both requiring admin consent — `GroupMember.Read.All` as a **Delegated** permission (used at login time, in the scope above) and `Group.Read.All` as an **Application** permission (used by the group-search feature below, via client-credentials — a signed-in admin configuring SSO may not have a Microsoft delegated token available at all).

**Group search** (`GET /v1/admin/sso/providers/:id/groups?search=`, admin-only) — lets the SSO settings page search real Entra groups by display name instead of requiring a pasted Object ID. Uses `getAppOnlyGraphToken()` (OAuth2 client-credentials grant against the provider's own stored client_id/secret) + `searchGroups()` (Graph `/groups?$search=`, requires the `ConsistencyLevel: eventual` header). Falls back to manual Object ID entry in the UI if search fails (e.g. the Application permission isn't granted yet).

Google Workspace is explicitly deferred (v2) but `sso_providers.type` and the group-mapping tables are provider-generic — adding it later reuses the same tables and the same `oidc.ts` verification helper.

**Password hashing runtime limit**: `worker/src/lib/password.ts`'s PBKDF2 iteration count is capped at 100,000, not OWASP's higher recommended floor — Cloudflare Workers' actual edge `crypto.subtle` implementation throws `NotSupportedError` above 100,000 iterations. This did **not** reproduce in local `wrangler dev` testing, only against the real deployed worker — don't trust local dev alone for anything touching `crypto.subtle` limits.

### Dashboard side
`dashboard/src/auth.ts` is a small `reactive` current-user singleton (no Pinia, consistent with the app's existing no-state-library convention) — `loadCurrentUser()` calls `/v1/auth/me`, `hasRole(min)` gates nav items and admin-only routes. `dashboard/src/api.ts`'s `request()` clears the stored token and hard-redirects to `/login` on any 401 outside a login attempt (`skipAuthRedirect` opt-out used by the login/SSO-exchange calls themselves).

### Remote-session WS auth
The pre-existing shell/tunnel session WebSocket (`worker/src/routes/sessions.ts`) used to authenticate its client leg by embedding the raw `ADMIN_SECRET` in the `?auth=` query param — broken once technicians (who never hold `ADMIN_SECRET`) can open sessions too. Each session now gets its own random token at creation time, hashed into `sessions.client_auth_hash`, checked directly (not via `requireUser`, since it's a query param not a header).

## Two-Tier Policy / Monitor System

The alert/monitoring system uses a **policy → monitor** hierarchy. The old flat `alert_definitions` table is gone.

### Tables
- `policies` — named policy with scope (`global` or `company`), OS/class targeting (JSON arrays), enabled flag
- `policy_monitors` — individual check rules attached to a policy: check_type, config (JSON, shape varies by check_type), alert_priority, sustained_minutes, check_interval_minutes, auto_resolve, auto_resolve_after_minutes
- `alert_state` — per (device, policy_monitor) pair: condition_first_seen, is_alerting, alerted_at, resolved_at

`check_type` is a bare `TEXT` column with no SQL `CHECK` constraint — adding a new check type is a TS-enum-only change (`schema.ts`, `routes/admin/policies.ts` `VALID_CHECK_TYPES`, `dashboard/src/api.ts`) with **no migration required**.

### Check types

Ten check types across four evaluation shapes:

**A. Sampled every check-in (60s), evaluated directly against `Metrics`:**

| Type | Config | Notes |
|---|---|---|
| `disk_space` | `{drive, threshold_type, threshold_value, min_disk_gb}` | `drive: "any"` or a specific device/label match; `threshold_type: gb_free\|gb_used\|percent_used` |
| `cpu_usage` | `{percent_max}` | `>=` comparison ("has reached") |
| `memory_usage` | `{percent_max}` | `>=` comparison |
| `av_status` | `{av_state}` | key `av_status:${av_state}` allows 3 sub-monitors (not_detected/not_running/running_not_up_to_date) per policy |

**B. Cron-evaluated (every 2 min), not tied to check-in:**

| Type | Config | Notes |
|---|---|---|
| `offline` | `{direction: 'offline'\|'online', offline_after_seconds}` | `direction: 'offline'` (default) = alert when silent past threshold; `direction: 'online'` = alert once device has been checking in continuously for `sustained_minutes` (presence grace: 5 min) |

**C. Agent-measured — "assign → measure → report" pattern** (see below): worker tells the agent what to check in the check-in *response*, agent measures async, reports back on the *next* check-in via a `pending_*_results` field:

| Type | Config | Assigned via | Reported via |
|---|---|---|---|
| `file_size` | `{path, mode: below\|over, threshold_mb}` | `file_size_checks` | `pending_file_size_results` |
| `ping` | `{target, packet_count, check_unreachable, packet_loss_pct, latency_ms}` — bundles all 3 Datto conditions into one monitor/one alert | `ping_checks` | `pending_ping_results` |
| `process` | `{process_name, mode: running\|stopped\|cpu\|memory, threshold_pct}` | `process_checks` | `pending_process_results` |
| `service` | `{service_name, mode, threshold_pct, boot_delay_minutes}` — Windows only; `boot_delay_minutes` gates *assignment* (not evaluation) using `metrics.uptime_seconds`, so services still starting after boot don't false-alert | `service_checks` | `pending_service_results` |

**D. Audit-evaluated (not check-in) — event-driven, not state-driven:**

| Type | Config | Notes |
|---|---|---|
| `software` | `{name_pattern, mode: installed\|uninstalled\|version_changed}` | Evaluated from `worker/src/routes/audit.ts`'s existing `diffSoftware()` output on every `POST /v1/audit`, not check-in. `%`-wildcard name matching. **Never auto-resolves** (hardcoded `auto_resolve: false`, hidden in UI) — Datto's own spec requires manual resolution. `sustained_minutes` is always `0` (fire on first detection; see fire-immediately fix below) |

### "Assign → measure → report" pattern (agent-executed checks)

Used by `file_size`/`ping`/`process`/`service`. Mirrors the pre-existing `commands`/`pending_command_results` shape:
1. `evaluateCheckinAlerts` (in `worker/src/lib/alerts.ts`) resolves effective monitors for the device, and for these four types pushes an assignment (`{monitor_id, ...}`) into the check-in *response* instead of evaluating anything — returns a `CheckinAssignments` object (`{fileSizeChecks, pingChecks, processChecks, serviceChecks}`).
2. Agent (`agent/cmd/agent/main.go`) receives the response, dispatches one goroutine per assignment (`agent/internal/{filesize,pingutil,procutil,svcutil}`), buffers results in a `pendingMu`-guarded package var, and sends them on the *next* check-in.
3. Worker evaluates each category with its own `evaluate*Alerts` function (`evaluateFileSizeAlerts`, `evaluatePingAlerts`, `evaluateProcessAlerts`, `evaluateServiceAlerts`), all calling the shared `processAlertState`.
4. `check_interval_minutes` throttles *assignment* (not just evaluation) — a monitor is only assigned on check-ins where `Math.floor(now/60) % checkIntervalMinutes === 0`, stateless (no "last checked" storage needed).

Agent packages added this session (all follow the shell-out-to-native-tool or gopsutil convention already used by AV/BIOS collection): `diskutil` (multi-drive enumeration, shared with the audit collector), `filesize` (stat/walk), `pingutil` (shells to native `ping`, parses output), `procutil` (gopsutil `process` package), `svcutil` (Windows-only, `Get-CimInstance Win32_Service` → PID → gopsutil).

### Scope resolution
`resolveEffectiveMonitors` groups matched monitors **by check_type**, not per-monitor: if any company-scoped policy has monitors of a given check_type for the device, its monitors *entirely replace* the global ones for that type — never merged monitor-by-monitor. This is what lets multiple monitors of the same check_type coexist on one policy (av_status's 3 states, cpu_usage's critical+warning pair, multiple ping targets, etc.) without a company override accidentally leaving a stray global monitor active alongside it.

### Two bugs found and fixed this session (both in `processAlertState`, `worker/src/lib/alerts.ts`)
1. **Dedup collision**: the old scope-resolution key was `checkType` alone (`av_status` special-cased) — two monitors of the same check_type (e.g. two `cpu_usage` thresholds) silently collapsed to one. Fixed by the group-based resolution above.
2. **Fire-immediately**: the first-ever observed `failed=true` for a (device, monitor) pair only ever seeded `condition_first_seen` — it required a *second* consecutive failure to actually set `is_alerting=1`. Invisible for 60s-polled monitors (a confirming sample arrives a minute later) but fatal for one-shot/event-driven checks (`software`) where a transition is only ever observed once. Fixed: when `sustained_minutes === 0`, fire on first detection.

### Default global policies (seeded)
- **Antivirus Health** — 3 monitors: not_detected (critical/5m), not_running (high/10m), running_not_up_to_date (moderate/60m)
- **Disk Space** — 1 monitor: any drive < 10 GB free (high/5m, auto-resolves in 120m)
- **Device Offline** — 1 monitor: offline after 30 min (high, auto-resolves in 30m)
- **Memory Usage** — 1 monitor: ≥ 90% (high/10m, auto-resolves in 30m)
- **CPU Usage** — 2 monitors: ≥ 100% (critical/5m) + ≥ 95% early warning (high/15m) — per Datto's own recommended two-tier pattern
- `file_size`/`ping`/`process`/`service`/`software` have no seeded defaults — no universal target/name/path/process is sane to bake in; operators create their own.

## Components / Job System

Script/application library (`components`) + delivery mechanism (`jobs` → `commands`), extended this session toward Datto RMM's Component Library parity (deliberately not 1:1 — see "explicitly out of scope" below).

### Tables
- `components` — `type` (`script`|`application`, drives behavior: Applications currently execute identically to Scripts, no file-attachment support yet — label-only, groundwork for a later pass once object storage exists), `origin` (`custom`|`store` — ComStore provenance), `scope` (`global`|`company` — **`company` means restricted to the sites listed in `component_sites` below, a real many-to-many list, not a single company**; `company_id` is a vestigial, unused column left over from a superseded single-company design, see below), `category` (freeform organizational tag, shown in the UI as "Group" — deliberately renamed so it isn't confused with `type`), `shell`/`script`/`timeout_seconds`, `post_conditions` (JSON array, see below).
- `component_variables` — typed input variables per component: `name` (env-var identifier, validated against `^[A-Za-z_][A-Za-z0-9_]*$`), `label`, `type` (`string`|`selection`|`boolean`|`date`), `options` (JSON `{label,value}[]`, only for `selection`), `default_value` (always a string regardless of declared type — Datto's own convention, replicated), `description`, `required`, `sort_order`.
- `component_sites` — many-to-many `(component_id, tenant_id)` membership for `scope='company'` components, `UNIQUE(component_id, tenant_id)`, `ON DELETE CASCADE` both directions. Added in migration `0022` to replace `0021`'s single-`company_id` design once real Datto reference screenshots showed an "Add Site" flyout that adds sites one at a time to a list, not a single-select combobox — worth remembering if `company_id` is ever seen non-null on a `components` row from before this fix, it's dead weight, not the real scoping mechanism.
- `jobs`/`commands` — shape unchanged from the original design (see Key backend routes below) — `jobs.component_ids` is a JSON array of `ComponentRef` (`{type:'library', component_id, order, variable_values?}` or `{type:'inline', shell, script, timeout_seconds, order}`); `commands.payload` for a `run_script` command now also carries `variables: Record<string,string>` (folded in by `resolvePayload` in `jobs.ts`), and `commands.warning` (bool) is set independently of `status` when a post-condition matches.

### ComStore
`origin='store'` components are seeded once via migration `0020` (a handful of trivial examples — clear temp files, flush DNS, list installed software) and are **read-only at the API layer** — `PATCH`/`DELETE` return 403 on a store-origin row. `GET /v1/admin/components/store` lists them (must be registered before `GET /:id` in Hono's route table, or `/store` gets swallowed as an `:id` match); `POST /:id/clone` copies a component (any origin) — including its variables and sites — into a fresh `origin='custom'` row a user can edit freely. This is intentionally a stub: no real marketplace/sharing mechanism, just the schema hook + a minimal browse+clone UI.

### Input variables
Full 4 types (String/Selection/Boolean/Date), matching Datto. Prompted per-job at creation time via the shared `dashboard/src/components/ComponentVariablePrompt.vue` — used by **two independent call sites** that each build a `ComponentRef`: `CreateJobModal.vue` and `DeviceDetailPage.vue`'s Quick Job modal. Easy to miss one of these when touching this area again. All values pass through as strings regardless of declared type (Booleans become the literal strings `"true"`/`"false"`) — Datto's own convention, replicated rather than reinvented. Resolution happens server-side in `jobs.ts`'s `resolvePayload`: supplied value → the variable's `default_value` → (if `required`) a named 400 error before any commands are inserted. The agent (`agent/internal/executor/run.go`) injects the resolved map into `exec.Cmd.Env` via `append(os.Environ(), "KEY=value", ...)` — old agent binaries without the `variables` field in their struct just silently skip injection (safe degrade, no protocol version bump needed since `Command.Payload` stays `json.RawMessage`). **Not yet released to any real agent** — see Project status above.

### Post-conditions
A component's `post_conditions` (JSON array of `{id, stream: stdout|stderr|both, match_type: contains|regex, pattern, enabled}`) get evaluated in `worker/src/routes/checkin.ts`, at the exact point a command result is persisted (`worker/src/lib/postConditions.ts`'s `evaluatePostConditions`) — sets `commands.warning`, **never** touches `status`. Surfaced in `JobsPage.vue` as a distinct amber "Warning" mini-badge alongside the existing queued/sent/completed/failed ones.

### Dashboard
- `ComponentsPage.vue` — list page only (stat cards for Total/Applications/Scripts, My Library / Browse Store tabs, Group+Kind+Sites columns). No longer has a create/edit modal.
- `ComponentFormPage.vue` (`/components/new`, `/components/:id`) — full-page create/edit, mirrors `PolicyFormPage.vue`'s breadcrumb/topbar/section-group conventions. Sites use a right-side "Add Site" flyout (search + per-row Add/Remove toggle that stays open across multiple picks, plus a "Remove all" bulk action) — see STYLE.md for the exact markup/CSS.
- New components: variables and sites are held locally and batch-POSTed after the parent component is created (same pattern `PolicyFormPage.vue` already uses for monitors). Existing components: every variable/site add/edit/delete hits the API immediately.

### Explicitly out of scope this pass
- **Monitor** as a component category — Beacon's Policy/Monitor system already owns "run something and alert on it"; a future `component` policy check_type reusing this script library (floated in earlier sessions) is separate, later work.
- File attachments for Applications (no object storage/R2 configured yet — Applications behave identically to Scripts today, just a real, queryable category value).
- Component access **Levels** (Datto's Basic→Super 5-tier visibility) — redundant with Beacon's existing 3-role RBAC.
- Real recurring job scheduling / execution-context selection (LocalSystem vs. logged-in user) — `jobs.scheduled_at`/`expires_at`/`run_as_system` all exist in schema and are still dead code, unrelated to this pass. Datto's Quick Job (single component, always LocalSystem) vs. (Scheduled) Job (multi-component, configurable execution context, real recurrence) distinction maps reasonably onto `DeviceDetailPage.vue`'s Quick Job modal vs. `CreateJobModal.vue`, but Beacon's own `jobs.type` enum (`quick`|`scheduled`) actually encodes dispatch timing, not this distinction.

## Remote Shell / session system

The `sessions`/`SessionRelay` machinery predates this session (built as a generic shell/TCP-tunnel WS relay) but was never actually exercised end to end until the Interactive Remote Shell shipped — `POST /v1/sessions` had never been called by anything real before, which is exactly what let two real bugs (below) go unnoticed until now.

### Architecture
- `worker/src/durable-objects/session-relay.ts`'s `SessionRelay` DO is a **fully generic, byte-agnostic bidirectional relay** — forwards whatever bytes arrive from one tagged WebSocket role (`agent`/`client`) to the other, one DO instance per session (`idFromName(sessionId)`). It doesn't know or care about shell-vs-tunnel protocol semantics; that all lives in the agent/dashboard endpoints. This means a future tool (File Manager, etc.) can reuse this exact DO unmodified, just with a new `session_type`.
- `worker/src/routes/sessions.ts`: `POST /v1/sessions` (technician role) validates the device, generates a session ID + per-session random client auth token (see Auth System's "Remote-session WS auth"), inserts a `sessions` row, and queues an `open_session` command via the **existing command-queue channel** — the agent picks this up on its next normal check-in (up to 60s later), not a dedicated push mechanism. `GET /v1/sessions/:id/ws` upgrades and proxies straight to the DO.
- `sessions.sessionType` is a real SQL enum (`'shell' | 'tcp_tunnel'`), unlike the free-text `policy_monitors.check_type` pattern — adding a new session type needs a migration.
- `sessions.status` (`pending`/`active`/`closed`) exists in the schema but is **dead code** — inserted as `pending` and never transitioned anywhere. Not needed for the shell to work; left alone rather than wired up, since a real session-history/audit-log feature would be the natural reason to finally use it.

### Agent-side protocol (`shell.go`, rewritten this session)
One persistent PTY-backed shell process spawned per session (not one-shot-per-message, which is what shipped before this session and had zero real interactivity). Binary WS frames carry raw PTY bytes in both directions (keystrokes in; combined stdout+stderr out, since a PTY interleaves them naturally). Text WS frames carry a small JSON control envelope — currently just `{type:'resize',cols,rows}`. This binary-for-data/text-for-control split is deliberate and leaves room for future control messages without needing a new session type. Default shell: Unix picks `$SHELL` → `/bin/bash` → `/bin/sh`; Windows uses `powershell.exe` (matches the existing Quick Job "shell: auto" convention already documented elsewhere).

### Dashboard (`RemoteShellModal.vue`)
xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) — first terminal-emulator dependency in this codebase. Opens a native `WebSocket`, shows a "Connecting… up to 60 seconds" state until the *first* message of any kind arrives from the agent side (there's no earlier signal without extra relay-side plumbing, since the agent doesn't attach until its next check-in). `term.onData` keystrokes are sent as binary frames; incoming binary frames are written via `term.write(new Uint8Array(...))` (not a manual UTF-8 decode, which risks corrupting multi-byte sequences split across chunks). A `ResizeObserver` on the terminal container drives both `FitAddon.fit()` and a resize control frame. Modal shell duplicates `.modal-backdrop`/`.modal`/`.modal-header`/`.btn-icon` CSS locally (matching this codebase's established per-component duplication convention — see STYLE.md) rather than sharing with `DeviceDetailPage.vue`'s differently-named `.modal-head`/`.modal-foot` variant.

### Two real bugs found and fixed while wiring this up (first time `/v1/sessions` was ever called from a browser)
1. **Missing CORS** — `/v1/sessions*` wasn't in `index.ts`'s CORS middleware list at all (only `/v1/admin/*` and `/v1/auth/*` were).
2. **Origin misdirection** — `sessions.ts` built the agent/client WS URLs from `new URL(c.req.url).origin`, which reflected the *production* domain even under local `wrangler dev` (caused by the `[[routes]]` custom-domain block in `wrangler.toml`) — a local test agent actually dialed out and connected to the real production worker during testing before this was caught. Fixed with a configured `WORKER_URL` env var (see Self-hosting config above) instead of deriving from the request.

### Explicitly out of scope (deliberate, not an oversight)
File Manager, Task Manager, Service Manager, Registry Editor, Event Viewer, Screenshot, remote takeover, shutdown/restart, network device deploy/wake, in-session Quick Jobs, session history/audit UI — all future work, all able to reuse this same relay/auth/dial-out plumbing. Multiple simultaneous shell sessions per device already "just works" (each gets its own DO instance) — a nice side effect, not a separate feature.

## Key backend routes

```
POST /v1/enroll                              Agent enrollment
POST /v1/check-in                            Agent heartbeat + command exchange
POST /v1/audit                               Agent inventory audit snapshot

GET  /v1/admin/summary                       Device counts by status/OS/class
GET  /v1/admin/tenants                       List companies
GET  /v1/admin/devices                       List devices (filterable)
PATCH  /v1/admin/devices/:id                 Edit manually-entered device metadata (currently: warranty_expires_at only)
POST /v1/admin/devices/:id/commands          Queue a command (run_script, reboot, run_audit)
GET  /v1/admin/alerts?status=active|all      Global alert state feed
POST /v1/admin/alerts/:id/resolve            Manually resolve an alert

GET  /v1/admin/policies?scope=&company_id=   List policies (with monitors embedded)
POST /v1/admin/policies                      Create policy (supports clone_from=)
PATCH  /v1/admin/policies/:id                Update policy fields + enabled
DELETE /v1/admin/policies/:id                Delete policy (cascades monitors)

GET  /v1/admin/policies/:id/monitors         List monitors for a policy
POST /v1/admin/policies/:id/monitors         Add monitor
PATCH  /v1/admin/policies/:id/monitors/:mid  Update monitor
DELETE /v1/admin/policies/:id/monitors/:mid  Delete monitor

GET  /v1/admin/jobs                          List jobs (with aggregate device stats, LIMIT 200)
GET  /v1/admin/jobs/:id                      Job detail with per-device command breakdown
POST /v1/admin/jobs                          Create job + dispatch commands (technician)
DELETE /v1/admin/jobs/:id                    Retire job: cancel queued cmds, keep history (technician)
DELETE /v1/admin/jobs/:id/purge              Hard-delete job + all commands (admin only)

GET  /v1/admin/components?company_id=        Script/application component library (filter: global + sites matching that company)
GET  /v1/admin/components/store              Browse ComStore (seeded built-ins, read-only — must be registered before GET /:id)
POST /v1/admin/components/:id/clone          Clone a component (any origin) into a new origin='custom' one (copies variables + sites)
GET/POST  /v1/admin/components/:id/variables[/:vid]     Input variable CRUD (nested, independent lifecycle)
PATCH/DELETE /v1/admin/components/:id/variables/:vid
GET/POST  /v1/admin/components/:id/sites                Sites (multi-site scope) CRUD
DELETE /v1/admin/components/:id/sites/:tenantId

POST /v1/auth/login                          Local email/password login
POST /v1/auth/logout                         Revoke current session
GET  /v1/auth/me                             Current user identity
GET  /v1/auth/microsoft/login                Redirect to Entra authorize endpoint
GET  /v1/auth/microsoft/callback              OAuth callback (code exchange, group resolution)
POST /v1/auth/microsoft/exchange             Trade one-time code for a session token

GET  /v1/admin/users                         List users
POST /v1/admin/users                         Create local user
PATCH  /v1/admin/users/:id                   Update role/name/status
POST /v1/admin/users/:id/reset-password      Admin-driven password reset (local accounts only)
DELETE /v1/admin/users/:id                   Soft-disable

GET  /v1/admin/sso/providers                 List SSO providers (secret never returned)
POST /v1/admin/sso/providers                 Configure a provider
PATCH  /v1/admin/sso/providers/:id           Update config / rotate secret
DELETE /v1/admin/sso/providers/:id           Remove provider
GET/POST/DELETE /v1/admin/sso/providers/:id/group-mappings[/:mid]   Group → role mapping CRUD
GET  /v1/admin/sso/providers/:id/groups?search=      Live Entra group search (app-only Graph token)

POST /v1/sessions                            Open a remote session (shell or tcp_tunnel), queues open_session for the agent (technician)
GET  /v1/sessions/:id/ws?role=agent|client   WebSocket upgrade, proxied to the SessionRelay Durable Object
```

## Dashboard routes

```
/                      OverviewPage
/login                 LoginPage
/sso-callback          SsoCallbackPage    (receives the Microsoft SSO redirect)
/devices               DevicesPage (filterable by ?company=<id>) — list only, row click navigates to detail page
/devices/:id           DeviceDetailPage   (?section= for deep-linking to a section, see below)
/devices/:id/change-log DeviceChangeLogPage (category tabs, date-range filter, pagination — see Device detail page below)
/tenants               TenantsPage
/jobs                  JobsPage
/components            ComponentsPage     (list only — stat cards, My Library / Browse Store tabs)
/components/new        ComponentFormPage
/components/:id        ComponentFormPage
/global/alerts         GlobalAlertsPage
/global/policies       GlobalPoliciesPage  (list — table with expand rows)
/global/policies/new   PolicyFormPage      (create — full page form)
/global/policies/:id   PolicyFormPage      (edit — full page form)
/settings/users        UsersPage           (admin only)
/settings/users/new    UserFormPage        (admin only)
/settings/users/:id    UserFormPage        (admin only)
/settings/sso          SsoSettingsPage     (admin only)
```
Admin-only routes carry `meta: { minRole: 'admin' }`; the router guard redirects non-admins to `/`.

## Sidebar structure (App.vue)

- **Overview** link
- **Companies** section: "All Companies" link + active-client block (appears when a company is selected via `?company=` query, persists until cleared)
- **Devices** link
- **Global** section: Alerts, Policies
- **Automation** section: Jobs, Components
- **Settings** section (admin role only, `v-if="hasRole('admin')"`): Users, Single Sign-On
- Sidebar footer shows the signed-in user's name/role above the Sign out button
- Resizable via drag handle (`.sidebar-resizer`); collapsible via a floating chevron button straddling the sidebar's right edge (`.sidebar-toggle-btn`, absolutely positioned relative to `.shell`) — not a topbar hamburger, see STYLE.md

Active client state: `activeClientId` ref set by watching `route.query.company`. Cleared with the × button on the client block.

## Device detail page (`dashboard/src/pages/DeviceDetailPage.vue`)

**One continuous scrollable page, not tabs.** Explicitly corrected after an initial tabs-based (`v-if`/`v-else-if`) implementation — user feedback: "it is still supposed to be one page. The links just make it quicker to navigate." Nav order: **Summary → System → Alerts → Policies → Software → Services → Memory → Storage → Network → Security**. All render simultaneously as `<section :id="'ddev-sec-' + name" class="ddev-page-section">` blocks in that same DOM order; the left-nav only scrolls to and highlights a section, it never hides content. See STYLE.md for the section-separation/scroll-spy CSS+JS pattern in full.

**Change Log is no longer part of this nav** — originally matched Datto's device page nav exactly (ending in Change Log), but was un-inlined into its own dedicated page (`DeviceChangeLogPage.vue`, `/devices/:id/change-log`) once the inline section's lack of pagination/filtering became a real scaling problem (`device_audit_changes` grows unbounded, one row per detected change per audit). Reached via a "Change Log" button in the System section, matching Datto's own placement there. The `sections` array driving scroll-spy needed no other change — `setupScrollSpy`'s bottom-of-scroll special case already referenced `sections[sections.length - 1]` generically, so Security automatically became the new trailing section.

This nav shape went through two real corrections, not just the tabs→one-page one — worth knowing the history since it explains *why* the boundaries land where they do:
1. **System started as an "at-a-glance" section that also included some hardware facts** (introduced after Summary already existed) — this created real, reported duplication ("stuff is getting scattered and duplicated") once OS/Serial/BIOS/CPU/RAM ended up rendering in Summary *and* System *and* the old standalone Hardware section simultaneously. Every fact now lives in exactly one section.
2. **An intermediate fix merged the standalone Hardware section into System entirely** (removing the Hardware nav item). That merge was itself the wrong direction — Datto's actual nav keeps Memory, Storage, and Network as their **own** separate items, not folded into System. Final state: **System is chassis/OS identity only** — no RAM, no disks, no network adapters.

Data for every section is fetched eagerly once per device load (`onIdChange`'s `Promise.all([...])`), not lazily per-section-activation — there's no "activation" moment to hang a lazy fetch off now that nothing is hidden.

**Identity header**: hostname is large (22px/700), with the online/offline status dot inline before it (not on a separate meta line below), and an OS icon (currently Windows-only — a simple 2×2 square grid, not a licensed logo asset) on the header's right edge. No "approved"/OS-text meta line — that reads as clutter once the dot is inline.

**Summary section fields** — three columns (System / Identifiers / Activity), deliberately trimmed to *not* duplicate System (below):
- Populated: Company, Class, Enrolled / Device ID, Agent Version, Antivirus **status** (real check-in `av_status`, badge-styled — `.inv-badge-{ok,warn,danger,muted}`) / Last seen, Last Reboot (**derived**, `lastSeen - uptime_seconds` — no dedicated boot-time field exists), Last Audit (`auditData.createdAt`), Uptime.
- Deliberately excluded, not faked: M365 User, PSA Device ID, Network Node, SNMP Credential, Assigned Network Node, Patch Status, Software Status — none of these have any real data behind them in Beacon (no PSA/M365/SNMP integration, no patch-management feature). Don't add placeholder/fabricated values for these if asked to match a reference more closely — surface the gap instead.
- OS, Windows Version/Build, Last User, and Serial Number **used to live here too** — moved to System exclusively once the duplication above was flagged. "Approved" date was dropped per feedback (not useful at a glance); "Hostname" row was dropped (redundant with the now-large header hostname).

**System section** — a "Change Log" button sits right below the section heading, above the two-column field grid (matches Datto's own placement exactly) — navigates to `DeviceChangeLogPage.vue`, see above.

**System section fields** — two columns, no grid duplication with Summary or Memory/Storage/Network:
- Left ("System"): OS, Version (build), Display Ver. / Install Type (Windows-only, `windows_display_version`/`windows_installation_type` — no cross-platform equivalent), Architecture (`64-bit`/`32-bit`, derived from `runtime.GOARCH`), Domain (Windows-only, only shown when actually domain-joined — `Win32_ComputerSystem.Domain` returns the *workgroup* name otherwise), Last User, **AV Product** (not "Antivirus" — deliberately relabeled so it doesn't read as a duplicate of Summary's antivirus *status* badge; this is the product name instead, e.g. "Windows Defender Antivirus"), Firewall, **Warranty** (the one editable field on the whole page — see STYLE.md's inline-editable-date pattern), Services (count, links to the Services section).
- Right ("Hardware"): Manufacturer, Model, Motherboard, Serial (from BIOS), Processor, Total Physical Cores, BIOS (vendor + version), BIOS Released, Display Adapters. **No RAM, no disks, no network adapters here** — those are Memory/Storage/Network's job.
- `.NET Version`, real vendor-API warranty lookups, and a historical-metrics-over-time section (all present in the Datto reference) were evaluated and explicitly declined/deferred — see STYLE.md's device detail page entry for the reasoning on each.

**Memory / Storage / Network sections** — each a single-topic `.inv-tab-body` > `.inv-section`, no two-column grid (unlike System):
- **Memory**: Usable (`ram.total_bytes` — gopsutil's OS-visible figure) and Installed (`ram.installed_bytes` — raw physical DIMM capacity, root-only on Linux via `dmidecode`) as two rows.
- **Storage**: disks with usage bars, reusing the `.inv-disk-row`/`.inv-disk-bar-wrap` markup that used to live in the old standalone Hardware section.
- **Network**: External IP (unconditional, sourced from `device.externalIp` — set by `checkin.ts` from the check-in request's own `CF-Connecting-IP` header, migration `0023`, no agent change needed) shown above the audit-sourced adapter name/MAC/IPs list.

**Policies section** — simplified from a full per-monitor Type/Condition/Priority/Sustained breakout down to a plain Policy/Scope/Monitor-count table, click-through to the policy edit page ("it literally just needs to show all the policies applied on this machine not every policy with their monitors"). Whether Datto's separate "Monitors" nav item is this same concept under a different name, or something distinct, is an open question tabled for a future session.

## Coding patterns — Dashboard

### Reactive expand/select state
Use `reactive<Record<string, boolean>>` NOT `ref<Set>`. Vue 3 doesn't reliably track Set mutations:
```typescript
const expanded = reactive<Record<string, boolean>>({});
function toggleExpand(id: string) {
  if (expanded[id]) delete expanded[id];
  else expanded[id] = true;
}
```

### API calls in parallel
```typescript
const [devices, tenants] = await Promise.all([api.devices.list(), api.tenants.list()]);
```

### Scroll-spy nav (one-page-with-anchor-nav, e.g. DeviceDetailPage)
`IntersectionObserver` with a thin top-of-viewport detection band, rooted at `.page` (the app's real scroll container, not `window` — see STYLE.md):
```typescript
scrollSpy = new IntersectionObserver((entries) => {
  const visible = entries.filter(e => e.isIntersecting);
  if (visible.length === 0) return;
  const topMost = visible.reduce((a, b) => a.boundingClientRect.top <= b.boundingClientRect.top ? a : b);
  activeSection.value = topMost.target.id.replace('ddev-sec-', '');
}, { root, rootMargin: '-16px 0px -70% 0px', threshold: 0 });
```
Deliberately doesn't touch the URL/`route.query` on scroll — only an explicit nav-item click does that (via `router.replace`), so casual scrolling doesn't spam browser history.

**Bottom-of-scroll edge case** (found via real Playwright scroll testing, not obvious from reading the code): a short trailing section (e.g. "Change Log") can lose the "topmost visible" tie-break to a taller preceding section even once you've scrolled all the way down, because both still overlap the detection band simultaneously. Same edge case Bootstrap's own scrollspy special-cases. Fix: check `root.scrollTop + root.clientHeight >= root.scrollHeight - 2` and force the *last* section active when true — both inside the IntersectionObserver callback (covers most real scrolling) **and** in a separate `scroll` listener deferred one macrotask via `setTimeout(fn, 0)` (covers the remaining case where the final scroll increment doesn't change any element's `isIntersecting` state at all, so the IO callback never fires for it). The `.page` element is the app-wide persistent scroll container (outlives any one page component across navigations) — remove the `scroll` listener explicitly in `onUnmounted`, don't rely on the component unmounting to clean it up.

### Policy list includes monitors
`GET /v1/admin/policies` returns `Policy[]` where each policy has a `.monitors` array already embedded. No second round-trip needed.

### New policy flow (PolicyFormPage)
1. Monitors accumulate in local `ref<LocalMonitor[]>` — no API calls until Save
2. On Save: POST policy → loop POST each monitor → navigate back
3. For edit: monitor add/edit/delete hit API immediately; policy field save is deferred to Save Changes button

### Adding a new check_type to the Add Monitor drawer (PolicyFormPage)
Established over 6 check types added this session — each one touches the same ~9 spots, always in this order:
1. `checkTypeOptions` entry (icon + label)
2. `LocalMonitor` interface — new fields prefixed by check type (e.g. `pingTarget`, `pingCount`)
3. `monPanel.form` defaults, `openAddMonitor()` reset, `openEditMonitor()` populate
4. `buildConfig()` — maps form fields → the JSON `config` blob
5. `onMounted`'s config-parse block — maps `config` blob back → form fields (mirror of #4)
6. A `xSummary(m)` helper + its case in `monitorSummaryLocal()`'s switch
7. Matching `checkLabel`/`monitorSummary` cases in `GlobalPoliciesPage.vue` (same summary logic, duplicated by design — not shared, matches this file's existing duplication convention)
8. A new `.chip-{type}` CSS color in both `PolicyFormPage.vue` and `GlobalPoliciesPage.vue` — check existing chips before picking a color, the palette is now 10 colors deep (see STYLE.md)
9. New UI block (`v-if="monPanel.form.checkType === 'x'"`) inserted before the shared `mf-pair` (period/interval/priority)

**Type-specific side effects on switching type**: the type-card click handler is `selectCheckType(ct)`, not an inline `@click` assignment — use it to force config field values that don't make sense for a given type (e.g. `software` forces `sustainedMinutes = 0` and `autoResolve = false` when selected, since that type doesn't support either).

**Optional numeric fields use a checkbox that toggles `null`, not a separate boolean flag**: e.g. ping's packet-loss/latency conditions —
```html
<input type="checkbox" :checked="form.x !== null" @change="form.x = ($event.target as HTMLInputElement).checked ? DEFAULT : null" />
<div v-if="form.x !== null"><input v-model.number="form.x" .../></div>
```
`null` in the saved config means "this condition is disabled," not zero.

**Hiding shared fields that don't apply to a type**: wrap the irrelevant fields in `<template v-if="...">` inside `mf-pair` rather than hiding the whole block, since e.g. `software` hides period+interval but still needs the priority selector alongside them in the same flex row.

## Commit rules

- No `Co-Authored-By` or Claude attribution lines in commits
- Do not add AI-generated co-author footers

## License

AGPL-3.0 (see `LICENSE` — added via GitHub's license template picker, not generated inline, since generating the full license text in-session reliably trips the content filter).
