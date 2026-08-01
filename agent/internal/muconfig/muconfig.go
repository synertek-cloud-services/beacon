// Package muconfig manages the separate "Microsoft Update" service
// registration (the mechanism behind Settings > Windows Update > Advanced
// options > "Receive updates for other Microsoft products when you update
// Windows") -- independent of agent/internal/auconfig, which manages
// Windows' own Automatic Updates client instead. Left unregistered, WUA's
// search (agent/internal/audit/patches.go) never sees Office or other
// Microsoft product updates at all, regardless of anything Beacon's Patch
// Policy scheduling does -- leaving fleet patch coverage incomplete purely
// because nobody ever happened to flip this one native Windows setting by
// hand on a given device.
//
// Shells out to PowerShell against the Microsoft.Update.ServiceManager COM
// object -- the same API-level mechanism the Settings UI itself uses under
// the hood, confirmed via research rather than guessing a registry path
// (unlike auconfig's AU takeover, which does use a well-documented registry
// key; no equivalently well-documented single registry value exists for
// this specific opt-in, so the COM API is the safer choice here).
package muconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

const muconfigTimeout = 30 * time.Second

// The well-known Microsoft Update service GUID -- fixed by Microsoft, not
// something this codebase invents or discovers per-machine.
const microsoftUpdateServiceID = "7971f918-a847-4430-9279-4a52d1efe18d"

// Result is the outcome reported back to the worker (via CommandResult.Stdout,
// same generic-JSON-in-Stdout convention wuinstall/auconfig/discovery already
// use -- no protocol type changes needed for this feature at all).
// PriorRegistered is always the value read immediately BEFORE this call's own
// write (regardless of action) -- the worker persists this on a "manage" so a
// later "revert" can restore the device's real prior state (in case Microsoft
// Update was already independently opted into before Beacon ever touched
// this device) instead of unconditionally unregistering.
type Result struct {
	Applied         bool   `json:"applied"`
	PriorRegistered *bool  `json:"prior_registered,omitempty"`
	Error           string `json:"error,omitempty"`
}

// psResult mirrors the PowerShell scripts' own ConvertTo-Json output
// (PascalCase) -- kept separate from the exported Result (snake_case wire
// tags), same two-struct pattern auconfig/wuinstall already establish.
type psResult struct {
	PriorRegistered *bool  `json:"PriorRegistered"`
	Error           string `json:"Error"`
}

// readSnippet captures whether the service is currently registered before
// any write. Included in both scripts below regardless of action, so the
// worker always gets a fresh snapshot of what was actually there right
// before this command ran.
const readSnippet = `
$sm = New-Object -ComObject Microsoft.Update.ServiceManager
$priorRegistered = $false
foreach ($svc in $sm.Services) { if ($svc.ServiceID -eq '` + microsoftUpdateServiceID + `') { $priorRegistered = $true } }
`

// managePS registers the Microsoft Update service if it isn't already --
// flags 7 = asfAllowPendingRegistration(0x1) + asfAllowOnlineRegistration(0x2)
// + asfRegisterServiceWithAU(0x4), the same flag combination the real
// Settings UI toggle uses.
const managePS = `$ErrorActionPreference = 'Stop'
try {` + readSnippet + `
	if (-not $priorRegistered) {
		$sm.AddService2('` + microsoftUpdateServiceID + `', 7, "") | Out-Null
	}
	[PSCustomObject]@{ PriorRegistered = $priorRegistered; Error = $null } | ConvertTo-Json -Compress
} catch {
	[PSCustomObject]@{ PriorRegistered = $null; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

// revertPS unregisters the service only if the caller-supplied prior state
// (from a previous managePS call's own report) says it wasn't registered
// before Beacon's first takeover -- never removes a registration that
// predates Beacon's own management. %s is always the literal string $true
// or $false, built in Go from a *bool -- never raw external input.
const revertPS = `$ErrorActionPreference = 'Stop'
try {` + readSnippet + `
	if (-not (%s)) {
		try { $sm.RemoveService('` + microsoftUpdateServiceID + `') } catch { }
	}
	[PSCustomObject]@{ PriorRegistered = $priorRegistered; Error = $null } | ConvertTo-Json -Compress
} catch {
	[PSCustomObject]@{ PriorRegistered = $null; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

func boolLiteral(v *bool) string {
	if v == nil || !*v {
		return "$false"
	}
	return "$true"
}

// Apply performs action "manage" or "revert". Windows-only.
func Apply(action string, priorRegistered *bool) Result {
	if runtime.GOOS != "windows" {
		return Result{Error: "Microsoft Update management is Windows-only"}
	}

	var script string
	switch action {
	case "manage":
		script = managePS
	case "revert":
		script = fmt.Sprintf(revertPS, boolLiteral(priorRegistered))
	default:
		return Result{Error: fmt.Sprintf("unknown action %q", action)}
	}

	ctx, cancel := context.WithTimeout(context.Background(), muconfigTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script,
	).Output()
	if err != nil {
		return Result{Error: fmt.Sprintf("running muconfig script: %v", err)}
	}

	var v psResult
	if err := json.Unmarshal(out, &v); err != nil {
		return Result{Error: fmt.Sprintf("parsing muconfig output: %v", err)}
	}
	if v.Error != "" {
		return Result{PriorRegistered: v.PriorRegistered, Error: v.Error}
	}
	return Result{Applied: true, PriorRegistered: v.PriorRegistered}
}
