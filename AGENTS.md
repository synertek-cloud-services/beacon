# Beacon — Codex Instructions

Beacon is an AGPL-3.0 self-hosted RMM monorepo:

- `agent/` — Go endpoint agent for Windows, macOS, and Linux.
- `worker/` — Cloudflare Worker (Hono, D1/Drizzle, Durable Objects).
- `dashboard/` — Vue 3/Vite administration SPA.
- `migrations/` — ordered D1 SQL migrations.
- `scripts/` — development and agent-release utilities.

## Start here

Before changing code, read the relevant sections of:

1. `STYLE.md` for UI and coding conventions.
2. `PROJECT_LOG.md` for current work, decisions, and known follow-ups.
3. `CLAUDE.md` for architecture, subsystem contracts, and detailed workflows.

`CLAUDE.md` is the detailed project reference. Do not duplicate its long status
history here; consult the sections relevant to the subsystem being changed.

Run `git status --short` before editing. Treat existing modified and untracked
files as user work unless their ownership is clear.

## Working agreement

For a feature or non-trivial fix:

1. Inspect the existing implementation and identify affected contracts.
2. Explain how it fits the architecture, files likely to change, pitfalls, and
   a scoped implementation plan.
3. Wait for user approval before editing.
4. Keep the implementation focused, incremental, and backward-compatible
   unless the user explicitly requests otherwise.

Preserve existing user changes. Do not make broad architectural rewrites,
unrelated formatting changes, or speculative features.

## Security and configuration

- Never print, commit, or place secrets in source, logs, chat, or example files.
  This includes `ADMIN_SECRET`, encryption keys, OAuth secrets, device tokens,
  and Ed25519 signing keys.
- Keep organization-specific `wrangler.toml` and dashboard environment files
  gitignored; update their `.example` templates when configuration changes.
- Treat `ADMIN_SECRET` as break-glass access. Preserve session-based RBAC and
  backend `requireUser` authorization checks; dashboard guards are not enough.
- Do not derive remote-session WebSocket origins from the incoming request.
  Use configured `WORKER_URL`.

## Backend, data, and agent invariants

- Schema changes require a new ordered SQL migration in `migrations/` and a
  matching hand update to `worker/src/db/schema.ts`.
- Do **not** run `make db-generate`: Drizzle's migration metadata is stale and
  it would create a bogus catch-up migration. For schema work, add the
  migration, hand-update `schema.ts`, run `make migrate-local`, then run the
  relevant type checks. Production releases run through `.github/workflows/release.yml`
  after a PR merges to `main`; do not manually migrate or deploy production
  unless the user explicitly requests a break-glass operational action.
- Preserve the agent pull model: enrollment obtains a device credential;
  check-ins carry metrics and prior results, then receive queued commands and
  monitoring assignments. Changes to this protocol normally affect worker
  types/routes and the Go agent together. New agent metric fields must remain
  optional so older agents can still check in.
- Preserve role boundaries: `readonly`, `technician`, and `admin`. Require the
  appropriate server-side role on every admin route. Do not add hand-rolled
  bearer-token comparisons; use `requireUser`.
- Register static Hono paths before parameterized paths that could capture them
  (for example, `/store` before `/:id`).
- For policies, components/jobs, audit, alerts, sessions, and authentication,
  follow the explicit data-model and behavior rules in `CLAUDE.md`; these are
  product contracts, not merely implementation details.
- Do not present unavailable data or capabilities as implemented. Keep known
  gaps explicitly unavailable/disabled when that is the established product
  behavior.
- ComStore components are read-only; scheduled job targets resolve at dispatch
  time; session transport is an outbound agent connection through the generic
  Durable Object relay.

### Custom Fields

- Custom-field definitions are Settings configuration: admin-only. Per-device
  values are operational data: technician-editable.
- Keep field keys in the validated uppercase identifier format. At job dispatch,
  resolve device values as `CF_<KEY>` variables inside `insertJobCommands`; the
  agent already passes command variables through to the child-process
  environment and needs no protocol change.
- Do not bypass the component-script reference guard when renaming a key. A
  rename that would break a literal `CF_<OLDKEY>` reference must remain blocked
  until the affected scripts are updated.

### Device Groups and policy performance

- Device Groups are static, global, manually curated device collections—not
  dynamic filters or saved site groups. Keep the term "Device Groups" in the
  UI to avoid colliding with a component's organizational Group field.
- Group job targeting must deduplicate overlapping membership and target only
  approved devices. Scheduled jobs still resolve those targets at dispatch.

### Policy targeting and alert performance

- A policy's Targets can mix sites, individual devices, and Device Groups.
  Target kinds are ORed together; zero targets means unrestricted. OS/class
  filters remain a separate AND condition.
- `policies.scope` is derived display/filter metadata. Match policies against
  their target tables, not `scope` or the vestigial `company_id` column.
- The Policy Targets flyout visually reuses the Job target flyout, but its
  behavior differs: policies retain mixed target kinds, while Jobs remain
  single-kind-exclusive.
- Never query site, device, or group membership inside a per-device
  alert-evaluation loop. Prefetch target maps once per check-in or cron
  invocation. Reconcile orphaned alerts after narrowing a policy's targets or
  removing device-group membership; widening does not require reconciliation.
- When manually testing policy targeting, avoid a check type used by seeded
  global policies (such as `disk_space`), because same-check-type override
  logic can obscure the result. Use `ping` or `file_size` instead.

## Dashboard conventions

- Reuse established page, form, drawer, modal, and CSS patterns from nearby
  components. Intentional local markup/CSS duplication is acceptable where it
  is already the project convention.
- Use `reactive<Record<string, boolean>>` for expandable/selectable keyed UI
  state, not a mutable `Set`.
- Fetch independent data in parallel with `Promise.all`.
- Device detail is one continuous scrollable page with anchor navigation, not
  tabs or conditional section rendering. Follow the documented scroll-spy
  behavior when modifying it.
- For nested resources, keep additions and edits local on a new parent form and
  batch-POST them after creating the parent. With an existing parent ID,
  persist nested-resource changes immediately.
- Reuse the established right-side, searchable multi-select flyout from
  `STYLE.md` for selecting several related records; it stays open across
  add/remove actions and is intentionally duplicated locally per component.
- When adding a policy check type or changing jobs/components, follow the
  complete affected-file checklist in `CLAUDE.md` rather than updating only the
  most visible UI or backend path.

## Validation and documentation

- Run the narrowest relevant checks first, then appropriate type/build checks:
  `cd worker && pnpm type-check`, `cd dashboard && pnpm build`, and relevant Go
  builds/tests for agent changes.
- For local full-stack testing, leave `VITE_API_URL` unset so Vite proxies
  `/v1` to the Worker. To exercise a local cron handler, call
  `http://localhost:8787/cdn-cgi/handler/scheduled`.
- Require end-to-end validation beyond type checking for protocol, auth, cron,
  WebSocket session, command-reporting, and agent self-update changes. If an
  environment prevents this, document the blocker and what was verified.
- Update `PROJECT_LOG.md` for user-visible shipped behavior, durable technical
  decisions, production incidents, or newly discovered follow-ups—not routine
  implementation details.
- In the handoff, state files changed, validation performed, and any remaining
  assumptions or limitations.

## Agent releases

Before releasing an agent, read the release process in `CLAUDE.md` and use the
provided scripts. Publish assets before registration, keep signing material
private, and independently verify each hosted binary against its registered
Ed25519 signature. Successful registration alone is not sufficient evidence.

## Git hygiene

- Keep commits focused and avoid generated-file changes unless required.
- Do not add `Co-Authored-By`, Claude, Codex, or other AI attribution trailers.
