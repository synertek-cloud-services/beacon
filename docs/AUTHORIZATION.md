# API authorization contract

Beacon users are members of the hosting MSP's team. Authorization is global,
not scoped to individual companies. The role hierarchy is:

`readonly` < `technician` < `admin`

All user-facing protected routes use `requireUser` on the server. Dashboard
visibility is only a convenience and must never be the enforcement boundary.
The `ADMIN_SECRET` is accepted as a synthetic admin solely for break-glass
bootstrap and recovery.

Unless a route below says otherwise, a missing, expired, revoked, disabled, or
under-privileged user session returns `401 { "error": "unauthorized" }`.
Deliberate semantic restrictions after authentication (for example, a
technician selecting a component marked `requires_admin`) may return `403`.

## Non-user credentials

| Route | Credential | Purpose |
|---|---|---|
| `GET /health` | Public | Liveness only. |
| `GET /v1/branding/active`, `/revisions/:id`, `/identity`, `/logo/:key` | Public | Login-page and pre-auth branding. |
| `POST /v1/auth/login`; Microsoft `/available`, `/login`, `/callback`, `/exchange` | Public or one-time OAuth state/code | Establish a user session. |
| `GET /v1/agent/version`, `/download` | Public | Agent bootstrap and update discovery. Signatures protect downloaded binaries. |
| `POST /v1/enroll` | Enrollment token | One-time device enrollment; returns the new device credential only in this response. |
| `POST /v1/check-in`, `/v1/audit` | Device credential | Agent telemetry, command polling/results, and inventory audit. |
| `GET /v1/sessions/:id/ws?role=client` | Per-session client capability token | Connect the browser to one relay session. |
| `GET /v1/sessions/:id/ws?role=agent` | Unguessable session ID delivered over the authenticated command channel | Connect the intended agent to one relay session. |

The client capability token, enrollment token hashes, user password/session
hashes, and device credential hashes are never returned by list/detail APIs.

## Readonly routes

`readonly` can inspect operational state but cannot change it. `technician` and
`admin` inherit these routes.

| Route family | Read operations |
|---|---|
| Auth | `GET /v1/auth/me`; `POST /v1/auth/logout` revokes only the caller's own session and is available to every signed-in user. |
| Summary and activity | `GET /v1/admin/summary`; `GET /v1/admin/activity-log`. |
| Companies | Company list; contacts; locations; enrollment-token metadata; discovery configuration/results. Company Variables/Secrets are intentionally excluded and admin-only. |
| Devices | Device list/detail, effective monitors, direct-command history, latest/full audit, audit changes, and per-device Custom Field values. Device responses omit `deviceCredentialHash` and `enrollmentTokenId`. |
| Alerts and policies | Alert list/detail; policy list; policy monitors; policy company/device/group targets. |
| Components and jobs | ComStore/library component list/detail/variables/companies; job list/detail. Secret company-variable values are resolved only while dispatching and do not appear in these responses. |
| Device Groups | Group list/detail and membership. |
| Dashboards | Dashboard list/detail and computed widget data. |
| Maintenance and patching | Maintenance Policy list/targets; patch inventory/approval state; Patch Policy list/targets. |
| Host metadata | `GET /v1/admin/settings` and `GET /v1/admin/agent/versions`. |

## Technician routes

`technician` is the operational role. It inherits readonly access and may:

- create/update companies, contacts, locations, enrollment tokens, and network
  discovery configuration/results;
- approve, revoke, update, or remove devices; manage maintenance windows;
  queue device/admin commands; and update per-device Custom Field values;
- create/update/delete policies, monitors, and their company/device/group
  targets; resolve alerts;
- create/update/delete/clone library components and their normal variables and
  company scope, except actions protected by `requires_admin`;
- create/cancel jobs, except running `requires_admin` components or permanently
  purging job history;
- create/update/delete Device Groups and membership;
- create/update/delete Maintenance Policies and Patch Policies and their
  targets, and change patch approval state;
- create remote shell/tunnel sessions through `POST /v1/sessions`.

Technicians cannot view or mutate Company Variables/Secrets and cannot register
a fleet agent release.

## Admin routes

`admin` inherits all operational access. The following are admin-only because
they control identities, host-wide configuration, secrets, shared presentation,
or fleet software supply:

- `/v1/admin/users/*` and `/v1/admin/sso/*`;
- `/v1/admin/custom-fields/*` definitions (per-device values remain technician);
- `/v1/admin/companies/:id/variables/*`, including non-secret variables;
- `/v1/admin/email-settings/*`, `/notification-emails/*`, and `/webhooks/*`;
- branding admin identity/logo/theme/revision routes under
  `/v1/branding/admin/*`;
- dashboard create/update/delete/widget mutations;
- `PATCH /v1/admin/settings`;
- `POST /v1/admin/agent/versions`;
- `DELETE /v1/admin/jobs/:id/purge`;
- setting or changing a component's `requires_admin` flag and running any
  component carrying that flag.

## Session invalidation

User session tokens are opaque database-backed capabilities, not JWTs. Every
request joins the session to the current user record, so logout/revocation,
expiry, disabling an account, and role changes take effect on the next request.
`scripts/test-authorization.mjs` exercises the representative role boundaries,
instant role/disable/logout behavior, and response redaction against an isolated
local or disposable deployment.

Run the mutating drill only against an isolated environment:

```sh
BEACON_WORKER_URL=http://127.0.0.1:8787 \
BEACON_ADMIN_SECRET='<local break-glass secret>' \
node scripts/test-authorization.mjs --allow-mutations
```

Add `--expiry-d1 beacon --wrangler-config worker/wrangler.toml
--expiry-local-persist <wrangler-persist-path>` to exercise database-backed
session expiry against that same isolated local D1. For a disposable remote D1
deployment, omit `--expiry-local-persist` and add `--allow-remote`; the database
name and Wrangler config must identify the disposable deployment. The drill
refuses remote mutation without the explicit flag. It leaves records
suspended/disabled rather than destructively deleting the test history.
