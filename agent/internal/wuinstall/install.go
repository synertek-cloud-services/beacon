// Package wuinstall installs specific, already-approved Windows Updates via
// the native WUA COM API -- the install counterpart to audit.collectPatches
// (scan-only). Windows-only, same as the rest of Beacon's patch pipeline.
package wuinstall

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// ItemResult is the outcome for one requested update.
type ItemResult struct {
	UpdateID string `json:"update_id"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

// Result is the overall outcome of an install run.
type Result struct {
	Results        []ItemResult `json:"results"`
	RebootRequired bool         `json:"reboot_required"`
	Error          string       `json:"error,omitempty"` // set on a hard failure before any per-update attempt
}

// updateIDPattern guards against building a PowerShell script from anything
// that isn't actually a WUA UpdateID GUID -- update_ids ultimately originate
// from an admin-triggered dashboard action, but defense in depth costs
// nothing here: reject anything that doesn't look like a GUID before it ever
// reaches a shelled-out script, rather than trusting the caller.
var updateIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// installTimeout is generous relative to audit.collectPatches's 180s search
// timeout -- downloading and installing multiple updates in one batch can
// genuinely take several minutes, not seconds.
const installTimeout = 15 * time.Minute

// Install downloads and installs the given WUA updates (by UpdateID) and
// reports per-update success/failure plus whether a reboot is now needed.
// Windows-only; returns a Result with Error set (not a Go error) for
// anything that isn't a plain "couldn't even start" failure, so a partial
// per-update outcome is never silently discarded.
func Install(updateIDs []string) Result {
	if runtime.GOOS != "windows" {
		return Result{Error: "patch install is Windows-only"}
	}

	var valid []string
	for _, id := range updateIDs {
		if updateIDPattern.MatchString(id) {
			valid = append(valid, id)
		}
	}
	if len(valid) == 0 {
		return Result{Error: "no valid update IDs provided"}
	}

	return installWindows(valid)
}

// The script re-searches (WUA has no find-by-ID lookup -- confirmed against
// the COM API), filters to just the requested UpdateIDs into a fresh
// UpdateColl, downloads, then installs. AllowSourcePrompts is explicitly
// disabled -- defensive, since the agent runs headless as SYSTEM with no
// interactive session to prompt in the first place. Runs as SYSTEM (the
// agent's own service identity, agent/internal/service/install_windows.go)
// -- WUA install requires admin rights, which SYSTEM already has; no
// elevation gotcha here, this is the same mechanism WSUS/SCCM/every other
// RMM's patch install uses.
const installPS = `$ErrorActionPreference = 'Stop'
try {
	$targetIds = @(%s)
	$session   = New-Object -ComObject Microsoft.Update.Session
	$searcher  = $session.CreateUpdateSearcher()
	$result    = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")

	$toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
	foreach ($u in $result.Updates) {
		if ($targetIds -contains $u.Identity.UpdateID) { $toInstall.Add($u) | Out-Null }
	}

	if ($toInstall.Count -eq 0) {
		[PSCustomObject]@{ Items = @(); RebootRequired = $false; Error = "none of the requested updates are currently pending" } | ConvertTo-Json -Compress
		exit 0
	}

	$downloader = $session.CreateUpdateDownloader()
	$downloader.Updates = $toInstall
	$downloader.Download() | Out-Null

	$installer = $session.CreateUpdateInstaller()
	$installer.AllowSourcePrompts = $false
	$installer.Updates = $toInstall
	$installResult = $installer.Install()

	$items = @()
	for ($i = 0; $i -lt $toInstall.Count; $i++) {
		$ur = $installResult.GetUpdateResult($i)
		$items += [PSCustomObject]@{
			UpdateID = $toInstall.Item($i).Identity.UpdateID
			Success  = ($ur.ResultCode -eq 2)
			HResult  = $ur.HResult
		}
	}
	[PSCustomObject]@{ Items = $items; RebootRequired = [bool]$installResult.RebootRequired; Error = $null } | ConvertTo-Json -Compress -Depth 4
} catch {
	[PSCustomObject]@{ Items = @(); RebootRequired = $false; Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

func installWindows(updateIDs []string) Result {
	quoted := make([]string, len(updateIDs))
	for i, id := range updateIDs {
		quoted[i] = "'" + id + "'"
	}
	script := fmt.Sprintf(installPS, strings.Join(quoted, ","))

	ctx, cancel := context.WithTimeout(context.Background(), installTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script,
	).Output()
	if err != nil {
		return Result{Error: fmt.Sprintf("running install script: %v", err)}
	}

	var v struct {
		Items []struct {
			UpdateID string `json:"UpdateID"`
			Success  bool   `json:"Success"`
			HResult  int64  `json:"HResult"`
		} `json:"Items"`
		RebootRequired bool   `json:"RebootRequired"`
		Error          string `json:"Error"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return Result{Error: fmt.Sprintf("parsing install result: %v", err)}
	}
	if v.Error != "" {
		return Result{Error: v.Error}
	}

	items := make([]ItemResult, 0, len(v.Items))
	for _, it := range v.Items {
		ir := ItemResult{UpdateID: it.UpdateID, Success: it.Success}
		if !it.Success {
			ir.Error = fmt.Sprintf("install failed, HResult 0x%08x", uint32(it.HResult))
		}
		items = append(items, ir)
	}
	return Result{Results: items, RebootRequired: v.RebootRequired}
}
