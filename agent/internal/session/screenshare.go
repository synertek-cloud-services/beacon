package session

import (
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

// screenShareBinary is beacon-screenshare.exe, cross-compiled and refreshed
// into agent/internal/session/embedded/ the same way the tray binary is
// refreshed for agent/internal/service/embedded/ -- see
// scripts/publish-agent.mjs. Deliberately no _windows.go/_other.go split
// for this file: the embed itself is platform-agnostic bytes, and every
// OS-specific call this file makes (usersession.RunAsActiveUser) already
// has a no-op stub on non-Windows, so this whole package stays
// cross-platform buildable with zero extra files.
//
//go:embed embedded/beacon-screenshare.exe
var screenShareBinary []byte

// runScreenShare launches the embedded beacon-screenshare.exe into the
// active console user's own desktop session, passing it the session ID and
// relay WebSocket URL to dial itself. It never dials the relay from this
// (SYSTEM-context) process -- see Handle's comment for why.
//
// elevated requests the on-demand "Elevate" escalation: launches with the
// user's linked (full/elevated) token instead of their standard one, so
// the helper can interact with (not just see) UAC-elevated windows --
// Windows' User Interface Privilege Isolation otherwise blocks input from
// a Medium-integrity process like the non-elevated launch below into a
// High-integrity one, confirmed as a real, distinct limitation on real
// hardware (screen capture worked, input didn't, until the elevated
// window closed). Deliberately not the default -- always launching
// elevated would mean every Web Remote session runs with full admin
// rights on the target, a real security-posture cost for a capability
// most sessions never need.
//
// adminUsername/adminPassword are the fallback for the realistic common
// case where the logged-in user isn't a split-token administrator at all
// (no linked token to escalate with, ErrElevationNotAvailable) -- see
// launchScreenShare.
func runScreenShare(sessionID, wsURL string, elevated bool, adminUsername, adminPassword string) {
	exePath, err := extractScreenShareIfStale()
	if err != nil {
		log.Printf("session %s: screen share: %v", sessionID, err)
		return
	}

	args := []string{
		"--session-id=" + sessionID,
		"--ws-url=" + wsURL,
	}

	pid, err := launchScreenShare(exePath, args, elevated, adminUsername, adminPassword)
	if err != nil {
		switch {
		case errors.Is(err, usersession.ErrNoActiveSession):
			// Nobody logged in -- expected no-op, matches v1's own scope
			// (logged-in-user desktop capture only). The browser's own
			// connect timeout is what surfaces this to the technician;
			// nothing needs to travel back over this path.
			log.Printf("session %s: screen share: no active console session", sessionID)
		case errors.Is(err, usersession.ErrElevationNotAvailable):
			// Not an administrator, or UAC disabled, and no fallback
			// credentials were available either -- expected, common, not a
			// crash. Same "the browser's own connect timeout surfaces
			// this" reasoning as the no-active-session case above: there's
			// no way for the worker to have known ahead of time whether
			// this would work, and building a fast explicit failure round
			// trip for one button is new protocol machinery this feature
			// doesn't otherwise need. errors.Is, not direct equality --
			// runAsToken wraps this sentinel with %w alongside the
			// underlying GetLinkedToken error for context.
			log.Printf("session %s: screen share: elevation not available: %v", sessionID, err)
		case errors.Is(err, usersession.ErrInvalidCredentials):
			// The configured CV_LOCAL_ADMIN_USERNAME/PASSWORD were rejected
			// by Windows -- stale/misconfigured, not a crash. Same
			// non-fatal treatment, same connect-timeout surfacing.
			log.Printf("session %s: screen share: configured admin credentials rejected: %v", sessionID, err)
		default:
			log.Printf("session %s: screen share launch: %v", sessionID, err)
		}
		return
	}
	log.Printf("session %s: launched beacon-screenshare pid %d (elevated=%v)", sessionID, pid, elevated)

	if elevated {
		launchElevatedShell(sessionID, adminUsername, adminPassword)
	}
}

// elevatedMenuScript is presented automatically in the elevated shell window
// launchElevatedShell opens. Not every technician has the exact command or
// MMC snap-in name for the admin tool they need memorized, so this turns
// "access to all the administrative tools" into a pick-a-number list instead
// of requiring that. Defined as a `menu` function, not a one-shot block or a
// blocking loop -- PowerShell keeps a -File script's top-level functions
// defined in the interactive prompt -NoExit drops into afterward, so this
// runs once automatically on open and can be re-typed ("menu") any time
// afterward. The window underneath is a completely normal, fully capable
// elevated PowerShell prompt the whole time -- this is a convenience layer
// on top of it, not a restricted or modal shell; pressing Enter with no
// choice, or just ignoring the prompt and typing a real command, both work.
const elevatedMenuScript = `function menu {
    Clear-Host
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " Beacon -- Elevated Administrative Session" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host " Anything you run here -- including from this menu --"
    Write-Host " runs elevated, with no further Windows prompts."
    Write-Host ""
    Write-Host "   1  Task Manager"
    Write-Host "   2  Control Panel"
    Write-Host "   3  Services"
    Write-Host "   4  Device Manager"
    Write-Host "   5  Event Viewer"
    Write-Host "   6  Disk Management"
    Write-Host "   7  Programs and Features (uninstall/change)"
    Write-Host "   8  Network Connections"
    Write-Host "   9  System Properties"
    Write-Host "  10  File Explorer"
    Write-Host ""
    Write-Host " Enter a number to open a tool, or press Enter for a" -ForegroundColor DarkGray
    Write-Host " plain PowerShell prompt. Type 'menu' any time to show" -ForegroundColor DarkGray
    Write-Host " this list again." -ForegroundColor DarkGray
    Write-Host ""
    $choice = Read-Host "Choice"
    switch ($choice) {
        '1'  { Start-Process taskmgr.exe }
        '2'  { Start-Process control.exe }
        '3'  { Start-Process services.msc }
        '4'  { Start-Process devmgmt.msc }
        '5'  { Start-Process eventvwr.msc }
        '6'  { Start-Process diskmgmt.msc }
        '7'  { Start-Process control.exe -ArgumentList 'appwiz.cpl' }
        '8'  { Start-Process control.exe -ArgumentList 'ncpa.cpl' }
        '9'  { Start-Process control.exe -ArgumentList 'sysdm.cpl' }
        '10' { Start-Process explorer.exe }
        default { }
    }
}
menu
`

// writeElevatedMenuScript writes elevatedMenuScript to a fixed, well-known
// path under the OS temp dir, overwriting any previous copy -- a fixed name
// rather than a fresh os.CreateTemp one per launch, so repeated Elevate
// clicks don't accumulate junk files. Never deleted after launch: unlike
// executor.writeTempScript's synchronous job scripts (removed right after
// the command they back finishes), the shell this backs is long-lived and
// interactive with no completion signal this fire-and-forget call could
// wait on anyway. Left in place deliberately -- the file carries no secret
// content, just a fixed menu, so leaving it costs nothing.
func writeElevatedMenuScript() (string, error) {
	path := filepath.Join(os.TempDir(), "beacon-elevated-menu.ps1")
	// Same UTF-8 BOM requirement as executor.writeTempScript -- Windows
	// PowerShell 5.1 has no reliable way to detect a BOM-less script's
	// encoding and falls back to the system codepage, which can misdecode
	// this script's em dashes and corrupt parsing.
	content := "\ufeff" + elevatedMenuScript
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// launchElevatedShell opens a second, independent elevated PowerShell window
// into the same session right alongside the (also elevated) screen-share
// helper -- this, not the helper's own input handling, is what actually
// delivers "access to all the administrative tools" from an Elevate click.
// A child process spawned from an already-elevated process inherits that
// elevation automatically, so anything the technician runs from inside this
// window -- Task Manager, Control Panel, Services, an installer, the
// registry -- never triggers a further UAC prompt. That sidesteps the real,
// still-unsolved limitation entirely: Beacon cannot see or interact with
// Windows' own secure desktop (confirmed by inspection -- no
// SetThreadDesktop/OpenDesktop call exists anywhere in this codebase), so a
// prompt raised the normal way (right-click something on the visible
// desktop, choose "Run as Administrator") still freezes the session waiting
// on whoever's physically at the keyboard. This mechanism never asks
// Windows to elevate anything in the first place, so there is no prompt to
// get stuck behind.
//
// Uses the exact same elevation call that already succeeded above --
// RunAsActiveUserElevated first (free, silent, the split-token/admin-user
// case), falling back to RunAsActiveUserWithCredentials only on
// ErrElevationNotAvailable -- mirroring launchScreenShare's own ordering
// exactly rather than diverging from it. sessionID here is only used for
// logging; it's the Beacon relay session UUID, not a Windows Terminal
// Services session number, so (like launchScreenShare/beacon-screenshare
// itself) this targets the active console session directly rather than a
// specific WTS session ID -- consistent with this feature's existing
// console-only v1 scope. Deliberately fire-and-forget: failure here must
// never affect whether the screen-share session itself is reported as
// elevated, and the spawned window's lifecycle isn't tracked -- it's an
// ordinary, independent window the technician (or end user) closes like any
// other. A second Elevate click on the same session opens a second window;
// not deduplicated here, acceptable minor clutter rather than added
// bookkeeping for a rare case.
func launchElevatedShell(sessionID, adminUsername, adminPassword string) {
	scriptPath, err := writeElevatedMenuScript()
	if err != nil {
		log.Printf("session %s: elevated shell: write menu script: %v", sessionID, err)
		return
	}
	// -ExecutionPolicy Bypass: see the identical comment on the SYSTEM-context
	// path in executor/run.go -- confirmed on real hardware via a real
	// UnauthorizedAccess error ("running scripts is disabled on this
	// system") on a Windows client machine, whose default execution policy
	// (Restricted) blocks -File regardless of which account launches it.
	args := []string{"-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", scriptPath}

	pid, err := usersession.RunAsActiveUserElevated("powershell.exe", args)
	if err != nil && errors.Is(err, usersession.ErrElevationNotAvailable) {
		if adminUsername == "" || adminPassword == "" {
			log.Printf("session %s: elevated shell: no linked token and no fallback credentials", sessionID)
			return
		}
		pid, err = usersession.RunAsActiveUserWithCredentials("powershell.exe", args, adminUsername, adminPassword)
	}
	if err != nil {
		log.Printf("session %s: elevated shell: %v", sessionID, err)
		return
	}
	log.Printf("session %s: launched elevated admin shell pid %d", sessionID, pid)
}

// launchScreenShare picks the right usersession launch path. For an
// elevated request it tries the free split-token path first
// (RunAsActiveUserElevated -- Windows' UAC *consent*-prompt equivalent,
// instant, no credentials needed) since an already-admin logged-in user is
// the cheapest, most common case. Only when that specifically reports
// ErrElevationNotAvailable, and an admin username/password were actually
// supplied (resolved server-side from that device's Company Variables,
// CV_LOCAL_ADMIN_USERNAME/CV_LOCAL_ADMIN_PASSWORD -- see
// worker/src/routes/sessions.ts), does it fall back to
// RunAsActiveUserWithCredentials, Beacon's equivalent of the UAC
// *credential* prompt a standard, non-admin user actually sees. A
// standard-user device with no configured fallback credentials still fails
// exactly as it did before this fallback existed.
func launchScreenShare(exePath string, args []string, elevated bool, adminUsername, adminPassword string) (uint32, error) {
	if !elevated {
		return usersession.RunAsActiveUser(exePath, args)
	}
	pid, err := usersession.RunAsActiveUserElevated(exePath, args)
	if err == nil || !errors.Is(err, usersession.ErrElevationNotAvailable) {
		return pid, err
	}
	if adminUsername == "" || adminPassword == "" {
		return 0, err
	}
	log.Printf("screen share: no linked token available, falling back to configured admin credentials")
	return usersession.RunAsActiveUserWithCredentials(exePath, args, adminUsername, adminPassword)
}

// extractScreenShareIfStale writes the embedded beacon-screenshare.exe
// bytes next to the running agent binary if missing or out of date (a
// self-update swaps the agent binary, which carries new embedded bytes;
// this is what picks them up for the next session). Locates the install
// directory via the running binary's own path rather than a duplicated
// constant from agent/internal/service, since that package's installDir is
// unexported and this package has no reason to depend on it.
func extractScreenShareIfStale() (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("screenshare: locate install dir: %w", err)
	}
	dest := filepath.Join(filepath.Dir(self), "beacon-screenshare.exe")

	if existing, err := os.ReadFile(dest); err == nil {
		if sha256.Sum256(existing) == sha256.Sum256(screenShareBinary) {
			return dest, nil
		}
	}

	if err := os.WriteFile(dest, screenShareBinary, 0o755); err != nil {
		return "", fmt.Errorf("screenshare: write %s: %w", dest, err)
	}
	return dest, nil
}
