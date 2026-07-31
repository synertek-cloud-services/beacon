//go:build windows

package service

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	ServiceName = "BeaconAgent"
	installDir  = `C:\Program Files\Beacon`
	exeName     = "beacon-agent.exe"
)

func installPath() string { return filepath.Join(installDir, exeName) }

// PendingRebootMarkerPath is the canonical path both cmd/agent (writes it
// after a patch install that reports RebootRequired, polls it for a tray's
// response) and cmd/beacon-tray (polls it to decide whether to prompt, and
// writes the user's response) agree on. Exported from here rather than
// duplicated as a string literal in both, or hardcoded separately, since
// this is already the one place installDir is defined.
func PendingRebootMarkerPath() string { return filepath.Join(installDir, "pending-reboot.json") }

func Install(serverURL, enrollToken string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}

	dest := installPath()
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return fmt.Errorf("create install dir: %w", err)
	}
	if err := copyFile(exe, dest); err != nil {
		return fmt.Errorf("copy binary: %w", err)
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("open service manager: %w", err)
	}
	defer m.Disconnect()

	// Remove stale service if present
	if s, err := m.OpenService(ServiceName); err == nil {
		s.Control(svc.Stop)
		time.Sleep(2 * time.Second)
		s.Delete()
		s.Close()
	}

	cfg := mgr.Config{
		DisplayName: "Beacon RMM Agent",
		Description: "Beacon remote monitoring and management agent.",
		StartType:   mgr.StartAutomatic,
	}
	s, err := m.CreateService(ServiceName, dest, cfg,
		"--server-url", serverURL,
		"--enroll-token", enrollToken,
	)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer s.Close()

	if err := s.Start(); err != nil {
		return fmt.Errorf("start service: %w", err)
	}

	hardenService(s)
	hardenInstallDir()

	fmt.Printf("Beacon agent installed and started as Windows service %q\n", ServiceName)
	return nil
}

// hardenService sets recovery actions (restart on any exit) and locks down the
// service SDDL so that only SYSTEM can stop or delete the service. Admins
// retain read + start rights so they can see it in Services and start it if
// needed, but cannot stop or uninstall it through normal channels.
func hardenService(s *mgr.Service) {
	// Recovery: restart after 5s, 10s, 30s; trigger even on clean exit (os.Exit(0))
	// so the self-updater's exit is caught and the new binary is restarted by SCM.
	actions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}
	if err := s.SetRecoveryActions(actions, 86400); err != nil {
		log.Printf("tamper: set recovery actions: %v", err)
	}
	// Trigger recovery even when the service exits with code 0 (normal exit).
	if err := s.SetRecoveryActionsOnNonCrashFailures(true); err != nil {
		log.Printf("tamper: set recovery on non-crash: %v", err)
	}

	// SDDL: SYSTEM gets full control; Administrators get query+start only
	// (no WP=Stop, no SD=Delete, no DT=Pause). This survives a reboot.
	// D: = DACL
	//   SY = SYSTEM:  GA (Generic All -- genuinely everything, including
	//                 DELETE and WRITE_DAC)
	//   BA = Admins:  CC LC RP RC            (query, start, read — no stop/delete)
	//
	// Real bug found via production testing (uninstall on a real device hit
	// "Access is denied" even when escalated to SYSTEM via a scheduled
	// task): the SYSTEM grant used to be spelled out as the specific rights
	// CCLCSWRPWPDTLOCRRC, which -- despite the comment here previously
	// calling it "everything" -- omits DE (SERVICE_DELETE) and WD
	// (WRITE_DAC). Go's mgr.OpenService always requests SERVICE_ALL_ACCESS
	// internally, which needs DELETE among other rights -- so that SDDL
	// denied SERVICE_ALL_ACCESS to *everyone*, including SYSTEM, the moment
	// it was successfully applied. Worse, without WD, not even a future
	// Reharden() call (which re-runs sc sdset, itself a DACL-modifying
	// operation) could self-heal it, since changing a DACL requires
	// WRITE_DAC too. GA sidesteps this whole class of "manually enumerate
	// every right and miss one" bug for the one principal (SYSTEM) that's
	// supposed to have literally everything anyway.
	const svcSDDL = `D:(A;;GA;;;SY)(A;;CCLCRPRC;;;BA)`
	if out, err := exec.Command("sc.exe", "sdset", ServiceName, svcSDDL).CombinedOutput(); err != nil {
		log.Printf("tamper: sc sdset: %v — %s", err, out)
	}
}

// Reharden re-applies the tamper-resistance hardening (recovery actions,
// SDDL lock, install-dir ACL) to an already-installed service. Unlike
// hardenService/hardenInstallDir above, which only ever ran once from
// Install(), this is called on every agent startup (see main.go) so
// hardening is self-healing: a device enrolled before this feature
// existed, or one where hardening was manually stripped, becomes
// protected again the next time its service starts for any reason --
// boot, manual restart, or a self-update swap -- with no separate
// remediation step required.
//
// This closes a real gap found in production: self-update's Windows swap
// (swap_windows.go's atomicSwap) relies entirely on pre-configured SCM
// recovery actions to restart the service after its os.Exit(0) -- on a
// device that was never hardened, that exit was permanent, since nothing
// was ever configured to bring the service back. The new binary would
// sit on disk, fully updated, and never run.
//
// Best-effort and silent on failure to open the service (e.g. running
// interactively before `install` has ever been run) -- there's nothing to
// harden yet in that case, and this must never block normal agent startup.
func Reharden() {
	m, err := mgr.Connect()
	if err != nil {
		log.Printf("tamper: reharden: connect to service manager: %v", err)
		return
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return
	}
	defer s.Close()

	hardenService(s)
	hardenInstallDir()
}

// hardenInstallDir locks the install directory so only SYSTEM has write access.
// Administrators retain read + execute so they can see and run the binary, but
// cannot delete, replace, or modify it without elevated SYSTEM-level access.
func hardenInstallDir() {
	args := []string{
		installDir,
		"/inheritance:r",
		"/grant:r", `NT AUTHORITY\SYSTEM:(OI)(CI)F`,
		"/grant:r", `BUILTIN\Administrators:(OI)(CI)RX`,
	}
	if out, err := exec.Command("icacls.exe", args...).CombinedOutput(); err != nil {
		log.Printf("tamper: icacls: %v — %s", err, out)
	}
}

func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("open service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("service not found: %w", err)
	}
	defer s.Close()

	s.Control(svc.Stop)
	time.Sleep(2 * time.Second)

	if err := s.Delete(); err != nil {
		return fmt.Errorf("delete service: %w", err)
	}

	os.Remove(installPath())
	fmt.Println("Beacon agent service removed.")
	return nil
}

// SelfUninstall is called by the agent's own running SYSTEM-context process
// in response to a remotely-dispatched uninstall_agent command -- the whole
// reason this is a separate function from Uninstall() above, not a reuse of
// it. Uninstall() is invoked by a *separate* `beacon-agent.exe uninstall`
// process (a different OS process than the one being torn down), so its
// synchronous Stop-then-Delete-then-Remove sequence is safe there. Calling
// that same sequence from *inside* the running service would race its own
// termination: s.Control(svc.Stop) asks SCM to deliver a stop request back
// to this exact process's own Execute() loop (runner_windows.go), and once
// that's actioned the process is expected to exit -- but the goroutine that
// called Stop is a detached child of the check-in loop, not awaited by it,
// so the whole process can be torn down before Delete()/os.Remove() below
// ever get a chance to run. Found by reasoning through the architecture
// during this feature's design, not hit live -- the born-from-real-pain
// motivation was purely "there's no remote way to tear down a hardened
// install," not a reproduced crash.
//
// The fix: never try to out-live your own termination. Disable recovery
// actions first (hardenService configured SCM to restart on *any* exit,
// including a clean one -- without disabling that, SCM would resurrect the
// "crashed" service before cleanup finishes), spawn a small detached helper
// that performs the actual stop+delete+remove after a short delay (long
// enough for this process to have fully exited and released its file
// handle on its own binary and its SCM connection), then let this process
// exit normally. The helper runs independently of this process's lifetime
// -- Windows doesn't tie a child process to its parent by default.
func SelfUninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("open service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("service not found: %w", err)
	}
	if err := s.SetRecoveryActionsOnNonCrashFailures(false); err != nil {
		log.Printf("uninstall: clear recovery-on-non-crash: %v", err)
	}
	if err := s.SetRecoveryActions(nil, 0); err != nil {
		log.Printf("uninstall: clear recovery actions: %v", err)
	}
	s.Close()

	// taskkill beacon-tray.exe first -- found via real testing, not
	// anticipated in the original design: the tray runs as a *separate*
	// process launched into the logged-in user's own session
	// (usersession.RunAsSession), not a child of this service, so stopping
	// the service does nothing to it. Left running, its own open handle on
	// beacon-tray.exe blocks `rd /s /q` from removing the install
	// directory -- confirmed live: the service and registry cleanly
	// disappeared, but the directory was left behind with the tray still
	// visible in the notification area. SYSTEM has sufficient privilege
	// (SeDebugPrivilege) to kill a process in a different session; `/F`
	// forces it since the tray has no graceful-shutdown handling to wait
	// on. Chained with `&`, not `&&` -- must still proceed to the rest of
	// cleanup even when no tray process exists to kill (taskkill exits
	// non-zero in that case).
	//
	// CREATE_NO_WINDOW: SYSTEM has no interactive desktop to show a console
	// on anyway (session 0 isolation), but harmless to set explicitly
	// regardless -- same reasoning already documented on the tray's own
	// CreateProcessAsUser call in usersession_windows.go.
	helperScript := fmt.Sprintf(
		`timeout /t 3 /nobreak >nul & taskkill /IM beacon-tray.exe /F & sc stop %s & sc delete %s & rd /s /q "%s"`,
		ServiceName, ServiceName, installDir,
	)
	cmd := exec.Command("cmd.exe", "/c", helperScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn uninstall helper: %w", err)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
