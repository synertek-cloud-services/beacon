package audit

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// collectHyperVHost reports whether this device has the Hyper-V role
// (Windows Server) or feature (Windows client Pro/Enterprise/Education)
// installed -- i.e. whether it's a virtualization *host*, not a guest (see
// hardware.go's detectVirtualization for the opposite, already-existing
// guest-side check). Windows-only, matches Patch Management's own scope.
// Feeds worker/src/lib/patchPolicies.ts's deviceMatchesPatchPolicy, which
// unconditionally excludes Hyper-V hosts from a policy's automatic
// Server-class/company sweep -- see that function's own comment for why
// this has no opt-out toggle.
//
// Returns nil (not false) on non-Windows or any collection failure --
// distinct from a confirmed "not a Hyper-V host" -- so a transient PowerShell
// failure can never accidentally flip a real host to appear un-excluded.
func collectHyperVHost() (*bool, error) {
	if runtime.GOOS != "windows" {
		return nil, nil
	}
	return collectHyperVHostWindows()
}

// The Virtual Machine Management Service (vmms) is installed by both the
// Server "Hyper-V" role and the client "Hyper-V Platform" optional feature
// -- its mere presence (regardless of Running/Stopped state) is the
// standard signal that the role/feature is installed, the same check
// third-party inventory tools use. A 15s timeout matches this package's
// other simple WMI/service-query collectors (collectServices, etc.), well
// under collectPatches' 180s since this is a single fast service lookup,
// not a WUA search.
const hyperVHostPS = `$svc = Get-Service -Name vmms -ErrorAction SilentlyContinue
if ($svc) { 'true' } else { 'false' }`

func collectHyperVHostWindows() (*bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", hyperVHostPS,
	).Output()
	if err != nil {
		return nil, err
	}

	result := strings.TrimSpace(string(out)) == "true"
	return &result, nil
}
