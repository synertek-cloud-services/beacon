# Self-hosting Beacon

This guide installs an independent Beacon instance on Cloudflare. It covers the
Worker API, D1 database, Durable Object session relay, private R2 logo and application-file storage,
Pages dashboard, initial administrator, and first endpoint enrollment.

## Before you begin

Beacon is available as a technical beta. Before enrolling endpoints, read the
[beta platform support matrix](BETA_PLATFORM_SUPPORT.md) and
[beta diagnostics and support guide](BETA_SUPPORT.md). The current beta
baseline is published in [GitHub Releases](https://github.com/synertek-cloud-services/beacon/releases).

Do not place it on unmanaged production fleets until you have accepted the
documented beta limitations and completed your own backup, recovery, and
endpoint acceptance checks.

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
| Private R2 logo bucket | `beacon-logos` |
| Private R2 application-file bucket | `beacon-component-files` |
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
npx wrangler r2 bucket create beacon-component-files
```

The D1 command prints a database UUID. Copy `wrangler.toml.example` to
`wrangler.toml`, then replace:

- `account_id`
- D1 `database_name` and `database_id`
- both R2 `bucket_name` values
- `ALLOWED_ORIGIN` with the final dashboard origin
- `WORKER_URL` with the final API origin
- `PAGES_PREVIEW_SUFFIX` with `.<pages-project>.pages.dev`
- the example custom-domain route

If using `workers.dev`, remove the `[[routes]]` block. After Cloudflare assigns
the Worker origin, put that exact HTTPS origin in `WORKER_URL` and redeploy.

Both R2 buckets remain private. Beacon serves branding logos and grants
application-file downloads through authorized Worker routes; neither requires
an R2 public domain.

## 4. Prepare required secrets

Generate and store two independent values:

- `ADMIN_SECRET`: a high-entropy break-glass credential used only to bootstrap
  and recover administrator access. A 32-byte random value encoded as 64
  hexadecimal characters is easy to store safely in the dotenv deployment file.
- `CONFIG_ENCRYPTION_KEY`: exactly 32 random bytes encoded as 64 hexadecimal
  characters. It encrypts SSO client secrets, email-provider configuration,
  and company secrets that Beacon must later decrypt.

Losing `CONFIG_ENCRYPTION_KEY` makes those stored values unreadable. Replacing
it is not a password reset. Preserve both values according to the
[backup and recovery runbook](BACKUP_RECOVERY.md).

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
npx wrangler pages deploy --cwd .. dashboard/dist --project-name beacon-dashboard --branch main
```

`--cwd ..` runs the Pages upload from the repository root. Without it,
Wrangler finds the Worker's `wrangler.toml`, warns that it lacks the
Pages-only `pages_build_output_dir` setting, and then ignores that file. The
upload still works, but avoiding the unrelated Worker configuration makes the
procedure and its output unambiguous.

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

## 9. Install an initial validation agent

Build development binaries from the checked-out source:

```bash
make build-agent-windows
make build-agent-linux
```

These Makefile targets are suitable for disposable installation validation,
not a production fleet or host-controlled release channel. For production
agents, complete section 10 first and install its published binaries instead.
Run installation from an elevated Administrator/root shell and substitute the
actual API origin and a newly-created enrollment token.

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

Plain `make build-agent-*` builds trust Beacon's upstream release key. For a
new self-hosted installation, publish the host-controlled channel in the next
section and install those binaries instead. An agent cannot switch from one
signing key to another through a release signed only by the new key.

## 10. Publish the host-controlled agent channel

Do this before installing production agents. You need an authenticated GitHub
CLI with release-write access to a **public** Beacon fork or repository. Agent
downloads are intentionally unauthenticated, so private GitHub release assets
cannot serve as the update channel.

Generate the signing key once, writing it outside the repository to an existing
secure directory:

```bash
cd agent
go run ./tools/keygen --out /secure/path/beacon-agent-signing.key
cd ..
```

The command refuses to overwrite an existing file. On Linux and macOS it
creates the file with mode `0600`, which the release script enforces. On
Windows, restrict the file's ACL to the release operator before use. The
command prints the non-secret public key, never the private key. Place the
private-key file and its encrypted backup in the same operational class as
`CONFIG_ENCRYPTION_KEY`; do not commit it, paste it into an issue, or allow it
into command output.

Prepare the release process environment through your shell or secret manager:

```bash
export BEACON_SIGNING_KEY_FILE=/secure/path/beacon-agent-signing.key
export BEACON_WORKER_URL=https://beacon-api.example.com
export BEACON_RELEASE_REPOSITORY=YOUR_GITHUB_OWNER/YOUR_PUBLIC_BEACON_REPOSITORY
export BEACON_ADMIN_SECRET
node scripts/publish-agent.mjs 0.3.0
unset BEACON_ADMIN_SECRET
```

Set `BEACON_ADMIN_SECRET` without putting its value in the command or shell
history. `BEACON_RELEASE_REPOSITORY` is optional when `gh repo view` correctly
detects the intended fork from the checkout. Setting it explicitly is safer on
a checkout with several remotes. A semantic prerelease version such as
`0.3.0-beta.1` is created as a GitHub prerelease.

For every supported platform, the script:

1. Derives the public half of the host-controlled Ed25519 key and embeds it in
   the agent at build time.
2. Builds the five platform binaries and publishes them to the selected GitHub
   release.
3. Refuses to sign if the private key does not match the public key supplied to
   the build.
4. Downloads the public release asset, requires an exact SHA-256 match, and
   verifies its Ed25519 signature before registering it.
5. Registers the verified metadata with the Worker and confirms the public
   version and download routes return that release and those exact bytes.

Published version assets are immutable. Re-running the same version may verify
byte-identical assets and skip identical current catalog entries, but the
script will not overwrite a different or incomplete existing release. It also
rejects a downgrade below the Worker's current platform version. Correct the
problem and publish a new semantic version instead.

The older `BEACON_SIGNING_KEY` environment variable remains supported for
existing automation, but the restricted key file avoids repeatedly copying
private material between a password manager and a shell.

### Signing-key continuity

Every deployed agent permanently trusts the public key embedded when it was
built. Losing the corresponding private key means those agents cannot accept
another automatic update. Replacing or rotating it requires a planned
transition release signed by the currently trusted key; generating a new key
alone does not recover the channel. There is no automatic signing-key rotation
in the beta workflow.

Back up the signing key before fleet deployment and test restoration of that
backup according to the [backup and recovery runbook](BACKUP_RECOVERY.md).
Never run an initial fleet from plain upstream-key builds if the fleet is meant
to follow the host-controlled channel.

## 11. Installation checks

Before enrolling more endpoints, verify:

- `GET /health` succeeds on the Worker origin.
- The dashboard loads from its final origin without CORS errors.
- Emergency access works and a normal admin account can sign in.
- The default dashboard is present.
- A company and enrollment token can be created.
- A device can enroll, be approved, check in, and submit an audit.
- Each supported platform has a registered host-controlled agent release, and
  the release script completed its hosted-byte and Worker-route verification.
- Worker cron triggers are configured for `*/2 * * * *`.
- Remote Shell uses the configured Worker origin rather than another instance.
- No secret or organization-specific configuration file is tracked by Git.

Before enrolling production endpoints, complete and test the
[backup and recovery runbook](BACKUP_RECOVERY.md). It covers D1/R2 restoration,
secret and signing-key continuity, stale-command quarantine, Worker/Pages
rollback boundaries, and failed agent updates.

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
