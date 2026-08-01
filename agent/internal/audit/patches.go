package audit

import (
	"context"
	"encoding/json"
	"log"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

// collectPatches reports pending/missing Windows Update patches. Windows-only
// (matches Datto RMM's own Patch Management scope -- no Linux/macOS
// equivalent). Scan+report only for this v1 slice: no approval state, no
// install action -- the agent never touches the update pipeline, it only
// asks Windows Update what's pending.
func collectPatches() ([]protocol.PatchItem, error) {
	if runtime.GOOS != "windows" {
		return nil, nil
	}
	return collectPatchesWindows()
}

// Uses the native Microsoft.Update.Session COM object (backed by wuapi.dll,
// shipped with every Windows install since XP/Server 2003) -- no
// PSWindowsUpdate module or other external dependency needed, and searching
// (not installing) requires no admin rights. Scans both Software and Driver
// update types (no Type filter in the search criteria at all) -- driver
// updates were originally excluded here entirely as "noisy," an
// unconfirmed scoping call from an earlier session, corrected in a later
// one: the agent now always scans+reports both, tagging each item's own
// Type (Software|Driver); whether a device's *worker*-stored audit actually
// keeps driver-type items is a separate, opt-in Patch Policy decision (see
// worker/src/routes/audit.ts's deviceHasDriverVisibility filtering) --
// deliberately not gated here in agent code, since the agent has no way to
// know per-device Patch Policy coverage at scan time without either
// extending the check-in wire protocol or building new persisted local
// config, both avoided in favor of a worker-side storage-time filter.
//
// Two gotchas that don't show up in this package's other WMI-based
// collectors: the COM collections (Updates/KBArticleIDs/Categories) don't
// serialize via ConvertTo-Json directly -- piping raw COM output yields
// "{}" -- so they're manually unrolled into [PSCustomObject]s first, same
// trick as collectDisplayAdaptersWindows but one level deeper (hence
// -Depth 6, not the default 2). And Search() can genuinely take 10-90+
// seconds on a first run or WSUS-backed box, well past the 15s timeout
// every other collector in this package uses.
//
// "Definition Updates" (Defender AV signature packages) are filtered out
// client-side after the search, not via the WUA search-criteria string --
// IUpdateSearcher's query language only supports CategoryIDs by GUID, not
// friendly category names. Confirmed against a real device's output
// (Beacon session verification): a fully-patched machine's WUA search still
// returned a pending "Security Intelligence Update for Microsoft Defender
// Antivirus" -- these refresh multiple times a day on their own and aren't
// something an admin manages through a patching workflow, so they'd just
// add noise to a "pending patches" list without ever really going away.
// Matches how real patch management tools scope this.
const patchesPS = `$ErrorActionPreference = 'Stop'
try {
	$session  = New-Object -ComObject Microsoft.Update.Session
	$searcher = $session.CreateUpdateSearcher()
	$result   = $searcher.Search("IsInstalled=0 and IsHidden=0")
	$updates = @()
	foreach ($u in $result.Updates) {
		$cats = @(); foreach ($c in $u.Categories) { $cats += $c.Name }
		if ($cats -contains 'Definition Updates') { continue }
		$kbs = @(); foreach ($kb in $u.KBArticleIDs) { $kbs += $kb }
		$typeName = if ($u.Type -eq 2) { 'Driver' } else { 'Software' }
		$updates += [PSCustomObject]@{
			UpdateID = $u.Identity.UpdateID
			Title = $u.Title; KBArticleIDs = $kbs; MsrcSeverity = $u.MsrcSeverity
			Categories = $cats; SizeBytes = $u.MaxDownloadSize; IsDownloaded = $u.IsDownloaded
			Type = $typeName
		}
	}
	[PSCustomObject]@{ Updates = $updates; Error = $null } | ConvertTo-Json -Compress -Depth 6
} catch {
	[PSCustomObject]@{ Updates = @(); Error = $_.Exception.Message } | ConvertTo-Json -Compress
}`

func collectPatchesWindows() ([]protocol.PatchItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", patchesPS,
	).Output()
	if err != nil {
		return nil, err
	}

	var v struct {
		Updates []struct {
			UpdateID     string   `json:"UpdateID"`
			Title        string   `json:"Title"`
			KBArticleIDs []string `json:"KBArticleIDs"`
			MsrcSeverity string   `json:"MsrcSeverity"`
			Categories   []string `json:"Categories"`
			SizeBytes    float64  `json:"SizeBytes"`
			IsDownloaded bool     `json:"IsDownloaded"`
			// "Software" or "Driver" -- WUA's own IUpdate.Type property is a
			// raw UpdateType enum integer (utSoftware=1, utDriver=2), not a
			// string, so the PS script above converts it to a friendly name
			// itself before this even reaches Go, matching how
			// Categories/MsrcSeverity are already friendly strings.
			Type string `json:"Type"`
		} `json:"Updates"`
		Error string `json:"Error"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil, err
	}
	if v.Error != "" {
		// Soft-fail (e.g. wuauserv disabled/broken) -- matches
		// collectBIOSWindows/collectSoftwareWindows's convention of
		// returning nil rather than propagating a hard error that would
		// abort the rest of the audit.
		log.Printf("audit/patches: Windows Update search failed: %s", v.Error)
		return nil, nil
	}

	result := make([]protocol.PatchItem, 0, len(v.Updates))
	for _, u := range v.Updates {
		sev := strings.TrimSpace(u.MsrcSeverity)
		if sev == "" {
			sev = "Unspecified"
		}
		// Lowercase on the wire ('software'/'driver') -- matches this
		// field's own worker-side comparisons (worker/src/routes/audit.ts's
		// p.type === 'driver' filter), unlike Categories/Severity which stay
		// in WUA's own Title Case since they're shown to users as-is.
		patchType := "software"
		if u.Type == "Driver" {
			patchType = "driver"
		}
		result = append(result, protocol.PatchItem{
			UpdateID:     u.UpdateID,
			Title:        strings.TrimSpace(u.Title),
			KBArticleIDs: u.KBArticleIDs,
			Severity:     sev,
			Categories:   u.Categories,
			SizeBytes:    uint64(u.SizeBytes),
			IsDownloaded: u.IsDownloaded,
			Type:         patchType,
		})
	}
	return result, nil
}
