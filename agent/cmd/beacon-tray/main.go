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
	_ "embed"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/exec"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"fyne.io/systray"
	"github.com/synertek-cloud-services/beacon/agent/internal/rebootmarker"
)

//go:embed assets/icon.ico
var iconData []byte

// dialogActive is 1 while promptReboot's MessageBox is on screen awaiting a
// click. Package-level and atomic because restartForExplorer's periodic
// loop and pollPendingReboot's goroutine both need to observe it, and
// neither should block the other.
var dialogActive int32

func main() {
	version := flag.String("version", "dev", "Beacon agent version to display")
	dashboardURL := flag.String("dashboard-url", "", "Dashboard URL for the 'Visit Dashboard' menu item (item hidden if unset)")
	supportURL := flag.String("support-url", "", "Support destination URL for the 'Get Support' menu item (item hidden if unset)")
	restartInterval := flag.Duration("restart-after", 0, "periodically exit on this interval so the agent supervisor relaunches the tray with a fresh icon registration; 0 disables")
	flag.Parse()

	systray.Run(func() { onReady(*version, *dashboardURL, *supportURL, *restartInterval) }, func() {})
}

func onReady(version, dashboardURL, supportURL string, restartInterval time.Duration) {
	systray.SetIcon(iconData)
	systray.SetTooltip("Beacon Agent " + version)

	label := systray.AddMenuItem("Beacon Agent "+version, "")
	label.Disable()

	// One shared separator covers both optional items below, so a future
	// day where --dashboard-url is finally wired up too (see
	// EnsureTrayRunning's own comment on why it isn't yet) doesn't produce
	// two separators back to back.
	if dashboardURL != "" || supportURL != "" {
		systray.AddSeparator()
	}
	if dashboardURL != "" {
		visit := systray.AddMenuItem("Visit Dashboard", "Open the Beacon dashboard")
		go func() {
			for range visit.ClickedCh {
				openBrowser(dashboardURL)
			}
		}()
	}
	if supportURL != "" {
		// Opened verbatim, with zero device-identifying query params --
		// a hoster who wants smarter PSA routing configures that on their
		// own portal's side. This also directly satisfies "do not expose
		// device credentials in the URL": nothing about the device is ever
		// added to it at all. See CLAUDE.md's Branding section.
		support := systray.AddMenuItem("Get Support", "Open the support destination")
		go func() {
			for range support.ClickedCh {
				openBrowser(supportURL)
			}
		}()
	}

	// Deliberately no Exit item -- see package doc comment. This process is
	// meant to be supervised/relaunched once Step 2 wires the real launch
	// lifecycle, so letting someone dismiss it here would just have it
	// reappear shortly after, confusing UX for no benefit at this stage.

	go pollPendingReboot()
	if restartInterval > 0 {
		go restartForExplorer(restartInterval)
	}
}

// restartForExplorer exits periodically so the agent supervisor's next
// normal check-in tick starts a replacement, which performs a fresh
// Shell_NotifyIcon NIM_ADD rather than SetIcon's NIM_MODIFY. This is
// necessary because a blank slot can survive indefinitely when an NIM_ADD
// raced Explorer's notification area creation; modifying that bad
// registration does not make Explorer render it (confirmed on real
// hardware in v0.2.19, where a 30s SetIcon-only refresh loop left a blank
// icon for over 12 hours).
//
// This used to be a single one-shot restart, scheduled only for a
// session's first tray launch, on the theory that the race is purely a
// startup-timing issue. Real hardware disproved that: a device's tray
// process stayed alive and tracked as healthy by the supervisor's PID
// check, yet its icon went blank again well after that one recovery
// attempt had already fired -- there is no reliable way to detect a blank
// slot from inside this process (Shell_NotifyIcon's return value doesn't
// distinguish a successful-but-not-rendered registration from a genuine
// success), so recovery runs unconditionally on an ongoing interval
// instead of a single guess at how long the race window is.
func restartForExplorer(interval time.Duration) {
	for {
		time.Sleep(interval)
		if atomic.LoadInt32(&dialogActive) != 0 {
			// A reboot-confirmation MessageBox is on screen right now --
			// exiting would yank it out from under whoever is about to
			// click it. Skip this cycle; the next tick reconsiders.
			continue
		}
		// systray.Quit only posts WM_CLOSE to the library's message window.
		// The v0.2.20 real-hardware run showed that message can be lost or
		// left unprocessed, leaving this helper alive forever and
		// preventing the supervisor's replacement launch. This helper owns
		// no privileged state; its process exit makes Windows discard its
		// notification entry and is the reliable handoff signal the
		// service supervisor needs.
		os.Exit(0)
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
// plain bool; it's also read from restartForExplorer's separate goroutine)
// so a second prompt can't stack on top of one still awaiting a response.
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

	var m rebootMarker
	if ret == idYes {
		m = rebootMarker{Confirmed: true}
	} else {
		m = rebootMarker{SnoozedUntil: time.Now().Add(time.Hour).Unix()}
	}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("write reboot response: %v", err)
	}
}

func openBrowser(url string) {
	// "start" needs an empty title argument first, or it treats the URL
	// itself as the window title when the URL contains characters cmd
	// interprets specially.
	exec.Command("cmd", "/c", "start", "", url).Start()
}
