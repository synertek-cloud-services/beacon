//go:build windows

package service

import (
	"crypto/sha256"
	_ "embed"
	"log"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/windows"

	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

//go:embed embedded/beacon-tray.exe
var trayBinary []byte

var (
	trayMu          sync.Mutex
	agentVer        string
	lastSession     uint32 = 0xFFFFFFFF // sentinel: nothing launched yet
	lastPID         uint32
	loggedNoSession bool // have we already logged the current no-console-session streak?
)

// SetAgentVersion records the running agent's version string for the tray
// icon's menu label. Must be called once at startup, before the first
// EnsureTrayRunning call -- kept as package-level state (not a parameter to
// EnsureTrayRunning) specifically so EnsureTrayRunning can be called with a
// uniform, no-argument signature from all three of its call sites,
// including the session-change hook in runner_windows.go, which has no
// access to main.go's local version variable.
func SetAgentVersion(v string) {
	trayMu.Lock()
	defer trayMu.Unlock()
	agentVer = v
}

// EnsureTrayRunning makes sure the tray icon is running for whoever's
// currently logged into the active console session, launching or
// relaunching it if needed. Safe to call frequently and from multiple
// goroutines -- extraction and the launch decision are both idempotent.
// Called from three places: once at agent startup, once per check-in loop
// tick (the resilience net -- catches a crashed/killed tray or a missed
// session-change event), and from the session-change hook itself (a
// latency optimization on top of the tick, not a replacement for it).
func EnsureTrayRunning() {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		// Nobody logged in right now -- nothing to do. Not an error; this
		// is a normal, common state (locked... no, locking doesn't trigger
		// this -- see usersession's own doc comment -- but a server with
		// no interactive session, or between logoff and the next logon,
		// genuinely has no active console session). Also the permanent
		// state for a machine only ever accessed via RDP -- v1 targets the
		// console session specifically, an RDP session is a different,
		// unsupported session ID. Logged once per transition into this
		// state (not every 60s tick) so a real "nothing's wrong, there's
		// just no console session to launch into" case is distinguishable
		// in agent.log from "EnsureTrayRunning never got called at all" --
		// the silent version of this looked identical to a hang, caught via
		// real testing on a console-less Vultr VPS reached only by RDP.
		trayMu.Lock()
		alreadyLogged := loggedNoSession
		loggedNoSession = true
		lastSession, lastPID = 0xFFFFFFFF, 0
		trayMu.Unlock()
		if !alreadyLogged {
			log.Printf("service: tray: no active console session (RDP-only access has no console session -- expected, not an error)")
		}
		return
	}
	trayMu.Lock()
	loggedNoSession = false
	trayMu.Unlock()

	trayPath, err := extractTrayIfStale()
	if err != nil {
		log.Printf("service: tray: extract: %v", err)
		return
	}

	trayMu.Lock()
	needsLaunch := sessionID != lastSession || !processAlive(lastPID)
	version := agentVer
	trayMu.Unlock()

	if !needsLaunch {
		return
	}

	// --dashboard-url is deliberately omitted: the agent only knows its own
	// worker URL (--server-url), not the dashboard's -- a different host in
	// production (rmm-api. vs rmm.) -- and there's no existing mechanism for
	// the agent to learn the dashboard URL specifically. The tray's "Visit
	// Dashboard" menu item is already conditional on this flag being set,
	// so it just won't appear -- honest, not a guess that could be wrong.
	args := []string{"--version=" + version}
	pid, err := usersession.RunAsActiveUser(trayPath, args)
	if err != nil {
		if err == usersession.ErrNoActiveSession {
			return
		}
		log.Printf("service: tray: launch: %v", err)
		return
	}

	trayMu.Lock()
	lastSession = sessionID
	lastPID = pid
	trayMu.Unlock()
	log.Printf("service: tray: launched pid %d for session %d", pid, sessionID)
}

// processAlive reports whether pid still refers to a running process.
// PROCESS_QUERY_LIMITED_INFORMATION is enough to read the exit code without
// needing the broader access rights a full PROCESS_QUERY_INFORMATION would
// require.
func processAlive(pid uint32) bool {
	if pid == 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)

	var exitCode uint32
	if err := windows.GetExitCodeProcess(h, &exitCode); err != nil {
		return false
	}
	const stillActive = 259 // STILL_ACTIVE, the documented sentinel GetExitCodeProcess returns for a running process
	return exitCode == stillActive
}

// extractTrayIfStale writes the embedded beacon-tray.exe to the install
// directory if it's missing or its content differs from what's embedded in
// this running agent binary -- covers both first run and picking up a
// newer tray after a self-update swap replaces beacon-agent.exe (and, with
// it, the embedded bytes for next time this function runs).
func extractTrayIfStale() (string, error) {
	dest := filepath.Join(installDir, "beacon-tray.exe")

	if existing, err := os.ReadFile(dest); err == nil {
		if sha256.Sum256(existing) == sha256.Sum256(trayBinary) {
			return dest, nil
		}
	}

	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(dest, trayBinary, 0o755); err != nil {
		return "", err
	}
	return dest, nil
}
