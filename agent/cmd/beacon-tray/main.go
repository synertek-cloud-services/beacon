//go:build windows

// beacon-tray is a standalone, Windows-only tray icon helper -- deliberately
// separate from the beacon-agent service binary, since it must run inside a
// user's own session (Session 0 Isolation means the SYSTEM-context service
// can never show UI directly). Step 1 only: proves the icon itself renders
// correctly and is launchable both directly and via
// agent/internal/usersession's impersonated-token path. No IPC, no dynamic
// content, no real launch lifecycle (session-change hooking, supervision,
// embedding into beacon-agent.exe) yet -- those are separate, later passes.
//
// Usage: beacon-tray.exe [--version=X.Y.Z] [--dashboard-url=https://...] [--support-url=https://...]
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"flag"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"fyne.io/systray"
	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
	"github.com/synertek-cloud-services/beacon/agent/internal/rebootmarker"
	"github.com/synertek-cloud-services/beacon/agent/internal/traypipe"
	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

//go:embed assets/icon.ico
var iconData []byte

// dialogActive is 1 while promptReboot's MessageBox is on screen awaiting a
// click. Package-level and atomic because pollPendingReboot's loop and the
// goroutine it spawns to show the dialog both need to observe it (so a
// second prompt can't stack on top of one still awaiting a response), and
// neither should block the other.
var dialogActive int32

func main() {
	// This is a -H=windowsgui binary with no console, and until now had no
	// logging setup at all -- every log.Printf call went to the default
	// os.Stderr, which goes nowhere anyone can ever see. Found live: a
	// real device stuck reporting "clicking Yes does nothing" turned out
	// to be a silent Access Denied writing the reboot-response marker
	// back (see promptReboot's own doc comment) -- completely invisible
	// because there was no log anywhere to show it. Same setupLogging
	// pattern already proven in agent/cmd/agent and
	// agent/cmd/beacon-screenshare, writing to its own beacon-tray.log --
	// deliberately not sharing agent.log or beacon-screenshare.log, same
	// "give this file its own independent shot at opening cleanly"
	// reasoning already established for those two. f is listed first in
	// the MultiWriter (not os.Stderr) from day one here, learning
	// directly from the real bug found in the other two binaries: os.Stderr
	// is commonly invalid for a process with no console, and MultiWriter
	// stops at the first writer that errors -- os.Stderr first would have
	// silently blocked every write to the file that actually matters.
	setupLogging(credential.Dir())

	version := flag.String("version", "dev", "Beacon agent version to display")
	dashboardURL := flag.String("dashboard-url", "", "Dashboard URL for the 'Visit Dashboard' menu item (item hidden if unset)")
	supportURL := flag.String("support-url", "", "Support destination URL for the 'Get Support' menu item (item hidden if unset)")
	flag.Parse()

	systray.Run(func() { onReady(*version, *dashboardURL, *supportURL) }, func() {})
}

// setupLogging mirrors agent/cmd/agent/main.go's function of the same name
// (see that copy's own doc comment for the full lost-startup-race
// background) -- try once synchronously, then retry every 5s indefinitely
// in the background until it succeeds, writing to this binary's own
// beacon-tray.log. Not extracted into a shared package: three independent
// ~15-line copies is this codebase's existing convention for this exact
// function (agent/cmd/agent, agent/cmd/beacon-screenshare), not worth a
// shared dependency for.
func setupLogging(credDir string) {
	if err := os.MkdirAll(credDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(credDir, "beacon-tray.log")
	if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
		return
	}
	go func() {
		for {
			time.Sleep(5 * time.Second)
			f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				continue
			}
			log.SetOutput(io.MultiWriter(f, os.Stderr))
			log.Printf("beacon-tray.log opened (delayed -- initial attempt lost a startup sharing-mode race)")
			return
		}
	}()
}

// menuState holds everything the pipe client can push a live update to,
// guarded by menuMu since updates arrive on the pipe read goroutine while
// clicks fire from systray's own goroutines.
var (
	menuMu       sync.Mutex
	curVersion   string
	curSupport   string
	curDashboard string
)

func onReady(version, dashboardURL, supportURL string) {
	menuMu.Lock()
	curVersion, curSupport, curDashboard = version, supportURL, dashboardURL
	menuMu.Unlock()

	systray.SetIcon(iconData)
	systray.SetTooltip("Beacon Agent " + version)

	label := systray.AddMenuItem("Beacon Agent "+version, "")
	label.Disable()

	// Always added, up front -- a live pipe push can change support/dashboard
	// URLs on an already-running tray, so both items (and the separator
	// covering them) need to exist from the start to be shown/hidden later,
	// rather than being conditionally created only once at launch.
	systray.AddSeparator()
	visit := systray.AddMenuItem("Visit Dashboard", "Open the Beacon dashboard")
	go func() {
		for range visit.ClickedCh {
			menuMu.Lock()
			url := curDashboard
			menuMu.Unlock()
			if url != "" {
				openBrowser(url)
			}
		}
	}()
	// Opened verbatim, with zero device-identifying query params -- a
	// hoster who wants smarter PSA routing configures that on their own
	// portal's side. This also directly satisfies "do not expose device
	// credentials in the URL": nothing about the device is ever added to
	// it at all. See CLAUDE.md's Branding section.
	support := systray.AddMenuItem("Get Support", "Open the support destination")
	go func() {
		for range support.ClickedCh {
			menuMu.Lock()
			url := curSupport
			menuMu.Unlock()
			if url != "" {
				openBrowser(url)
			}
		}
	}()
	applyMenuVisibility(label, visit, support, version, dashboardURL, supportURL)

	// Deliberately no Exit item -- see package doc comment. This process is
	// meant to be supervised/relaunched once Step 2 wires the real launch
	// lifecycle, so letting someone dismiss it here would just have it
	// reappear shortly after, confusing UX for no benefit at this stage.

	go pollPendingReboot()
	go recoverBlankIcon()
	go runPipeClient(label, visit, support)
}

// applyMenuVisibility pushes version/support/dashboard state onto the
// actual tray UI -- the one place that touches label/visit/support
// directly, called both from onReady (initial CLI-flag snapshot) and from
// the pipe client on every TypeVersionInfo push, so the two paths can never
// drift out of sync with each other.
func applyMenuVisibility(label, visit, support *systray.MenuItem, version, dashboardURL, supportURL string) {
	systray.SetTooltip("Beacon Agent " + version)
	label.SetTitle("Beacon Agent " + version)
	if dashboardURL != "" {
		visit.Show()
	} else {
		visit.Hide()
	}
	if supportURL != "" {
		support.Show()
	} else {
		support.Hide()
	}
}

// runPipeClient connects to the agent service's named pipe and stays
// connected for the life of the process, redialing with a short backoff on
// any disconnect. PipeName is a fixed, well-known constant (not tied to a
// particular server process), so an agent-service restart (self-update,
// restart_agent) needs no coordination on this side at all -- the old
// process's pipe instance tears down the moment it exits, this loop's
// current Recv errors out immediately, and the next Dial finds whichever
// process is listening now.
var pipeReconnectDelays = []time.Duration{1 * time.Second, 2 * time.Second, 5 * time.Second}

func runPipeClient(label, visit, support *systray.MenuItem) {
	sessionID, err := usersession.CurrentSessionID()
	if err != nil {
		log.Printf("pipe client: determine current session: %v", err)
		return
	}

	attempt := 0
	for {
		conn, err := traypipe.Dial(context.Background())
		if err != nil {
			delay := pipeReconnectDelays[min(attempt, len(pipeReconnectDelays)-1)]
			attempt++
			time.Sleep(delay)
			continue
		}
		attempt = 0

		c := traypipe.NewConn(conn)
		if err := c.Send(traypipe.TypeHello, traypipe.HelloPayload{
			SessionID: sessionID,
			PID:       uint32(os.Getpid()),
		}); err != nil {
			log.Printf("pipe client: send hello: %v", err)
			c.Close()
			continue
		}

		handlePipeConn(c, label, visit, support) // blocks until Recv errors (disconnect)
		c.Close()
	}
}

// handlePipeConn dispatches messages from one live pipe connection until it
// disconnects.
func handlePipeConn(c *traypipe.Conn, label, visit, support *systray.MenuItem) {
	for {
		msg, err := c.Recv()
		if err != nil {
			return
		}
		switch msg.Type {
		case traypipe.TypeVersionInfo:
			var v traypipe.VersionInfoPayload
			if err := json.Unmarshal(msg.Payload, &v); err != nil {
				continue
			}
			menuMu.Lock()
			curVersion, curSupport, curDashboard = v.Version, v.SupportURL, v.DashboardURL
			menuMu.Unlock()
			applyMenuVisibility(label, visit, support, v.Version, v.DashboardURL, v.SupportURL)
		// TypeRebootPrompt handling lands in a follow-up change alongside the
		// reboot-marker migration; the file-based pollPendingReboot below is
		// still what drives the reboot prompt for now.
		default:
			log.Printf("pipe client: unhandled message type %q", msg.Type)
		}
	}
}

// blankIconRecoveryDelays are how long after launch to force a fresh
// Shell_NotifyIcon registration via systray.Readd() (NIM_DELETE followed by
// NIM_ADD, from this same still-running window -- no process exit, no
// relaunch). This targets one specific, narrow, real race: WTS_SESSION_LOGON
// can fire before Explorer's own taskbar/notification-area window is fully
// up, and a NIM_ADD that lands before that window exists can silently
// reserve a slot without Explorer ever rendering into it -- confirmed on
// real hardware in v0.2.19, where a 30s SetIcon-only (NIM_MODIFY) refresh
// loop left a blank icon for over 12 hours, since a modify assumes the slot
// is already correctly registered and can't repair one that never was.
//
// Bounded to the first couple of minutes after launch, not unconditional or
// forever. An earlier design (v0.2.20-v0.2.21, and everything up through
// PR #162) instead exited the whole process on a repeating 10-minute timer
// for the entire life of the session, relying on the agent service's own
// up-to-60s reconciliation tick to notice and relaunch it. Real-hardware
// reports kept recurring anyway, and the reason is structural, not another
// missed edge case in that mechanism: every single one of those cycles
// deregisters the icon (a real Shell_NotifyIcon(NIM_DELETE), confirmed
// correct since PR #162) and then leaves it genuinely absent for up to a
// minute before anything re-adds it -- which is exactly the vanish-and-
// reappear pattern Windows' own taskbar is documented to render as a blank
// placeholder for an icon it remembers being pinned/positioned. The
// mechanism built to fix the blank-icon bug was, every 10 minutes for as
// long as any session stayed open, manufacturing the precise condition that
// triggers it. See CLAUDE.md's Architecture section for the full history.
//
// There is still no reliable way to detect a blank slot from inside this
// process (Shell_NotifyIcon's return value doesn't distinguish a
// successful-but-unrendered registration from a genuine success), so this
// stays a blind, multi-attempt retry rather than a single guess -- just
// bounded to the window where the actual race lives, and done in-process so
// each attempt has no gap at all, rather than run forever and rely on an
// external supervisor to close a real one. A genuine later-session Explorer
// restart doesn't need this: systray's own WM_TASKBARCREATED handler
// already re-adds automatically, with no gap and no guesswork, since that's
// a real event being responded to rather than a startup timing race being
// guessed around.
var blankIconRecoveryDelays = []time.Duration{
	10 * time.Second,
	20 * time.Second, // 30s since launch
	30 * time.Second, // 60s
	60 * time.Second, // 120s, then stop
}

func recoverBlankIcon() {
	for _, d := range blankIconRecoveryDelays {
		time.Sleep(d)
		systray.Readd()
	}
}

// rebootMarker mirrors agent/cmd/agent/main.go's own copy -- small enough
// (and JSON, not a real API contract) not to be worth a shared package for,
// matching this codebase's existing convention of duplicating small
// structs across independent binaries rather than introducing shared
// dependencies for them.
type rebootMarker struct {
	CreatedAt    int64 `json:"created_at"`
	SnoozedUntil int64 `json:"snoozed_until"`
	Confirmed    bool  `json:"confirmed"`
}

const (
	idYes = 6 // well-known, stable Win32 MessageBox return value -- not wrapped in golang.org/x/sys/windows
	idNo  = 7
)

// pollPendingReboot checks every 30s for a pending-reboot marker written by
// the agent after a patch install that reported RebootRequired. Polled
// state, not a named pipe -- see the marker type's own doc comment in
// main.go for why. Guarded by the package-level dialogActive flag (not a
// plain bool; it's also read/written from the goroutine promptReboot runs
// on) so a second prompt can't stack on top of one still awaiting a
// response.
func pollPendingReboot() {
	for range time.Tick(30 * time.Second) {
		if atomic.LoadInt32(&dialogActive) != 0 {
			continue
		}
		path := rebootmarker.Path()
		if path == "" {
			return // shouldn't happen -- this binary is Windows-only -- but bail cleanly if it ever does
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue // no marker -- nothing pending
		}
		var m rebootMarker
		if err := json.Unmarshal(data, &m); err != nil {
			continue
		}
		if m.Confirmed {
			continue // already confirmed, just waiting on the agent to act on it
		}
		now := time.Now().Unix()
		if m.SnoozedUntil != 0 && now < m.SnoozedUntil {
			continue // still snoozed
		}

		atomic.StoreInt32(&dialogActive, 1)
		go func() {
			defer atomic.StoreInt32(&dialogActive, 0)
			promptReboot(path)
		}()
	}
}

// promptReboot shows the actual Yes/No dialog and writes the user's choice
// back to the marker file. MessageBox blocks the calling goroutine until
// dismissed, which is why this runs on its own goroutine rather than the
// polling loop itself. MB_YESNO's buttons are the generic "Yes"/"No" --
// golang.org/x/sys/windows doesn't wrap TaskDialogIndirect (the Win32 API
// that supports custom button labels like "Restart Now"/"Postpone"), and
// hand-rolling that raw syscall isn't worth it for a v1 cosmetic upgrade,
// so the button meaning is spelled out in the message text instead.
func promptReboot(path string) {
	title, _ := windows.UTF16PtrFromString("Beacon Agent")
	text, _ := windows.UTF16PtrFromString(
		"A recent patch install requires a restart.\n\nClick Yes to restart now, or No to be reminded again in an hour.")
	ret, err := windows.MessageBox(0, text, title, windows.MB_YESNO|windows.MB_ICONWARNING)
	if err != nil {
		log.Printf("reboot prompt: %v", err)
		return
	}

	// Re-read the existing marker rather than building one from a bare
	// literal, so CreatedAt (and any other field this ever grows) survives
	// the round trip instead of silently zeroing out -- found alongside
	// the agent-side pollPendingReboot fix, harmless today since nothing
	// reads CreatedAt back yet, but a real correctness gap in this
	// write-back regardless.
	var m rebootMarker
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &m) // best-effort; a malformed marker just falls back to the zero value below
	}
	if ret == idYes {
		m.Confirmed = true
	} else {
		m.Confirmed = false
		m.SnoozedUntil = time.Now().Add(time.Hour).Unix()
	}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		// Root-caused live: this runs inside the logged-in user's own
		// token (usersession.RunAsSession), and installDir's ACL grants
		// BUILTIN\Users only ReadAndExecute, never write -- deliberately
		// locked down for the rest of Beacon's install, but this one file
		// specifically needs a non-admin user to be able to write back to
		// it. A standard (non-admin) user's write here failed with Access
		// Denied every single time, silently (this binary had no logging
		// at all before now), leaving the marker stuck at confirmed:false
		// forever no matter how many times Yes was clicked. The real fix
		// is agent-side (writePendingRebootMarker grants BUILTIN\Users
		// write access to this one file via icacls at creation time, see
		// its own doc comment) -- this log line is what makes a
		// recurrence on an unpatched/pre-fix device actually visible
		// instead of a silent dead end.
		log.Printf("write reboot response: %v", err)
	}
}

func openBrowser(url string) {
	// "start" needs an empty title argument first, or it treats the URL
	// itself as the window title when the URL contains characters cmd
	// interprets specially.
	exec.Command("cmd", "/c", "start", "", url).Start()
}
