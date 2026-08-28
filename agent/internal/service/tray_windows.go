//go:build windows

package service

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"golang.org/x/sys/windows"

	"github.com/synertek-cloud-services/beacon/agent/internal/traypipe"
	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

//go:embed embedded/beacon-tray.exe
var trayBinary []byte

var (
	trayMu     sync.Mutex
	agentVer   string
	supportURL string                // Get Support menu item's destination; "" hides it. See SetSupportURL.
	trayPIDs   = map[uint32]uint32{} // session ID -> tray PID, bootstrap/fallback liveness signal only for the
	// brief window before a session's first pipe Hello (or if the pipe server itself never started) -- see
	// EnsureTrayRunning's reconciliation loop, which now prefers connections over this.
	connections       = map[uint32]*traypipe.Conn{} // session ID -> live pipe connection; the authoritative liveness signal
	loggedActive      = -1                          // last logged count of active sessions; -1 = never logged yet
	killOrphansOnce   sync.Once
	pipeServerStarted bool // not sync.Once -- a transient Listen() failure (e.g. a self-update handoff window) should retry on the next tick, not fail forever
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
	agentVer = v
	trayMu.Unlock()
	broadcastVersionInfo()
}

// SetSupportURL records the current Get Support destination, same
// package-level-state reasoning as SetAgentVersion. Called on every
// successful check-in (agent/cmd/agent/main.go's checkIn(), via its own
// independent GET /v1/branding/identity poll -- not check-in itself), so an
// empty string here correctly clears a previously-configured URL rather
// than leaving a stale one active. Pushed live to every connected tray via
// broadcastVersionInfo -- no more waiting for that session's next natural
// relaunch.
func SetSupportURL(u string) {
	trayMu.Lock()
	supportURL = u
	trayMu.Unlock()
	broadcastVersionInfo()
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

	startPipeServer()

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
	for id, c := range connections {
		if _, ok := activeSet[id]; !ok {
			c.Close()
			delete(connections, id)
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
		// A live pipe connection is authoritative ground truth -- strictly
		// better than a bare PID number, which can't distinguish "the tray
		// we launched" from "some unrelated process later recycled onto the
		// same PID." trayPIDs/processAlive are kept as the fallback signal
		// for the brief window before a freshly-launched tray's first Hello
		// arrives, and as the sole signal if the pipe server itself never
		// started.
		if connections[id] == nil && !processAlive(trayPIDs[id]) {
			toLaunch = append(toLaunch, id)
		}
	}
	trayMu.Unlock()

	for _, id := range toLaunch {
		// No --restart-after here (removed) -- blank-icon recovery now
		// happens in-process, inside beacon-tray itself, via a bounded
		// startup-window systray.Readd() retry (see
		// agent/cmd/beacon-tray/main.go's recoverBlankIcon). The tray
		// process for a session is only relaunched here when it's actually
		// dead (crashed, or the session itself ended and came back) --
		// this loop no longer needs to know anything about icon recovery.
		args := []string{"--version=" + version}
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

// startPipeServer starts the traypipe listener if it isn't already running.
// Deliberately retryable (guarded by a plain bool, not sync.Once) rather
// than a permanent give-up on the first failure -- a transient "pipe busy"
// right after a self-update handoff, before the old process's listener has
// fully torn down, should just retry on the next EnsureTrayRunning tick
// (<=60s later, same cadence as everything else in this loop).
func startPipeServer() {
	trayMu.Lock()
	if pipeServerStarted {
		trayMu.Unlock()
		return
	}
	trayMu.Unlock()

	ln, err := traypipe.Listen()
	if err != nil {
		log.Printf("service: tray: pipe listen: %v (will retry)", err)
		return
	}

	trayMu.Lock()
	pipeServerStarted = true
	trayMu.Unlock()

	go runPipeServer(ln)
}

// runPipeServer accepts pipe connections for the life of the process.
func runPipeServer(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("service: tray: pipe accept: %v", err)
			return
		}
		go handleConn(conn)
	}
}

// handleConn services one tray client's connection until it disconnects.
// The first message must be TypeHello identifying the session -- anything
// else and there's nothing meaningful to do with this connection, so it's
// dropped.
func handleConn(rawConn net.Conn) {
	c := traypipe.NewConn(rawConn)
	defer c.Close()

	msg, err := c.Recv()
	if err != nil || msg.Type != traypipe.TypeHello {
		log.Printf("service: tray: pipe connection didn't send hello first, dropping")
		return
	}
	var hello traypipe.HelloPayload
	if err := json.Unmarshal(msg.Payload, &hello); err != nil {
		log.Printf("service: tray: pipe hello: %v", err)
		return
	}

	trayMu.Lock()
	// A fresh Hello for a session that already has a connection replaces
	// it -- the natural "last connection wins" reconnect semantics; the old
	// entry, if still open, will simply error out on its next Recv.
	connections[hello.SessionID] = c
	version, support := agentVer, supportURL
	trayMu.Unlock()

	log.Printf("service: tray: pipe connected for session %d (pid %d)", hello.SessionID, hello.PID)

	if err := c.Send(traypipe.TypeVersionInfo, traypipe.VersionInfoPayload{
		Version:    version,
		SupportURL: support,
	}); err != nil {
		log.Printf("service: tray: pipe send version_info: %v", err)
	}
	// Covers a session connecting (or reconnecting) after a reboot prompt
	// already started -- the tray restarting mid-prompt, or a fresh RDP
	// session, shouldn't have to wait for a snooze-expiry re-broadcast to
	// see it.
	if rebootPromptOutstanding() {
		if err := c.Send(traypipe.TypeRebootPrompt, traypipe.RebootPromptPayload{}); err != nil {
			log.Printf("service: tray: pipe send reboot_prompt: %v", err)
		}
	}

	for {
		msg, err := c.Recv()
		if err != nil {
			break
		}
		switch msg.Type {
		case traypipe.TypeRebootResponse:
			handleRebootResponse(msg.Payload)
		default:
			log.Printf("service: tray: pipe: unhandled message type %q from session %d", msg.Type, hello.SessionID)
		}
	}

	trayMu.Lock()
	if connections[hello.SessionID] == c {
		delete(connections, hello.SessionID)
	}
	trayMu.Unlock()
	log.Printf("service: tray: pipe disconnected for session %d", hello.SessionID)
}

// broadcastVersionInfo pushes the current version/support-URL state to
// every connected tray. Safe to call even when nothing's connected yet
// (SetAgentVersion/SetSupportURL are called well before the first
// EnsureTrayRunning/pipe-connect cycle completes).
func broadcastVersionInfo() {
	trayMu.Lock()
	version, support := agentVer, supportURL
	conns := make([]*traypipe.Conn, 0, len(connections))
	for _, c := range connections {
		conns = append(conns, c)
	}
	trayMu.Unlock()

	for _, c := range conns {
		if err := c.Send(traypipe.TypeVersionInfo, traypipe.VersionInfoPayload{
			Version:    version,
			SupportURL: support,
		}); err != nil {
			log.Printf("service: tray: pipe broadcast version_info: %v", err)
		}
	}
}
