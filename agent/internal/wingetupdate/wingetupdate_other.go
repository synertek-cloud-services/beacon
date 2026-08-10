//go:build !windows

package wingetupdate

// Result mirrors the Windows build's shape so callers need no build-tag
// branching of their own.
type Result struct {
	Ran    []string `json:"ran"`
	Output string   `json:"output"`
	AllOK  bool     `json:"all_ok"`
	Error  string   `json:"error,omitempty"`
}

// Upgrade is a real, reachable stub outside Windows -- winget has no
// equivalent on Linux/macOS. Same "a Job/command can target a mixed-OS
// fleet with one action, a non-Windows device fails clearly instead of
// silently no-opping" pattern already established by
// agent/internal/executor/install_msi_other.go and run_as_user_other.go.
func Upgrade(packageIDs []string) Result {
	return Result{Error: "winget-based Software Management is Windows-only"}
}
