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
	//   SY = SYSTEM:  CC LC SW RP WP DT LO CR RC (everything)
	//   BA = Admins:  CC LC RP RC            (query, start, read — no stop/delete)
	const svcSDDL = `D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCLCRPRC;;;BA)`
	if out, err := exec.Command("sc.exe", "sdset", ServiceName, svcSDDL).CombinedOutput(); err != nil {
		log.Printf("tamper: sc sdset: %v — %s", err, out)
	}
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
