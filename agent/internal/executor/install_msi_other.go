//go:build !windows

package executor

import "github.com/synertek-cloud-services/beacon/agent/internal/protocol"

func installMSI(cmd protocol.Command, _ interface{}, _ string) protocol.CommandResult {
	return protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed", Stderr: "MSI installation is only supported on Windows"}
}
