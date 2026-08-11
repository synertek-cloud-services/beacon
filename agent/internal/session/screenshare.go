package session

import (
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"unicode/utf16"

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
// blocking loop -- PowerShell keeps top-level functions defined by whatever
// ran at startup (-EncodedCommand here, same as -File before it) in scope
// for the interactive prompt -NoExit drops into afterward, so this runs
// once automatically on open and can be re-typed ("menu") any time
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

// encodePowerShellCommand base64-encodes script as UTF-16LE, the exact
// format -EncodedCommand requires (undocumented-by-flag-name but
// well-established PowerShell behavior -- no BOM, little-endian UTF-16
// code units, standard base64).
func encodePowerShellCommand(script string) string {
	units := utf16.Encode([]rune(script))
	buf := make([]byte, len(units)*2)
	for i, u := range units {
		buf[i*2] = byte(u)
		buf[i*2+1] = byte(u >> 8)
	}
	return base64.StdEncoding.EncodeToString(buf)
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
	// -EncodedCommand, not -File: real hardware showed -ExecutionPolicy
	// Bypass wasn't reliable either -- Windows client's Restricted default
	// (the original finding) is only one possible cause; a domain machine
	// with an actual Group-Policy-enforced execution policy (the
	// MachinePolicy scope) overrides anything passed on the command line,
	// including -ExecutionPolicy Bypass, so that fix alone doesn't cover
	// every real environment. -EncodedCommand sidesteps the whole class of
	// problem rather than trying to defeat it: PowerShell's execution-policy
	// check only ever applies to loading a *script file* (-File); an inline
	// command (-Command, or this base64 form of it) was never subject to it
	// at any policy scope in the first place -- the same reason
	// install_msi_windows.go's -Command detection script has never needed
	// this flag. Also drops the on-disk beacon-elevated-menu.ps1 file
	// entirely, removing a second, independent real risk this codebase has
	// already been burned by more than once: a predictable, repeatedly
	// rewritten script file is exactly what AV real-time behavioral
	// protection (see Web Remote's own Defender-exclusion history above)
	// tends to flag.
	args := []string{"-NoProfile", "-NoExit", "-EncodedCommand", encodePowerShellCommand(elevatedMenuScript)}

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
