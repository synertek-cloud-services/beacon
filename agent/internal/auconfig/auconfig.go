// Package auconfig manages Windows' own separate "Automatic Updates"
// registry policy (HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU)
// -- distinct from agent/internal/wuinstall, which drives the WUA COM API
// directly and doesn't need Windows' own Automatic Updates client running
// at all. Left enabled, that client can install an update Beacon hasn't
// approved, or reboot outside a configured Patch Policy install window,
// undercutting the whole point of Beacon's approval/scheduling workflow.
//
// Shells out to PowerShell rather than the native x/sys/windows/registry
// package -- matches this codebase's established convention (confirmed:
// there is no existing use of that package anywhere in this agent; every
// other Windows-specific read/write, including WUA itself, shells out to
// PowerShell), same reasoning agent/internal/pingutil and
// agent/internal/wuinstall already document for their own choices.
package auconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

const auconfigTimeout = 30 * time.Second

const auPath = `HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`

// Result is the outcome reported back to the worker (via CommandResult.Stdout,
// same generic-JSON-in-Stdout convention wuinstall/discovery already use --
// no protocol type changes needed for this feature at all). PriorNoAutoUpdate/
// PriorAUOptions are always the values read immediately BEFORE this call's own
// write (regardless of action) -- the worker persists these on a "manage" so a
// later "revert" can restore the device's real prior configuration instead of
// guessing a default.
type Result struct {
	Applied           bool   `json:"applied"`
	PriorNoAutoUpdate *int   `json:"prior_no_auto_update,omitempty"`
	PriorAUOptions    *int   `json:"prior_au_options,omitempty"`
	Error             string `json:"error,omitempty"`
}

// psResult mirrors the PowerShell scripts' own ConvertTo-Json output
// (PascalCase, no snake_case) -- kept separate from the exported Result
// (which has the wire-facing snake_case json tags the worker expects),
// same two-struct pattern agent/internal/wuinstall already establishes.
type psResult struct {
	PriorNoAutoUpdate *int   `json:"PriorNoAutoUpdate"`
	PriorAUOptions    *int   `json:"PriorAUOptions"`
	Error             string `json:"Error"`
}

// readSnippet captures the current values before any write. Included in
// both scripts below regardless of action, so the worker always gets a
// fresh snapshot of what was actually there right before this command ran.
const readSnippet = `
$priorNoAutoUpdate = $null
$priorAUOptions = $null
if (Test-Path '` + auPath + `') {
	$props = Get-ItemProperty -Path '` + auPath + `' -ErrorAction SilentlyContinue
	if ($null -ne $props.NoAutoUpdate) { $priorNoAutoUpdate = $props.NoAutoUpdate }
	if ($null -ne $props.AUOptions) { $priorAUOptions = $props.AUOptions }
}
`

// managePS sets NoAutoUpdate=1 -- takes Windows' own Automatic Updates
// client fully offline. AUOptions is left untouched (moot once
// NoAutoUpdate=1; restored as-is on revert regardless).
const managePS = `$ErrorActionPreference = 'Stop'
try {` + readSnippet + `
	New-Item -Path '` + auPath + `' -Force | Out-Null
	Set-ItemProperty -Path '` + auPath + `' -Name NoAutoUpdate -Value 1 -Type DWord
	[PSCustomObject]@{ PriorNoAutoUpdate = $priorNoAutoUpdate; PriorAUOptions = $priorAUOptions; Error = $null } | ConvertTo-Json -Compress
} catch {
	[PSCustomObject]@{ PriorNoAutoUpdate = $null; PriorAUOptions = $null; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

// revertPS restores the caller-supplied prior values (from a previous
// managePS call's own report), removing a value that didn't exist before
// rather than guessing a default. %s placeholders are always either a bare
// integer literal or the literal string $null, built in Go from an int
// pointer -- never raw external input.
const revertPS = `$ErrorActionPreference = 'Stop'
try {` + readSnippet + `
	if (Test-Path '` + auPath + `') {
		if ($null -eq %s) { Remove-ItemProperty -Path '` + auPath + `' -Name NoAutoUpdate -ErrorAction SilentlyContinue }
		else { Set-ItemProperty -Path '` + auPath + `' -Name NoAutoUpdate -Value %s -Type DWord }
		if ($null -eq %s) { Remove-ItemProperty -Path '` + auPath + `' -Name AUOptions -ErrorAction SilentlyContinue }
		else { Set-ItemProperty -Path '` + auPath + `' -Name AUOptions -Value %s -Type DWord }
	}
	[PSCustomObject]@{ PriorNoAutoUpdate = $priorNoAutoUpdate; PriorAUOptions = $priorAUOptions; Error = $null } | ConvertTo-Json -Compress
} catch {
	[PSCustomObject]@{ PriorNoAutoUpdate = $null; PriorAUOptions = $null; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

func intLiteral(v *int) string {
	if v == nil {
		return "$null"
	}
	return fmt.Sprintf("%d", *v)
}

// Apply performs action "manage" or "revert". Windows-only.
func Apply(action string, priorNoAutoUpdate, priorAUOptions *int) Result {
	if runtime.GOOS != "windows" {
		return Result{Error: "Windows Update management is Windows-only"}
	}

	var script string
	switch action {
	case "manage":
		script = managePS
	case "revert":
		script = fmt.Sprintf(revertPS,
			intLiteral(priorNoAutoUpdate), intLiteral(priorNoAutoUpdate),
			intLiteral(priorAUOptions), intLiteral(priorAUOptions))
	default:
		return Result{Error: fmt.Sprintf("unknown action %q", action)}
	}

	ctx, cancel := context.WithTimeout(context.Background(), auconfigTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script,
	).Output()
	if err != nil {
		return Result{Error: fmt.Sprintf("running auconfig script: %v", err)}
	}

	var v psResult
	if err := json.Unmarshal(out, &v); err != nil {
		return Result{Error: fmt.Sprintf("parsing auconfig output: %v", err)}
	}
	if v.Error != "" {
		return Result{PriorNoAutoUpdate: v.PriorNoAutoUpdate, PriorAUOptions: v.PriorAUOptions, Error: v.Error}
	}
	return Result{Applied: true, PriorNoAutoUpdate: v.PriorNoAutoUpdate, PriorAUOptions: v.PriorAUOptions}
}
