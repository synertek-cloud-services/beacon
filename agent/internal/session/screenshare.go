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
	args := []string{
		"-NoExit",
		"-Command",
		"Write-Host 'Beacon -- Elevated administrative session. Anything you run from here (Task Manager, Control Panel, Services, installers, the registry) runs elevated with no further prompts.' -ForegroundColor Cyan",
	}

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
