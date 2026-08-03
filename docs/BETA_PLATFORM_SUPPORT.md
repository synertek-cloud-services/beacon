# Beta platform support and acceptance

Beacon does not promise feature parity merely because the agent compiles for a
platform. This document records the initial beta support contract by capability
and provides the acceptance procedure used to change that contract.

The matrix applies to the repository's current `main` release candidate. A
hoster's plugins, operating-system policy, firewall, email provider, and network
can still affect a supported workflow.

See [`docs/BETA_SUPPORT.md`](BETA_SUPPORT.md) for how to report a problem,
find logs, and troubleshoot common symptoms by area.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Supported** | Implemented and successfully exercised end to end on a representative real system using the checklist below. This is the beta support commitment, not a promise that every distribution or hardware combination has been tested. |
| **Experimental** | Implemented and useful, but validation is limited, a material constraint remains, or the workflow has not yet passed the complete current-release checklist. Expect sharper edges and collect diagnostics when it fails. |
| **Unvalidated** | Code exists, but Beacon has no acceptable real-system evidence for this platform and capability. Do not present it as supported. |
| **Not available** | Beacon deliberately rejects the capability or has no implementation for this platform. |
| **Not applicable** | The capability belongs to a different operating-system model and does not make sense on this platform. |

Source inspection and a successful cross-compile are prerequisites, not enough
to move a capability out of Unvalidated.

## Initial beta capability matrix

| Capability | Windows | Linux | macOS | Important boundaries |
|---|---|---|---|---|
| Service installation and local uninstall | Supported | Supported | Unvalidated | Windows uses SCM; Linux support is systemd-based. Other Linux init systems are not supported by the installer. |
| Enrollment, approval, credential persistence, and check-in | Supported | Supported | Unvalidated | Enrollment tokens should be single-purpose and revoked after deployment. The current installer retains the enrollment token in service configuration; see issue #87. |
| Core metrics: uptime, CPU, memory, disks, OS, class | Supported | Supported | Unvalidated | Linux class detection treats a system without a battery as a server. Override the class when that is wrong. |
| Hardware, software, service, and network inventory audit | Supported | Supported | Unvalidated | Some Linux hardware fields depend on DMI tools/permissions. Empty optional fields are not fabricated. |
| Security/antivirus inventory | Supported | Experimental | Not available | Linux recognizes a small set of AV binaries and cannot prove signature currency. macOS has no security collector. |
| Disk, CPU, memory, and offline monitors | Supported | Supported | Unvalidated | Evaluation is backend-driven from normal check-ins. |
| File-size, ping, and process monitors | Experimental | Experimental | Unvalidated | Linux ping assignment, failure alerting, and recovery passed on Ubuntu 24.04; file-size/process and broader native-tool coverage remain promotion gates. |
| Windows service monitor | Experimental | Not available | Not available | This monitor uses Windows service/CIM semantics. Linux/macOS service inventory remains visible in audits but is not a live service monitor. |
| Software change monitor | Experimental | Experimental | Unvalidated | Audit-driven and event-based; it never auto-resolves. Linux supports dpkg and rpm inventories. |
| In-dashboard alerts and alert resolution | Supported | Supported | Unvalidated | Once telemetry reaches the Worker, behavior is platform-neutral. |
| Webhook and email alert delivery | Experimental | Experimental | Unvalidated | Per-monitor opt-in is required. Provider delivery and failure visibility remain environment-dependent. |
| One-time jobs and Quick Jobs as system/root | Supported | Supported | Unvalidated | Component `target_os` is enforced at dispatch. Shell commands must still be appropriate for the target OS. |
| One-time scheduled jobs as system/root | Experimental | Supported | Unvalidated | Linux hosted-cron dispatch and result reporting passed on Ubuntu 24.04. Recurring schedules are not available. |
| Job execution as the logged-in user | Experimental | Not available | Not available | Windows PowerShell only, one selected active session. Linux/macOS fail clearly instead of silently running as root. |
| Interactive remote shell | Unvalidated | Supported | Unvalidated | Ubuntu 24.04 passed the continuous dashboard-to-enrolled-agent flow: interactive PTY input/output, hosted relay traffic, explicit browser close, agent session closure, and confirmed PTY PID removal. |
| Remote agent restart | Supported | Supported | Unvalidated | Fresh Linux installations use `Restart=always`; an Ubuntu 24.04 agent returned with a different PID and resumed check-ins. Older installed units may still carry `Restart=on-failure` until reinstalled. |
| Device reboot command | Supported | Supported | Unvalidated | Ubuntu 24.04 went offline, returned with a different boot ID, restarted the agent, and resumed check-ins. Testing remains restricted to disposable or explicitly approved systems. |
| Signed self-update and post-update confirmation | Experimental | Unvalidated | Unvalidated | Release publication/download/signature verification is supported. Per-platform installed-agent swap, restart, confirmation, and rollback still require current-candidate evidence. |
| Remote uninstall | Supported | Supported | Unvalidated | Linux cleanup runs in a separate transient systemd unit so `Restart=always` cannot kill the helper. Two Ubuntu 24.04 install/uninstall cycles passed, including fresh identity after credential removal. Run last. |
| Windows patch scan, approval, and manual install | Supported | Not applicable | Not applicable | WUA-based and Windows-only. |
| Patch Policy dispatch, reboot behavior, and Windows/Microsoft Update management | Experimental | Not applicable | Not applicable | GPO drift detection is tracked separately in issue #79. Driver/Microsoft Update and Hyper-V behavior need representative hardware. |
| Endpoint tray, reboot prompt, and logged-in-user UI | Experimental | Not applicable | Not applicable | Windows-only. The latest tray icon self-heal still needs current real-hardware confirmation. |
| Network Discovery probe | Experimental | Experimental | Unvalidated | Ping/ARP discovery only, IPv4 ranges `/20` or smaller; credentialed discovery is post-v1. |

The matrix is intentionally conservative. For example, macOS collectors and a
LaunchDaemon installer exist, but without real Apple hardware they remain
Unvalidated rather than being inferred from Linux behavior.

## Evidence record

Create one record for every acceptance run. An issue comment is sufficient;
do not commit machine-specific evidence or secrets to the repository.

```text
Date/time (UTC):
Beacon commit:
Worker version/deployment:
Agent starting version:
Agent ending version:
Platform, edition/distribution, and version:
Architecture:
Physical/VM and provider/hypervisor:
Checklist steps passed:
Checklist steps failed or skipped, with reason:
Relevant Beacon command/job/alert IDs:
Cleanup confirmed:
Tester:
```

Never include an enrollment token, device credential, session URL/token,
`ADMIN_SECRET`, encryption/signing key, company secret value, or unredacted
customer/user data. Record timestamps and Beacon entity IDs so an authorized
operator can correlate server and endpoint logs without copying them publicly.

## Common test preparation

Use an isolated Beacon deployment and disposable endpoints whenever possible.
Testing against production requires explicit approval for every disruptive
action.

1. Record the exact commit. Complete Worker/dashboard deployment and database
   migrations before installing the candidate agent.
2. Publish candidate agent versions using the host-controlled signing key and
   the procedure in `docs/SELF_HOSTING.md`. Self-update testing requires two
   monotonically increasing candidate versions signed by the same key.
3. Create a disposable company named with an `Acceptance <date>` prefix. Disable
   inherited policies that could obscure test results.
4. Create a one-use, short-lived enrollment token. Do not put it in the evidence
   record. Revoke it immediately after enrollment succeeds.
5. Prepare an inert component that prints a unique marker, OS identity, current
   user, and execution timestamp. Do not use customer data or secrets.
6. Create a temporary policy using `ping` or `file_size`, not a check type used
   by seeded global policies such as `disk_space`; same-check-type override
   behavior can otherwise hide which monitor produced the result.
7. If testing notifications, use a dedicated test webhook/mailbox and enable
   only that temporary monitor's notification toggles.
8. Capture the endpoint's service state, process ID, boot time/uptime, installed
   paths, and credential directory before disruptive steps.

## Shared Windows and Linux workflow

Perform these steps in order. The platform-specific sections add assertions and
limitations.

### 1. Install, enroll, and approve

- Install from an elevated Administrator/root shell using the documented
  service installer and candidate release binary.
- Confirm the OS service is installed, enabled/automatic, and running.
- Confirm exactly one new device appears under the intended company with the
  correct OS, hostname, architecture, agent version, and class.
- If auto-approval is disabled, verify check-ins do not become operational
  until a technician approves the device.
- Revoke the enrollment token and confirm the enrolled device continues using
  its device credential.
- Confirm Last Seen advances across at least two normal check-ins.

### 2. Audit and inventory

- Trigger **Run Audit Now** and require its direct command to reach `completed`.
- Confirm a newer audit appears and the device page renders real System,
  Software, Services, Memory, Storage, Network, and Security data where the
  platform exposes it.
- Compare representative values against the endpoint itself: OS/version,
  architecture, CPU/core count, memory, disks, primary IP/MAC, service and
  software presence.
- Treat an honest unavailable/empty optional field as different from a failed
  audit. Check the endpoint log for collector errors before accepting blanks.

### 3. Monitoring and notifications

- Create a temporary `ping` or `file_size` monitor with zero sustained delay and
  a one-minute check interval.
- Make its condition fail deterministically. Wait through the assignment,
  measurement, and following check-in that reports the result.
- Confirm one alert opens for the correct company/device/policy/monitor and its
  configured priority is preserved.
- If enabled, confirm the test webhook/email receives the opened notification
  without secret material and with the expected identifiers.
- Restore the healthy condition. Confirm an auto-resolving monitor resolves and
  sends the resolved notification when configured.
- Delete the temporary policy only after the resolved state is recorded.

### 4. Automation

- Run the inert component as a Quick Job. Require `completed`, exit code `0`,
  the unique marker, correct OS, and the expected system/root identity.
- Create a one-time scheduled job at least one cron interval in the future.
  Confirm it has no commands before its due time, dispatches once after it is
  due, targets the currently approved device, and completes with the expected
  output. It must not dispatch a second time.
- Run one deliberate nonzero-exit component and confirm Beacon reports the
  execution as `completed` while preserving the nonzero exit code and useful
  stdout/stderr. A nonzero program exit means the script ran; it is distinct
  from a Beacon transport/execution failure.
- Run a component past its configured timeout and confirm Beacon reports
  `failed` with a useful timeout message.

### 5. Remote shell

- Open Remote Shell and allow one normal check-in interval for the agent to
  attach.
- Run commands that print the hostname, OS identity, current user, and working
  directory. Confirm interactive input, output, and terminal resize.
- Close the modal/session and confirm the endpoint shell process exits rather
  than remaining orphaned.
- A relay that creates the session and delivers `open_session` but forwards no
  PTY traffic fails this step. Record both connection order and Worker/agent
  timestamps; do not promote based only on the agent's "opening session" log.

### 6. Agent update

- Start from candidate version A and register a higher candidate version B for
  the same OS/architecture, signed by the same host key.
- Use **Check for Updates**, confirm version B is downloaded, its signature is
  accepted, the binary swaps, and the service starts a new process.
- Require a successful post-update check-in reporting version B before the
  confirmation deadline. Confirm the update state and previous-binary backup
  are cleaned after confirmation.
- A rollback test uses a deliberately non-checking-in B build only in an
  isolated environment. Require automatic restoration of A after the deadline;
  never corrupt or replace a published same-version asset.

### 7. Restart and reboot

- Record the agent PID, invoke **Restart Agent**, and confirm the service returns
  with a different PID and resumes check-ins. On Linux, also confirm the
  installed unit contains `Restart=always`; an older `Restart=on-failure` unit
  will not restart after the command's clean exit.
- On an explicitly disposable/approved endpoint, record boot time, invoke
  **Schedule Reboot**, and confirm the host returns, boot time changes, uptime
  resets, and Beacon resumes check-ins without re-enrollment.

### 8. Uninstall and cleanup

Run uninstall last.

- Test the dashboard's remote **Uninstall Agent** action for the beta path. A
  separate run may test the local CLI `uninstall` path.
- Confirm the service/unit registration, agent and tray processes, install
  directory/binary, credential file, update state, and agent log directory are
  gone. A stopped service with leftover credentials is a failure.
- Confirm check-ins stop and reinstalling with a new one-use token creates a new
  device identity rather than silently reusing the removed credential.
- Revoke remaining tokens and remove temporary policies, jobs/components,
  notification destinations, company/device records, releases, and disposable
  infrastructure according to their retention rules.

## Windows-specific acceptance

Use a currently supported Windows client or Server release with PowerShell 5.1,
SCM, WMI/CIM, and ConPTY available.

- Confirm the service runs as `SYSTEM`, is Automatic, and has recovery actions
  configured to restart after clean and failed exits.
- Validate Windows-specific inventory: edition/build/display version,
  installation type, domain only when joined, AV product/status, firewall,
  display adapters, installed software, services/start type, and patch scan.
- Exercise a Windows service monitor against a harmless known service and
  confirm running/stopped behavior. Do not stop a critical service.
- Exercise a PowerShell Job as the logged-in user with an active session. The
  output identity must differ from `SYSTEM`; no-session and unsupported-shell
  cases must fail clearly rather than falling back to SYSTEM.
- Confirm Remote Shell uses a persistent ConPTY PowerShell session.
- For patch acceptance, approve only a disposable safe update, require its WUA
  result to be captured, and verify any reboot-required result produces the
  configured tray prompt or policy reboot behavior.
- Confirm tray visibility after login/reboot, no duplicate icons after an agent
  restart/update, and the configured reboot prompt can be postponed/accepted.
- On representative hosts, separately record client/Server, Hyper-V host, and
  domain-GPO limitations. Never alter production GPO merely to make a test pass.

## Linux-specific acceptance

The initial beta installer target is Ubuntu 24.04 LTS with systemd on amd64.
Other systemd distributions may be evaluated, but they do not inherit
Supported status from Ubuntu automatically.

- Confirm `/etc/systemd/system/beacon-agent.service`,
  `/usr/local/bin/beacon-agent`, and `/etc/beacon` have the expected ownership
  and modes and that the service runs as root.
- Validate dpkg software inventory, systemd service inventory, DMI fields when
  exposed, filesystem/disk/network data, virtualization identification, and
  ufw/firewalld status when installed.
- Treat Linux AV as Experimental: detection of a known executable is not proof
  that its daemon is healthy or signatures are current.
- Exercise bash/sh Jobs as root. Confirm a Job configured for logged-in-user
  execution fails with the documented unsupported-platform error.
- Confirm Remote Shell opens the configured `$SHELL`, with `/bin/bash` then
  `/bin/sh` fallback.
- Do not create a live `service` monitor; that monitor type is Windows-only.
- Confirm the installed unit uses `Restart=always`, then exercise **Restart
  Agent** and allow the configured 30-second restart delay plus normal check-in
  time before declaring failure.
- Confirm remote uninstall submits cleanup through a transient `systemd-run`
  unit. A plain detached child remains in `beacon-agent.service`'s cgroup and
  can be killed when the main process exits.
- Reboot testing must use a disposable VPS/VM with console access and a bounded
  recovery plan in case networking or boot fails.

## macOS preview boundary

Beacon cross-compiles Darwin amd64/arm64 agents and contains LaunchDaemon,
inventory, software, service, PTY shell, update, and uninstall code. No project
maintainer currently has real Apple hardware, so these paths remain
Unvalidated. There is no macOS security/AV collector, logged-in-user Job
execution, Windows service monitor, patch management, or Windows tray workflow.

Do not relabel macOS as Supported based on compilation, a Linux test, or an
Apple-like VM alone. Promotion requires real Apple hardware, a host-controlled
signed release, the shared workflow above, and an explicit record of macOS
privacy/TCC and launchd behavior.

## Release decision

A beta candidate is acceptable when:

- every capability labeled Supported has a current passing evidence record for
  each supported platform;
- every failed or skipped step is reflected in the matrix and known
  limitations, not hidden in private test notes;
- no unresolved Critical or High beta blocker remains;
- temporary credentials, records, releases, and infrastructure are cleaned up;
  and
- README/release notes link to this exact matrix rather than claiming generic
  Windows/macOS/Linux parity.
