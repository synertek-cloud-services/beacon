//go:build windows

package executor

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
	"github.com/synertek-cloud-services/beacon/agent/internal/usersession"
)

// runScriptAsUser runs p's script in the currently active console user's
// session instead of the agent's own SYSTEM context, via
// usersession.RunAsSession. v1 deliberately targets only the active console
// session, not every RDS/AVD session (see usersession's own v1 scoping) --
// a Job's CommandResult has one stdout/stderr/exit_code slot, and fanning
// out to every active session would need a real protocol change.
//
// CreateProcessAsUser (what RunAsSession wraps) gives no stdout/stderr
// plumbing of its own -- unlike exec.CommandContext's Stdout/Stderr buffers.
// Rather than wiring raw pipe handles across the token boundary (the kind of
// fragile Windows-IPC surface this codebase has already hit real friction
// with elsewhere, see the tray/reboot-marker work's own polled-file choice),
// this wraps the *script content* in a PowerShell redirect block so
// PowerShell writes its own output to two files in C:\Windows\Temp before
// the process ever launches -- the outer process launch stays structurally
// identical to the SYSTEM-context path (just powershell.exe -File script.ps1),
// with no shell-quoting/cmd.exe wrapper involved at all.
//
// This relies on C:\Windows\Temp's default Windows ACL, which grants
// BUILTIN\Users inheritable write rights that apply to new files regardless
// of which principal (SYSTEM or the logged-in user) creates them -- the
// standard mechanism Windows itself uses for exactly this kind of
// SYSTEM-service <-> interactive-user handoff. Not yet verified on real
// hardware; a hardened/GPO-locked-down fleet that strips this default is a
// plausible real-world failure mode, in which case this fails loud (a
// permission error surfaced in Stderr), not silently.
func runScriptAsUser(cmd protocol.Command, p runScriptPayload) protocol.CommandResult {
	result := protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed"}

	if p.Shell != "powershell" {
		result.Stderr = fmt.Sprintf("run-as-user execution only supports the powershell shell (got %q)", p.Shell)
		return result
	}

	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == 0xFFFFFFFF {
		result.Stderr = "no user is currently logged in on the console session"
		return result
	}

	base := filepath.Join(os.TempDir(), "beacon-"+cmd.CommandID)
	outPath := base + ".out"
	errPath := base + ".err"
	defer os.Remove(outPath)
	defer os.Remove(errPath)

	wrapped := fmt.Sprintf("& {\n%s\n} 1> %s 2> %s", p.Script, psQuote(outPath), psQuote(errPath))
	scriptPath, err := writeTempScript(p.Shell, wrapped)
	if err != nil {
		result.Stderr = fmt.Sprintf("temp file: %v", err)
		return result
	}
	defer os.Remove(scriptPath)

	// -ExecutionPolicy Bypass: see the identical comment on the SYSTEM-context
	// path in run.go -- Windows client editions default to Restricted, which
	// blocks -File regardless of which account launches it.
	pid, err := usersession.RunAsSession(sessionID, "powershell.exe",
		[]string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath})
	if err != nil {
		result.Stderr = fmt.Sprintf("launching in user session: %v", err)
		return result
	}

	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_TERMINATE, false, pid)
	if err != nil {
		result.Stderr = fmt.Sprintf("opening launched process: %v", err)
		return result
	}
	defer windows.CloseHandle(handle)

	timeout := p.timeout()
	event, err := windows.WaitForSingleObject(handle, uint32(timeout.Milliseconds()))
	if err != nil {
		result.Stderr = fmt.Sprintf("waiting for process: %v", err)
		return result
	}
	if event == uint32(windows.WAIT_TIMEOUT) {
		windows.TerminateProcess(handle, 1)
		result.Stdout = readBestEffort(outPath)
		result.Stderr = readBestEffort(errPath) + fmt.Sprintf("\n[beacon: script killed after %v]", timeout)
		return result // status stays "failed"
	}

	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		result.Stderr = fmt.Sprintf("reading exit code: %v", err)
		return result
	}

	result.Stdout = readBestEffort(outPath)
	result.Stderr = readBestEffort(errPath)
	result.ExitCode = int(exitCode)
	result.Status = "completed"
	return result
}

// psQuote wraps a path in single quotes for a PowerShell string literal.
// Only ever called with paths this package generates itself (under
// os.TempDir(), keyed by command ID), never user input, so no further
// escaping is needed.
func psQuote(path string) string {
	return "'" + path + "'"
}

func readBestEffort(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}
