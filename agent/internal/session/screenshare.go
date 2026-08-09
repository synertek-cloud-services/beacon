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
func runScreenShare(sessionID, wsURL string, elevated bool) {
	exePath, err := extractScreenShareIfStale()
	if err != nil {
		log.Printf("session %s: screen share: %v", sessionID, err)
		return
	}

	args := []string{
		"--session-id=" + sessionID,
		"--ws-url=" + wsURL,
	}

	launch := usersession.RunAsActiveUser
	if elevated {
		launch = usersession.RunAsActiveUserElevated
	}

	pid, err := launch(exePath, args)
	if err != nil {
		switch {
		case errors.Is(err, usersession.ErrNoActiveSession):
			// Nobody logged in -- expected no-op, matches v1's own scope
			// (logged-in-user desktop capture only). The browser's own
			// connect timeout is what surfaces this to the technician;
			// nothing needs to travel back over this path.
			log.Printf("session %s: screen share: no active console session", sessionID)
		case errors.Is(err, usersession.ErrElevationNotAvailable):
			// Not an administrator, or UAC disabled -- expected, common,
			// not a crash. Same "the browser's own connect timeout
			// surfaces this" reasoning as the no-active-session case
			// above: there's no way for the worker to have known ahead of
			// time whether this would work, and building a fast explicit
			// failure round trip for one button is new protocol machinery
			// this feature doesn't otherwise need. errors.Is, not direct
			// equality -- runAsToken wraps this sentinel with %w alongside
			// the underlying GetLinkedToken error for context.
			log.Printf("session %s: screen share: elevation not available: %v", sessionID, err)
		default:
			log.Printf("session %s: screen share launch: %v", sessionID, err)
		}
		return
	}
	log.Printf("session %s: launched beacon-screenshare pid %d (elevated=%v)", sessionID, pid, elevated)
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
