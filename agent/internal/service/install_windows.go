//go:build windows

package service

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

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
