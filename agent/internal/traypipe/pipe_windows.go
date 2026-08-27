//go:build windows

package traypipe

import (
	"context"
	"net"

	winio "github.com/Microsoft/go-winio"
)

// PipeName is the well-known local pipe name, one per machine, shared by
// every tray session -- the server (agent service) distinguishes clients by
// their TypeHello, not by pipe identity. Mirrors service.ServiceName.
const PipeName = `\\.\pipe\BeaconAgent`

// pipeSDDL grants exactly what's needed and nothing more:
//   - D;;GA;;;NU  explicit deny, Generic All, to the NETWORK logon SID --
//     blocks any remote \\host\pipe\BeaconAgent connection attempt over
//     SMB/IPC$ regardless of which account authenticates. This is the
//     standard named-pipe hardening for a pipe that should only ever be
//     reachable from the local machine.
//   - A;;GA;;;SY  Generic All to SYSTEM (the server's own account) --
//     redundant with SYSTEM's implicit owner/creator rights, stated
//     explicitly for auditability.
//   - A;;GA;;;BA  Generic All to built-in Administrators, for future
//     admin-run diagnostic tooling without needing a second SDDL revision.
//   - A;;GRGW;;;BU  Generic Read + Generic Write only (no delete, no
//     DACL-change rights) to BUILTIN\Users -- the unprivileged token the
//     tray runs under (usersession.RunAsSession). BUILTIN\Users rather than
//     the broader Authenticated Users, since this pipe only ever needs to
//     be reachable by a locally logged-in account.
const pipeSDDL = "D:(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;BU)"

// Listen starts the pipe server. Only the agent service (SYSTEM) calls this.
func Listen() (net.Listener, error) {
	return winio.ListenPipe(PipeName, &winio.PipeConfig{
		SecurityDescriptor: pipeSDDL,
		InputBufferSize:    4096,
		OutputBufferSize:   4096,
	})
}

// Dial connects to the pipe server as a client. Only beacon-tray.exe calls
// this.
func Dial(ctx context.Context) (net.Conn, error) {
	return winio.DialPipeContext(ctx, PipeName)
}
