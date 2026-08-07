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

	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
)

const (
	ServiceName = "BeaconAgent"
	installDir  = `C:\Program Files\Beacon`
	exeName     = "beacon-agent.exe"
)

func installPath() string { return filepath.Join(installDir, exeName) }

func Install(serverURL string) error {
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
	)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer s.Close()

	if err := s.Start(); err != nil {
		return fmt.Errorf("start service: %w", err)
	}

	setRecoveryActions(s)

	fmt.Printf("Beacon agent installed and started as Windows service %q\n", ServiceName)
	return nil
}

// setRecoveryActions configures SCM to restart the service after any exit,
// including a clean one (os.Exit(0)) -- this is what makes self-update's
// Windows swap (swap_windows.go's atomicSwap) actually come back up after
// its own exit, and has nothing to do with tamper resistance.
//
// This used to also lock the service down via `sc sdset` (SYSTEM-only
// stop/delete) and lock the install directory via `icacls`
// (SYSTEM-only write), under the name hardenService/hardenInstallDir --
// deliberately removed. That tamper-resistance design turned out to make
// the agent nearly impossible to work with during real hardware testing: a
// hardened service can't be stopped, deleted, or reinstalled by a local
// Administrator at all, only by SYSTEM, and the only recovery path when
// something needs to change is registry-level surgery
// (`Remove-Item HKLM:\SYSTEM\CurrentControlSet\Services\BeaconAgent` +
// reboot) or the agent's own cooperation (see uninstall_agent /
// SelfUninstall below, itself only needed *because* of this restriction).
// Pulled out rather than iterated on further -- worth reimplementing
// properly later, but not by continuing to patch around it live.
func setRecoveryActions(s *mgr.Service) {
	actions := []mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}
	if err := s.SetRecoveryActions(actions, 86400); err != nil {
		log.Printf("service: set recovery actions: %v", err)
	}
	if err := s.SetRecoveryActionsOnNonCrashFailures(true); err != nil {
		log.Printf("service: set recovery on non-crash: %v", err)
	}
}

// Reharden re-applies the recovery-action configuration to an
// already-installed service. Called on every agent startup (see main.go)
// so a device enrolled before this existed, or one where the config was
// manually stripped, self-heals the next time its service starts for any
// reason -- boot, manual restart, or a self-update swap -- with no
// separate remediation step required.
//
// This closes a real gap found in production: self-update's Windows swap
// relies entirely on pre-configured SCM recovery actions to restart the
// service after its os.Exit(0) -- on a device that never had this set, that
// exit was permanent, since nothing was ever configured to bring the
// service back. The new binary would sit on disk, fully updated, and never
// run. Kept the name Reharden rather than renaming it despite no longer
// doing any actual hardening -- this file's tamper-resistance behavior is
// deliberately gone (see setRecoveryActions' own comment), but this
// function's self-healing purpose is unchanged.
//
// Best-effort and silent on failure to open the service (e.g. running
// interactively before `install` has ever been run) -- there's nothing to
// configure yet in that case, and this must never block normal agent
// startup.
func Reharden() {
	m, err := mgr.Connect()
	if err != nil {
		log.Printf("service: reharden: connect to service manager: %v", err)
		return
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return
	}
	defer s.Close()

	setRecoveryActions(s)
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

	// beacon-tray.exe runs as a separate process in the logged-in user's own
	// session (usersession.RunAsSession), not a child of this service --
	// stopping the service does nothing to it. Left running, its own open
	// handle on beacon-tray.exe would block removing the install directory
	// below, the same real issue SelfUninstall already had to work around
	// (see its own doc comment). This function runs as a separate CLI
	// invocation, not the service tearing itself down, so it can just kill
	// the tray directly and synchronously here -- no detached helper needed
	// the way SelfUninstall's self-referential-termination problem requires.
	// Error ignored: "no matching process found" isn't a real failure.
	exec.Command("taskkill", "/IM", "beacon-tray.exe", "/F").Run()

	// Remove the whole install directory, not just the one exe -- the
	// previous os.Remove(installPath()) left beacon-tray.exe and any other
	// extracted files behind. Best-effort like the exe removal it replaces
	// (never checked that error either) -- the service being stopped and
	// deleted above is the real uninstall; leftover files being briefly
	// locked by something else shouldn't fail the whole command.
	if err := os.RemoveAll(installDir); err != nil {
		log.Printf("uninstall: remove install dir: %v", err)
	}

	// credential.json and agent.log live in a completely separate location
	// from installDir (see credential.Dir()'s own doc comment) -- neither
	// uninstall path removed this before, which left a stale credential
	// behind for a later reinstall to silently reuse instead of enrolling
	// fresh as a new device. Best-effort, same reasoning as installDir above.
	if err := os.RemoveAll(credential.Dir()); err != nil {
		log.Printf("uninstall: remove credential dir: %v", err)
	}

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
// actions first (setRecoveryActions configured SCM to restart on *any*
// exit, including a clean one -- without disabling that, SCM would
// resurrect the "crashed" service before cleanup finishes), spawn a small
// detached helper
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
	// A fixed delay (`ping -n 4 127.0.0.1 >nul`, ~3s, replacing an earlier
	// `timeout /t 3` that failed outright with no console to attach to) was
	// tried here first, guessing that 3s was "long enough" for this process
	// to have exited and released its own locks (its own loaded image at
	// installDir\beacon-agent.exe, and its own open log file inside
	// credential.Dir() via setupLogging) before `rd /s /q` ran against
	// either directory. Real-hardware testing showed it wasn't: `rd /s /q`
	// aborts its *entire* recursive delete the moment it hits one locked
	// file rather than skipping it and continuing (unlike Explorer's
	// delete), which is why a real test left both directories completely
	// untouched -- not just the one locked file within each, everything.
	// Replaced the guessed fixed delay with an active wait on the actual
	// condition that matters: PowerShell's Wait-Process polls for this
	// process's own PID to actually exit (bounded by -Timeout so a stuck
	// wait can't hang the helper forever), then a short grace period for
	// the OS to finish releasing handles, before ever touching either
	// directory. Remove-Item (not rd /s /q) is also more forgiving of a
	// single still-locked file within a tree, and -ErrorAction Stop +
	// try/catch here lets each removal's real error get logged to
	// %SystemRoot%\Temp\beacon-uninstall.log -- a location outside both
	// directories being removed, so it survives to be inspected even if a
	// removal fails again.
	pid := os.Getpid()
	helperScript := fmt.Sprintf(`
$log = 'C:\Windows\Temp\beacon-uninstall.log'
"$(Get-Date -Format o) waiting on parent pid %d" | Out-File -FilePath $log -Append
Wait-Process -Id %d -Timeout 30 -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
taskkill /IM beacon-tray.exe /F 2>&1 | Out-File -FilePath $log -Append
sc.exe stop %s 2>&1 | Out-File -FilePath $log -Append
sc.exe delete %s 2>&1 | Out-File -FilePath $log -Append
try { Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction Stop; "removed install dir OK" | Out-File -FilePath $log -Append } catch { "install dir removal failed: $_" | Out-File -FilePath $log -Append }
try { Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction Stop; "removed credential dir OK" | Out-File -FilePath $log -Append } catch { "credential dir removal failed: $_" | Out-File -FilePath $log -Append }
`,
		pid, pid, ServiceName, ServiceName, installDir, credential.Dir(),
	)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", helperScript)
	// CREATE_NO_WINDOW: SYSTEM has no interactive desktop to show a console
	// on anyway (session 0 isolation), but harmless to set explicitly
	// regardless -- same reasoning already documented on the tray's own
	// CreateProcessAsUser call in usersession_windows.go.
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
