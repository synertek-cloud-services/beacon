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
// (not installing) requires no admin rights. Type='Software' deliberately
// excludes driver updates -- noisy, not what "patch management" means to an
// admin; easy to widen later.
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
	$result   = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
	$updates = @()
	foreach ($u in $result.Updates) {
		$cats = @(); foreach ($c in $u.Categories) { $cats += $c.Name }
		if ($cats -contains 'Definition Updates') { continue }
		$kbs = @(); foreach ($kb in $u.KBArticleIDs) { $kbs += $kb }
		$updates += [PSCustomObject]@{
			UpdateID = $u.Identity.UpdateID
			Title = $u.Title; KBArticleIDs = $kbs; MsrcSeverity = $u.MsrcSeverity
			Categories = $cats; SizeBytes = $u.MaxDownloadSize; IsDownloaded = $u.IsDownloaded
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
		result = append(result, protocol.PatchItem{
			UpdateID:     u.UpdateID,
			Title:        strings.TrimSpace(u.Title),
			KBArticleIDs: u.KBArticleIDs,
			Severity:     sev,
			Categories:   u.Categories,
			SizeBytes:    uint64(u.SizeBytes),
			IsDownloaded: u.IsDownloaded,
		})
	}
	return result, nil
}
