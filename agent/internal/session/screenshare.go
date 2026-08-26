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
// OS-specific call this file makes (usersession.RunAsActiveUser/
// RunAsSessionAsSystem) already has a no-op stub on non-Windows, so this
// whole package stays cross-platform buildable with zero extra files.
//
//go:embed embedded/beacon-screenshare.exe
var screenShareBinary []byte

// runScreenShare launches the embedded beacon-screenshare.exe into a
// target desktop session, passing it the session ID and relay WebSocket
// URL to dial itself. It never dials the relay from this (SYSTEM-context)
// process -- see Handle's comment for why.
//
// elevated requests the "Elevate" escalation: launches beacon-screenshare
// with the agent service's own SYSTEM token instead of the logged-in
// user's, attached to the same session's desktop -- see
// usersession.RunAsSessionAsSystem's doc comment for why this, not an
// Administrator token, is what "Elevate" actually needs to deliver: SYSTEM
// is the one privilege level that can open and interact with Windows'
// secure desktop (where a UAC consent/credential prompt renders), which no
// Administrator token, split-token or not, can do. Deliberately not the
// default -- always launching as SYSTEM would mean every Web Remote
// session carries full, unrestricted machine access on the target, a real
// security-posture cost for a capability most sessions never need.
//
// A non-elevated request still transparently falls back to a SYSTEM-context
// launch (see launchScreenShare) when there's nobody logged into the target
// session at all -- e.g. a Windows 11 machine sitting at its logon screen,
// or a session between logoff and the next sign-in. This is a different
// decision from Elevate, not a quiet expansion of it: Elevate escalates
// past a real, present user, a genuine security-posture tradeoff kept
// opt-in for exactly that reason; here there is no user to escalate past,
// and SYSTEM is the only context that can attach to anything at all (the
// Winlogon logon/lock desktop specifically requires SYSTEM to open --
// see win32.OpenInputDesktop's own doc comment). If a user then logs in
// during the session, the already-running helper's own desktop-follow
// (rfbserver.DesktopFollower, screencapture/screeninject's
// FollowInputDesktop) picks up the hand-off to their real desktop on its
// own, with no reconnect needed.
//
// targetSessionID picks which Windows Terminal Services session to launch
// into -- nil means the active console session (today's only behavior,
// and the only one client-class devices ever use); a non-nil value is a
// specific RDS/AVD session ID a technician picked from a Server-class
// device's session list (see the worker's list_remote_sessions flow).
//
// reportToken/monitor are both screen_share-specific, forwarded straight
// through as flags -- see beacon-screenshare's own main.go for what it
// does with them (reports enumerated monitors back to the worker, and
// picks which one to actually capture). Empty reportToken/monitor are
// valid: a shell/tcp_tunnel session never reaches this function at all
// (see Handle's own special-casing), and an empty monitor means "capture
// the primary monitor," today's only behavior.
//
// requireConsent (issue #86) forwards as --require-consent, only when
// true -- the helper shows an Accept/Decline prompt and reports the
// outcome via reportToken before ever dialing the relay when set; when
// false (the default, and every pre-existing caller), it dials
// immediately exactly as before this feature existed.
func runScreenShare(sessionID, wsURL string, elevated bool, targetSessionID *uint32, reportToken, monitor string, requireConsent bool) {
	exePath, err := extractScreenShareIfStale()
	if err != nil {
		log.Printf("session %s: screen share: %v", sessionID, err)
		return
	}

	args := []string{
		"--session-id=" + sessionID,
		"--ws-url=" + wsURL,
	}
	if reportToken != "" {
		args = append(args, "--report-token="+reportToken)
	}
	if monitor != "" {
		args = append(args, "--monitor="+monitor)
	}
	if requireConsent {
		args = append(args, "--require-consent")
	}

	pid, err := launchScreenShare(exePath, args, elevated, targetSessionID)
	if err != nil {
		if errors.Is(err, usersession.ErrNoActiveSession) {
			// launchScreenShare already falls back to a SYSTEM-context
			// launch whenever there's simply no user logged in yet -- this
			// remaining case means the target session itself couldn't be
			// resolved at all (mid-transition, or a stale/no-longer-active
			// targetSessionID), genuinely nothing to launch into. Expected,
			// rare no-op; the browser's own connect timeout is what
			// surfaces this to the technician, nothing needs to travel back
			// over this path.
			log.Printf("session %s: screen share: no active session", sessionID)
		} else {
			log.Printf("session %s: screen share launch: %v", sessionID, err)
		}
		return
	}
	log.Printf("session %s: launched beacon-screenshare pid %d (elevated=%v, targetSessionID=%v)", sessionID, pid, elevated, targetSessionID)
}

// launchScreenShare picks the right usersession launch path: the logged-in
// user's own token for a plain session, or the agent service's own SYSTEM
// token (relocated to the target session) for an elevated one. No
// credential resolution happens here at all -- unlike the Administrator-
// token mechanism this replaced, SYSTEM needs nothing beyond the token the
// calling process already holds.
//
// A nil targetSessionID (every caller before this option existed, and
// every client-class device today) resolves to the active console session
// exactly as before -- this branch is unchanged from the original,
// already-real-hardware-relevant behavior. A non-nil value launches into
// that specific session instead, reusing usersession.RunAsSession/
// RunAsSessionAsSystem's own general (non-console-only) form, which
// already accepts an arbitrary session ID.
//
// Both non-elevated branches fall back to a SYSTEM-context launch on
// usersession.ErrNoActiveSession -- see runScreenShare's doc comment for
// why this isn't the same privilege decision Elevate makes. The fallback
// targets the exact same session ID the user-context attempt just failed
// against (re-resolved via ActiveConsoleSessionID for the console case,
// since RunAsActiveUser doesn't hand its resolved ID back on failure); if
// that resolution itself fails too (console session transitioning, or
// truly nothing attached), there's genuinely nothing to launch into and
// the original error is returned unchanged.
func launchScreenShare(exePath string, args []string, elevated bool, targetSessionID *uint32) (uint32, error) {
	if targetSessionID != nil {
		if !elevated {
			pid, err := usersession.RunAsSession(*targetSessionID, exePath, args)
			if errors.Is(err, usersession.ErrNoActiveSession) {
				log.Printf("session: no user logged into session %d yet, launching as SYSTEM instead", *targetSessionID)
				return usersession.RunAsSessionAsSystem(*targetSessionID, exePath, args)
			}
			return pid, err
		}
		return usersession.RunAsSessionAsSystem(*targetSessionID, exePath, args)
	}
	if !elevated {
		pid, err := usersession.RunAsActiveUser(exePath, args)
		if errors.Is(err, usersession.ErrNoActiveSession) {
			sessionID, sessErr := usersession.ActiveConsoleSessionID()
			if sessErr != nil {
				return 0, err
			}
			log.Printf("session: no user logged into the console session yet, launching as SYSTEM instead")
			return usersession.RunAsSessionAsSystem(sessionID, exePath, args)
		}
		return pid, err
	}
	sessionID, err := usersession.ActiveConsoleSessionID()
	if err != nil {
		return 0, err
	}
	return usersession.RunAsSessionAsSystem(sessionID, exePath, args)
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
