//go:build windows

package service

import (
	"crypto/sha256"
	_ "embed"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/windows"

	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

//go:embed embedded/beacon-tray.exe
var trayBinary []byte

// trayRestartInterval is how often each session's tray helper exits and lets
// the supervisor relaunch it with a fresh Shell_NotifyIcon NIM_ADD. This used
// to be a single one-shot restart scheduled only for a session's first
// launch, on the theory that Explorer-notification-area-creation racing
// WTS_SESSION_LOGON was the only way to end up with a blank icon slot. Real
// hardware disproved that: a tray process that had already used its one
// recovery attempt went blank again later, with nothing left watching for
// it. There is no reliable in-process way to detect a blank slot (a
// successful-looking Shell_NotifyIcon call doesn't guarantee Explorer
// actually rendered it), so recovery now runs unconditionally, on an
// ongoing interval, for the life of the session -- trading a brief,
// harmless icon blip every interval for actually bounding how long a blank
// slot can persist, instead of leaving it unbounded.
const trayRestartInterval = 10 * time.Minute

var (
	trayMu          sync.Mutex
	agentVer        string
	supportURL      string // Get Support menu item's destination; "" hides it. See SetSupportURL.
	trayPIDs        = map[uint32]uint32{} // session ID -> tray PID, one entry per currently-tracked active session
	loggedActive    = -1                  // last logged count of active sessions; -1 = never logged yet
	killOrphansOnce sync.Once
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

// SetSupportURL records the current Get Support destination, same
// package-level-state reasoning as SetAgentVersion. Called on every
// successful check-in (agent/cmd/agent/main.go's checkIn(), via its own
// independent GET /v1/branding/identity poll -- not check-in itself), so an
// empty string here correctly clears a previously-configured URL rather
// than leaving a stale one active. Propagation to an already-running tray
// is eventually-consistent, same as agentVer -- a change is only picked up
// on that session's next natural relaunch (the periodic restart interval
// below, or a session logon/logoff), not pushed live.
func SetSupportURL(u string) {
	trayMu.Lock()
	defer trayMu.Unlock()
	supportURL = u
}

// EnsureTrayRunning makes sure every currently-active session has its own
// tray icon running, launching or relaunching per session as needed. Not
// console-specific -- RDS (many concurrent users, console typically
// unused) and AVD/Windows 365 (no console session at all, ever) both need
// every active session covered, not just one special-cased console
// session; see usersession.ActiveSessions' doc comment. Safe to call
// frequently and from multiple goroutines -- extraction and the launch
// decision are both idempotent. Called from three places: once at agent
// startup, once per check-in loop tick (the resilience net -- catches a
// crashed/killed tray or a missed session-change event), and from the
// session-change hook itself (a latency optimization on top of the tick,
// not a replacement for it).
func EnsureTrayRunning() {
	// Runs exactly once per process lifetime, regardless of which of the
	// three call sites gets here first. trayPIDs is in-memory-only and
	// always starts empty on a fresh process -- but a tray launched by a
	// *previous* agent process (self-update swapping the binary, or a
	// restart_agent-triggered service restart) is a separate, detached
	// process tied to its own session, not a child of the service, so it
	// keeps running right through both of those events. Without this,
	// reconciliation below has no way to know that tray already exists and
	// launches a second one alongside it -- confirmed as the real cause of a
	// real duplicate-tray-icon bug seen on two machines this session, both
	// after a self-update and after a manual "Restart Agent" from the
	// dashboard. Killing every beacon-tray.exe instance once, right before
	// this process's first reconciliation pass, guarantees a clean slate;
	// the normal per-session launch logic just below relaunches exactly one
	// per active session and starts tracking it correctly in trayPIDs from
	// that point on -- a momentary icon blip, not a lasting duplicate.
	killOrphansOnce.Do(func() {
		// Same "ignore the error, 'no matching process' isn't a real
		// failure" convention already established by Uninstall()'s own
		// taskkill call in install_windows.go.
		exec.Command("taskkill", "/IM", "beacon-tray.exe", "/F").Run()
	})

	active, err := usersession.ActiveSessions()
	if err != nil {
		log.Printf("service: tray: enumerate active sessions: %v", err)
		return
	}

	// Logged once per transition in the active-session count (0->N, N->0,
	// N->M), not every 60s tick -- so a real "nothing's wrong, there's just
	// nobody logged in right now" case is distinguishable in agent.log from
	// "EnsureTrayRunning never got called at all." The silent version of
	// this looked identical to a hang during real testing on a console-less
	// Vultr VPS reached only by RDP.
	trayMu.Lock()
	if len(active) != loggedActive {
		loggedActive = len(active)
		trayMu.Unlock()
		log.Printf("service: tray: %d active session(s)", len(active))
	} else {
		trayMu.Unlock()
	}

	if len(active) == 0 {
		return
	}

	trayPath, err := extractTrayIfStale()
	if err != nil {
		log.Printf("service: tray: extract: %v", err)
		return
	}

	trayMu.Lock()
	version := agentVer
	support := supportURL
	// Prune tracked sessions that are no longer active -- the tray process
	// ends with its session, nothing to explicitly kill, just stop
	// bookkeeping it so the map doesn't grow forever on a busy RDS box.
	activeSet := make(map[uint32]struct{}, len(active))
	for _, id := range active {
		activeSet[id] = struct{}{}
	}
	for id := range trayPIDs {
		if _, ok := activeSet[id]; !ok {
			delete(trayPIDs, id)
		}
	}
	// --dashboard-url is deliberately omitted: the agent only knows its own
	// worker URL (--server-url), not the dashboard's -- a different host in
	// production (rmm-api. vs rmm.) -- and there's no existing mechanism for
	// the agent to learn the dashboard URL specifically. The tray's "Visit
	// Dashboard" menu item is already conditional on this flag being set,
	// so it just won't appear -- honest, not a guess that could be wrong.
	var toLaunch []uint32
	for _, id := range active {
		if !processAlive(trayPIDs[id]) {
			toLaunch = append(toLaunch, id)
		}
	}
	trayMu.Unlock()

	for _, id := range toLaunch {
		// Every launch -- a session's first or a periodic-restart
		// replacement alike -- gets the same recurring recovery interval;
		// see trayRestartInterval's doc comment for why this is
		// unconditional rather than a one-shot scheduled only for the first
		// launch.
		args := []string{"--version=" + version, "--restart-after=" + trayRestartInterval.String()}
		if support != "" {
			// Rebuilt fresh every reconciliation pass, same as --version --
			// this is what makes multi-session environments and "opens in
			// the logged-in user's session" true for free: every active
			// session gets its own tray launch here, each already running
			// inside that session via RunAsSession below, so its own
			// openBrowser() call naturally opens there too.
			args = append(args, "--support-url="+support)
		}
		pid, err := usersession.RunAsSession(id, trayPath, args)
		if err != nil {
			if err == usersession.ErrNoActiveSession {
				continue // session ended between enumeration and launch -- fine, next tick reconciles
			}
			log.Printf("service: tray: launch for session %d: %v", id, err)
			continue
		}
		trayMu.Lock()
		trayPIDs[id] = pid
		trayMu.Unlock()
		log.Printf("service: tray: launched pid %d for session %d", pid, id)
	}
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
