# Beta diagnostics and support

This is the practical companion to
[`docs/BETA_PLATFORM_SUPPORT.md`](BETA_PLATFORM_SUPPORT.md) (what's supported)
and [`SECURITY.md`](../SECURITY.md) (how to report a vulnerability). It's for
a beta operator who has hit something that looks wrong and needs to report it
usefully, or diagnose it themselves, possibly with the affected agent
offline.

## Reporting a problem

- **Bug** (something that doesn't work as documented): open a
  [Bug report](https://github.com/synertek-cloud-services/beacon/issues/new?template=bug.yml).
  The template asks for the affected area, deployment type, version, and
  sanitized logs — filling all of it in the first pass avoids a slow
  back-and-forth.
- **Feature request or scope question**: open a
  [Feature request](https://github.com/synertek-cloud-services/beacon/issues/new?template=feature.yml).
  Check `docs/BETA_PLATFORM_SUPPORT.md` and the Icebox items in the
  [Beacon Development project](https://github.com/orgs/synertek-cloud-services/projects/1)
  first — it may already be a deliberate v1 scope-down or a tracked
  deferral, not a gap nobody's noticed.
- **Security vulnerability, or anything you can't safely make public**: do
  **not** use a public issue. Follow [`SECURITY.md`](../SECURITY.md) — GitHub
  private vulnerability reporting, not a public issue, PR, discussion, log,
  or screenshot.

## Finding your Beacon version and deployment

Beacon doesn't have a single version number — the Worker/dashboard track
`main` at whatever commit was last released, and each agent has its own
independent version.

- **Agent version**: shown on that device's Device Detail page (System
  section, "Agent" field) and logged on every agent startup as
  `beacon agent <version> — device <device_id>` at the top of `agent.log`
  (see below).
- **Worker/dashboard version**: there is currently no in-app indicator of
  which commit is deployed — a real gap, not an oversight; note it in a
  report if it's relevant rather than guessing. Whoever operates the
  deployment can usually answer it directly: the release workflow
  (`.github/workflows/release.yml`) tags each Cloudflare Pages deployment
  with the merge commit hash (visible in the Cloudflare dashboard's Pages
  deployment history), and the Worker's own deployment history is visible
  the same way or via `wrangler deployments list`.

## Where to find logs

| Source | Location | Notes |
|---|---|---|
| Agent log | `agent.log` next to the device credential — Windows: `%PROGRAMDATA%\Beacon\agent.log`; Linux: `/etc/beacon/agent.log`; macOS: `/Library/Application Support/Beacon/agent.log` | Written from process start; also mirrors to stderr, which is invisible on Windows since the agent runs as a service with no console. If a definitely-running agent shows zero recent log activity, it may have lost the open-file race at startup — confirmed fixed as of agent v0.2.19 (a background retry now keeps trying indefinitely instead of giving up); update the agent before assuming logging itself is broken. |
| Self-update state | `update-state.json`, same directory as `agent.log` | Present only mid-update or right after one; absence is normal. |
| Windows pending-reboot marker | `C:\Program Files\Beacon\pending-reboot.json` | Only present when a patch install left `RebootRequired=true` and the tray prompt hasn't been answered yet. Deliberately a different directory than `agent.log`, not a bug. |
| Windows remote-uninstall log | `C:\Windows\Temp\beacon-uninstall.log` | Written by the uninstall helper; survives even if the removal itself fails, since it lives outside the directories being removed. |
| Job / direct-command output | Beacon dashboard: a Job's own Detail page, or a device's Command History section (direct, non-Job commands only, last 50) | Captured `Stdout`/`Stderr` per command — check this before chasing agent-log details for anything dispatched through Jobs or Quick Job. |
| Activity Log | Beacon dashboard → Global → Activity Log | Who did what and when (job/policy/component/user changes, logins) — useful for correlating a report against real actions, not a diagnostic log itself. |
| Worker logs | `wrangler tail` (run by whoever has deploy access) against the production Worker, or the Cloudflare dashboard's live Logs view | Real-time only by default — nothing is persisted unless the hoster has separately configured Cloudflare Workers Logs or Logpush. Capture at the time the problem happens, or reproduce it live while tailing. |
| Dashboard (browser) | Browser DevTools → Console and Network tabs | The only source for a dashboard-side JS error or a failed API call's exact response body. |

## Collecting logs safely

Before attaching anything to a public issue, remove:

- `ADMIN_SECRET`, `CONFIG_ENCRYPTION_KEY`, any Ed25519 signing key material
- Device credentials, enrollment tokens, and session tokens/URLs (a Remote
  Shell session URL embeds an auth token in its query string)
- SSO client secrets, email-provider credentials, Company Variable secret
  values
- Real hostnames, IP addresses, company/contact names, or other customer
  data your organization considers sensitive — replace with placeholders
  rather than deleting the line, so the log's shape stays readable

If a log can't be safely redacted at all (e.g. it's dense with real
customer data), summarize what it shows instead of attaching it, or use
private vulnerability reporting if the content itself indicates a security
issue rather than a functional bug.

## Symptom-based troubleshooting

### Enrollment

- **Install succeeds but no device ever appears**: confirm the service is
  actually running (`sc query BeaconAgent` / `systemctl status
  beacon-agent`), then check `agent.log` for an enrollment error — a wrong
  `--server-url`, an expired/already-used enrollment token, or the endpoint
  being unable to reach the Worker at all (firewall/proxy/DNS) are the
  common causes and all log distinctly.
- **Device appears but stays unapproved forever**: expected behavior unless
  the company has auto-approve enabled — a technician must approve it from
  Device Approvals.

### Check-in

- **A previously-checking-in device goes silent**: confirm the service
  process is actually still running before assuming a Beacon-side problem.
  Check `agent.log`'s most recent lines; if there are none at all despite
  the process running, see the logging-race note in the table above.
- **Last Seen updates but expected data (new commands, monitor results)
  doesn't show up**: check-in only happens once a minute — allow a full
  interval before treating it as stuck.

### Audit

- **A section is empty on the device page**: distinguish "never audited"
  (no audit timestamp at all — trigger **Run Audit Now** and wait for its
  command to reach `completed`) from "collector legitimately returned
  nothing" (e.g. BIOS serial on Linux needs root; `dmidecode`/`lspci` not
  installed) — the latter is an honest empty field, not a failure. Check
  `agent.log` around the audit timestamp for a real collector error before
  assuming either.

### Jobs / components

- **Job stuck at `queued` or `sent`**: the target device hasn't checked in
  since dispatch yet (up to a minute), or is offline — confirm Last Seen
  before assuming the dispatch itself failed.
- **"Requires Admin to Run" 403**: the component is flagged
  `requires_admin`; only an admin account can run it or set and clear that
  flag.
- **Run-as-logged-in-user job fails with a clear Stderr message instead of
  running**: expected when there's no active console session, the device
  isn't Windows, or the shell isn't PowerShell — this deliberately fails
  loud rather than silently falling back to SYSTEM. See the Execution
  context scope in `CLAUDE.md`.
- **`CF_<KEY>` / `CV_<KEY>` script variables come back empty**: confirm the
  Custom Field has that exact key assigned and a value set for the specific
  device, or the Company Variable exists on the specific company being
  targeted — an unset field/variable is silently omitted rather than
  injected as an empty string.

### Patch management

- Windows-only; a non-Windows device showing no patch data is expected, not
  a bug.
- **Scan takes a long time or times out**: WUA search can genuinely take
  10–90+ seconds, especially against WSUS or on a first run; the agent
  allows up to 180 seconds before giving up.
- **Install hangs**: `wuinstall`'s WUA download step has an open, unresolved
  failure mode on at least one real test machine (see
  `docs/BETA_PLATFORM_SUPPORT.md`) — if an install command sits well past
  the 15-minute timeout with no result, this is a known limitation to
  report with hardware/environment details, not assume is unique to your
  setup.
- **A patch you expected to auto-approve didn't**: Auto-Approval matches on
  Windows Update *Classification* (Security Updates / Update Rollups), not
  MSRC *Severity* — check which classification the pending patch actually
  has.

### Remote shell

- **Stuck on "Connecting…"**: the agent attaches on its next check-in after
  the session is queued, up to a minute — allow that before treating it as
  failed. If it's still stuck past that, check `agent.log` for a PTY-open
  message; if the agent logged success but the dashboard never received
  traffic, report it as a Remote Shell bug with the relevant sanitized agent
  and browser logs.
- **Closing the modal leaves the remote shell process running**: fixed for
  sessions initiated by a current dashboard build through a current Worker
  deployment (explicit close code `1000` on both ends) — an old cached
  dashboard bundle or an un-updated self-hosted Worker can still hit the
  previous behavior.

### Agent self-update

- **A device never updates**: confirm the release the self-hoster published
  was signed with the same Ed25519 key the target agent was built against —
  a mismatched key rejects the update silently on the agent side with no
  dashboard-visible error, by design (see the Agent releases section of
  `CLAUDE.md`). Check `update-state.json` and `agent.log` on the device for
  the actual rejection reason.
- **Update appears to install but the device doesn't report the new
  version**: check whether the post-update confirmation deadline passed
  before a successful check-in — if so the agent should have rolled back to
  the prior version automatically; if it didn't, that's worth a bug report
  with both the old and new version numbers.

### Uninstall

- **Files or the tray icon are left behind after remote uninstall**: confirm
  the device was running a current agent version first — several real
  cleanup-ordering bugs in this path were found and fixed across earlier
  releases (stale process locks, a headless-context `timeout` delay that
  silently no-oped, a partial-tree delete aborting on the first locked
  file); an old agent build can still exhibit any of them.
- **Reinstalling reuses the old device identity instead of creating a new
  one**: confirms the credential directory wasn't actually removed — check
  for a leftover `credential.json` at the paths in the log table above.

## Known beta limitations

This is a short pointer, not a duplicate list — `docs/BETA_PLATFORM_SUPPORT.md`
is the authoritative, current capability-by-platform matrix (Supported /
Experimental / Unvalidated / Not available / Not applicable) and is kept up
to date as capabilities are promoted. Notable current-beta points worth
knowing before filing a report:

- macOS is Unvalidated across virtually every capability — no maintainer
  currently has real Apple hardware to test against. This is expected, not
  a bug report waiting to happen, unless you can supply real-hardware
  evidence.
- Windows Remote Shell is Unvalidated; Linux Remote Shell is Supported as of
  this beta.
- There is no continuous drift detection for Windows Update/Microsoft
  Update management (issue #79) — Beacon only reconciles state on its own
  schedule, not the instant a GPO or manual change re-enables something it
  disabled.
- Recurring job schedules, credentialed Network Discovery, and per-monitor
  additional notification recipients are deliberately deferred (Icebox),
  not missing oversights.

Check the matrix itself before reporting a gap in one of the
Experimental/Unvalidated rows — it may already be a documented, expected
limitation rather than a new defect.
