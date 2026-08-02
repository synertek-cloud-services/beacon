# Self-hosting Beacon

This guide installs an independent Beacon instance on Cloudflare. It covers the
Worker API, D1 database, Durable Object session relay, private R2 logo storage,
Pages dashboard, initial administrator, and first endpoint enrollment.

## Before you begin

Beacon currently targets a technical beta. Read the open
[`v0.9.0 Beta` milestone](https://github.com/synertek-cloud-services/beacon/milestone/2)
before placing it on production endpoints.

You need:

- A Cloudflare account with Workers, D1, Durable Objects, R2, and Pages enabled.
- Node.js 22, pnpm 10, Git, GNU Make, and Wrangler (installed by the Worker
  package).
- Go 1.22 or newer if you build agents locally.
- Two public origins: one for the Worker API and one for the dashboard. Custom
  domains are recommended, but `workers.dev` and `pages.dev` origins work.
- A password manager or equivalent secure store for all generated secrets.

Do not put organization-specific configuration or secrets in a public fork.
Beacon intentionally ignores `worker/wrangler.toml`, `worker/.dev.vars`,
`worker/.deploy.secrets`, and `dashboard/.env.production`.

## 1. Clone and install dependencies

```bash
git clone https://github.com/synertek-cloud-services/beacon.git
cd beacon
pnpm --dir worker install --frozen-lockfile
pnpm --dir dashboard install --frozen-lockfile
pnpm --dir worker exec wrangler login
```

Confirm Wrangler selected the intended Cloudflare account before creating any
resources.

## 2. Choose names and origins

Decide these values before editing configuration:

| Value | Example |
|---|---|
| Worker name | `beacon` |
| D1 database name | `beacon` |
| Private R2 bucket | `beacon-logos` |
| Worker/API origin | `https://beacon-api.example.com` |
| Pages project | `beacon-dashboard` |
| Dashboard origin | `https://beacon.example.com` |

`WORKER_URL` must be the Worker's own public origin. Do not derive it from a
request or set it to the dashboard origin; remote-shell WebSockets use it to
reach the session relay.

## 3. Create Cloudflare storage

From `worker/`:

```bash
npx wrangler d1 create beacon
npx wrangler r2 bucket create beacon-logos
```

The D1 command prints a database UUID. Copy `wrangler.toml.example` to
`wrangler.toml`, then replace:

- `account_id`
- D1 `database_name` and `database_id`
- R2 `bucket_name`
- `ALLOWED_ORIGIN` with the final dashboard origin
- `WORKER_URL` with the final API origin
- `PAGES_PREVIEW_SUFFIX` with `.<pages-project>.pages.dev`
- the example custom-domain route

If using `workers.dev`, remove the `[[routes]]` block. After Cloudflare assigns
the Worker origin, put that exact HTTPS origin in `WORKER_URL` and redeploy.

The R2 bucket remains private. Beacon serves stored branding logos through
authorized Worker routes; it does not require an R2 public domain.

## 4. Prepare required secrets

Generate and store two independent values:

- `ADMIN_SECRET`: a high-entropy break-glass credential used only to bootstrap
  and recover administrator access. A 32-byte random value encoded as 64
  hexadecimal characters is easy to store safely in the dotenv deployment file.
- `CONFIG_ENCRYPTION_KEY`: exactly 32 random bytes encoded as 64 hexadecimal
  characters. It encrypts SSO client secrets, email-provider configuration,
  and company secrets that Beacon must later decrypt.

Losing `CONFIG_ENCRYPTION_KEY` makes those stored values unreadable. Replacing
it is not a password reset. Preserve both values for the backup/recovery work
tracked in [issue #85](https://github.com/synertek-cloud-services/beacon/issues/85).

For the first deployment, create `worker/.deploy.secrets` in dotenv format:

```dotenv
ADMIN_SECRET=REPLACE_WITH_THE_BREAK_GLASS_SECRET
CONFIG_ENCRYPTION_KEY=REPLACE_WITH_THE_64_CHARACTER_HEX_KEY
```

Keep this file mode-restricted and outside backups that are not encrypted. It
is gitignored. Delete it after the deployment or retain it only in an approved
encrypted secret store.

## 5. Apply migrations and deploy the Worker

From the repository root:

```bash
make migrate-remote
cd worker
pnpm run type-check
npx wrangler deploy --secrets-file .deploy.secrets
```

Uploading code and secrets together prevents an initial public deployment with
missing break-glass authentication. The example Wrangler configuration declares
both secret names in comments but never their values. Verify both bindings in
Cloudflare before every later deployment; Wrangler preserves existing encrypted
secrets but this repository cannot validate their values.

Verify the public API without sending a credential:

```bash
curl --fail https://beacon-api.example.com/health
```

For later secret replacement, use `npx wrangler secret put NAME` and enter the
new value interactively. Do not place secret values directly in a command,
shell history, issue, log, or configuration file committed to Git.

## 6. Build and deploy the dashboard

Copy the dashboard environment example and set `VITE_API_URL` to the Worker
origin:

```bash
cp dashboard/.env.production.example dashboard/.env.production
pnpm --dir dashboard run build
cd worker
npx wrangler pages project create beacon-dashboard --production-branch main
npx wrangler pages deploy ../dashboard/dist --project-name beacon-dashboard --branch main
```

Use the same Pages project name represented by `PAGES_PREVIEW_SUFFIX`. Attach a
custom dashboard domain in Cloudflare if desired. If the final dashboard origin
differs from `ALLOWED_ORIGIN`, update `worker/wrangler.toml` and redeploy the
Worker before attempting to sign in.

Beacon uses hash-based client routes, so direct navigation remains within the
single deployed SPA. For automated releases, use the repository's ordered
GitHub Actions workflow and disable competing automatic production Pages
deployments; see **Maintainer release automation** in the README.

## 7. Bootstrap the first administrator

No normal user is seeded into a fresh database.

1. Open the dashboard and choose **Emergency administrator access**.
2. Enter `ADMIN_SECRET`. Beacon stores emergency access in browser session
   storage only; closing the browser clears it.
3. Open **Settings → Users** and create a local user with the `admin` role.
4. Sign out of emergency access and sign in with the new local account.
5. Store `ADMIN_SECRET` as break-glass recovery material rather than using it
   for routine administration.

Microsoft Entra ID SSO can be configured afterward. Its client secret is
encrypted with `CONFIG_ENCRYPTION_KEY`.

## 8. Create a company and enrollment token

From **Companies**:

1. Create the first company.
2. Decide whether newly enrolled devices require manual approval.
3. Create an enrollment token for that company.
4. Copy the raw token when shown; Beacon stores only its hash and cannot reveal
   it later.

The current service installer retains the enrollment token in service launch
configuration even after the device receives its own credential. Create a
single-purpose deployment token and revoke it promptly after the intended
devices enroll. Polished silent deployment and token handling are tracked in
[issue #87](https://github.com/synertek-cloud-services/beacon/issues/87).

## 9. Install an initial agent

Build development binaries from the checked-out source:

```bash
make build-agent-windows
make build-agent-linux
```

These Makefile targets are suitable for initial beta enrollment, not a signed
release channel. Run installation from an elevated Administrator/root shell and
substitute the actual API origin and a newly-created enrollment token.

Windows:

```powershell
.\dist\agent-windows-amd64.exe install --server-url https://beacon-api.example.com --enroll-token TOKEN_FROM_DASHBOARD
```

Linux:

```bash
chmod +x ./dist/agent-linux-amd64
sudo ./dist/agent-linux-amd64 install --server-url https://beacon-api.example.com --enroll-token TOKEN_FROM_DASHBOARD
```

Beacon has macOS agent code, but the project does not yet have validated macOS
installation evidence or a supported macOS beta procedure. Do not deploy it to
macOS endpoints based on this guide.

The installer copies the binary into its system location and starts the Beacon
service. Approve the pending device in the dashboard when auto-approval is off,
then confirm that Last Seen and Last Audit advance.

### Current agent-release limitation

A fresh database contains no agent release catalog. The current maintainer
release script and embedded update-verification key belong to the upstream
Beacon release channel, so an independent hoster cannot yet publish and
register host-signed updates without modifying source. [Issue #92](https://github.com/synertek-cloud-services/beacon/issues/92) is the beta
blocker for host-controlled signing, configurable release hosting, registration,
and verification.

Until #92 lands, initial binaries can be built from source or obtained from an
upstream release, but independent automatic agent updates are not a supported
self-hosting workflow. Do not describe a successful initial enrollment as
proof that the update channel is configured.

## 10. Installation checks

Before enrolling more endpoints, verify:

- `GET /health` succeeds on the Worker origin.
- The dashboard loads from its final origin without CORS errors.
- Emergency access works and a normal admin account can sign in.
- The default dashboard is present.
- A company and enrollment token can be created.
- A device can enroll, be approved, check in, and submit an audit.
- Worker cron triggers are configured for `*/2 * * * *`.
- Remote Shell uses the configured Worker origin rather than another instance.
- No secret or organization-specific configuration file is tracked by Git.

Backups, restoration, and failed-release recovery are intentionally handled by
[issue #85](https://github.com/synertek-cloud-services/beacon/issues/85) rather
than being improvised in this installation guide.

## Local development

Copy the local examples:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
cp worker/.dev.vars.example worker/.dev.vars
```

Replace the local placeholders, use a non-production `ADMIN_SECRET` and
`CONFIG_ENCRYPTION_KEY`, and keep `WORKER_URL=http://localhost:8787`. Then:

```bash
make migrate-local
make dev
```

In another terminal:

```bash
pnpm --dir dashboard dev
```

Leave `VITE_API_URL` unset locally. Vite proxies `/v1` to the Worker; setting an
absolute local API URL bypasses that proxy and can trigger CORS failures.
