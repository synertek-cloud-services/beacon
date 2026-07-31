//go:build !windows

package executor

import "github.com/synertek-cloud-services/beacon/agent/internal/protocol"

// runScriptAsUser has no non-Windows implementation -- usersession itself
// (agent/internal/usersession) is Windows-only. This is a real, reachable
// path: a Job can target a mixed-OS fleet with one Execution setting, so a
// non-Windows device can genuinely receive a run_as_system: false command.
// Fails clearly rather than silently falling back to a SYSTEM-context run,
// which would misrepresent what actually happened.
func runScriptAsUser(cmd protocol.Command, _ runScriptPayload) protocol.CommandResult {
	return protocol.CommandResult{
		CommandID: cmd.CommandID,
		Status:    "failed",
		Stderr:    "run-as-user execution is not supported on this platform",
	}
}
