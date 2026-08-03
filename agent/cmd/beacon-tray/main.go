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
// Usage: beacon-tray.exe [--version=X.Y.Z] [--dashboard-url=https://...]
package main

import (
	_ "embed"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/exec"
	"time"

	"golang.org/x/sys/windows"

	"fyne.io/systray"
	"github.com/synertek-cloud-services/beacon/agent/internal/rebootmarker"
)

//go:embed assets/icon.ico
var iconData []byte

func main() {
	version := flag.String("version", "dev", "Beacon agent version to display")
	dashboardURL := flag.String("dashboard-url", "", "Dashboard URL for the 'Visit Dashboard' menu item (item hidden if unset)")
	flag.Parse()

	systray.Run(func() { onReady(*version, *dashboardURL) }, func() {})
}

func onReady(version, dashboardURL string) {
	systray.SetIcon(iconData)
	systray.SetTooltip("Beacon Agent " + version)

	label := systray.AddMenuItem("Beacon Agent "+version, "")
	label.Disable()

	if dashboardURL != "" {
		systray.AddSeparator()
		visit := systray.AddMenuItem("Visit Dashboard", "Open the Beacon dashboard")
		go func() {
			for range visit.ClickedCh {
				openBrowser(dashboardURL)
			}
		}()
	}

	// Deliberately no Exit item -- see package doc comment. This process is
	// meant to be supervised/relaunched once Step 2 wires the real launch
	// lifecycle, so letting someone dismiss it here would just have it
	// reappear shortly after, confusing UX for no benefit at this stage.

	go pollPendingReboot()
	go periodicIconRefresh()
}

// periodicIconRefresh re-issues SetIcon (a NIM_MODIFY call under the hood,
// confirmed from fyne.io/systray's own source -- not NIM_ADD, so this never
// risks creating a second icon) every 30s, indefinitely, for as long as
// this process runs.
//
// Works around a real, confirmed-on-hardware Windows shell race (seen on
// Nebuchadnezzar across multiple reboots): this process is launched into
// the user's session via usersession.RunAsSession from the
// WTS_SESSION_LOGON hook, which fires at logon and can race explorer.exe's
// own taskbar/notification-area window creation. Per Microsoft's own "The
// Taskbar" docs, the TaskbarCreated broadcast this library already listens
// for ("generally applies only to services that are already running when
// the Shell launches" -- exactly this process's situation) is a one-shot
// signal sent once, when explorer creates its taskbar; if this process's
// message window isn't already pumping at that exact instant, the
// broadcast is missed for good and nothing else ever prompts a retry. The
// observed symptom (icon launches into the correct session --
// Get-Process confirms session/PID -- but the notification area shows a
// blank reserved slot, not a missing one, and not hidden in the overflow
// flyout) matches Shell_NotifyIcon's own known behavior of sometimes
// accepting a registration without successfully rendering it when
// explorer.exe is itself still mid-startup.
//
// Deliberately an indefinite periodic re-assertion, not a one-shot delayed
// retry with a guessed wait time -- this codebase has been burned more than
// once by guessed fixed delays around Windows timing races (see
// SelfUninstall's timeout/ping saga in CLAUDE.md); a cheap NIM_MODIFY call
// every 30s forever self-heals regardless of how long the real race window
// turns out to be on a given machine, with no need to ever detect that the
// blank-slot state occurred in the first place.
func periodicIconRefresh() {
	for range time.Tick(30 * time.Second) {
		systray.SetIcon(iconData)
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
// main.go for why. A simple bool guard (not a mutex; this only ever runs
// on this one goroutine) keeps a second prompt from stacking on top of one
// still awaiting a response.
func pollPendingReboot() {
	dialogShowing := false
	for range time.Tick(30 * time.Second) {
		if dialogShowing {
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

		dialogShowing = true
		go func() {
			defer func() { dialogShowing = false }()
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
