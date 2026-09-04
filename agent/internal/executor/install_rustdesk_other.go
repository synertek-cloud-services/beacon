//go:build !windows

package executor

import "github.com/synertek-cloud-services/beacon/agent/internal/protocol"

func installRustdesk(cmd protocol.Command, _ interface{}, _ string) protocol.CommandResult {
	return protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed", Stderr: "RustDesk install is only supported on Windows"}
}
