package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

const defaultScriptTimeout = 5 * time.Minute

type runScriptPayload struct {
	Shell          string            `json:"shell"`
	Script         string            `json:"script"`
	TimeoutSeconds int               `json:"timeout_seconds"`
	Variables      map[string]string `json:"variables,omitempty"`
	// RunAsSystem is a pointer, not a bool: an absent JSON field (every
	// caller that predates this option -- Quick Job, a direct single-device
	// POST /commands) must default to true/system, matching jobs.run_as_system's
	// own DB default. A plain bool's zero value would silently flip those
	// callers to run-as-user instead.
	RunAsSystem *bool `json:"run_as_system,omitempty"`
}

func (p runScriptPayload) runAsSystem() bool {
	return p.RunAsSystem == nil || *p.RunAsSystem
}

func (p runScriptPayload) timeout() time.Duration {
	t := time.Duration(p.TimeoutSeconds) * time.Second
	if t <= 0 {
		return defaultScriptTimeout
	}
	return t
}

// writeTempScript writes content to a fresh temp file with the extension
// matching shell, returning its path. Shared between the SYSTEM-context path
// (runScript) and the Windows run-as-user path (runScriptAsUser), which
// wraps content in a redirect block before calling this.
func writeTempScript(shell, content string) (string, error) {
	ext := ".sh"
	if shell == "powershell" {
		ext = ".ps1"
	}
	tmp, err := os.CreateTemp("", "beacon-*"+ext)
	if err != nil {
		return "", err
	}
	defer tmp.Close()

	// Windows PowerShell 5.1 has no reliable way to detect a BOM-less script's
	// encoding and falls back to the system codepage, not UTF-8 -- any
	// non-ASCII byte (smart quotes, em/en dashes, accented characters) gets
	// silently misdecoded, which can corrupt string literals and break
	// parsing entirely (a real bug hit via the seeded "Restart Agent"
	// ComStore component's em dash). A UTF-8 BOM makes Windows PowerShell
	// interpret the file as UTF-8 unambiguously. bash/sh scripts need no
	// equivalent -- they're UTF-8 by default with no BOM detection quirk.
	if shell == "powershell" {
		content = "\ufeff" + content
	}
	if _, err := tmp.WriteString(content); err != nil {
		return "", err
	}
	return tmp.Name(), nil
}

// Execute runs a command and returns its result. Unknown types are silently
// ignored — old agents must not choke on new command types added by the server.
func Execute(cmd protocol.Command, client *protocol.Client, deviceCredential string) protocol.CommandResult {
	switch cmd.Type {
	case "run_script":
		return runScript(cmd)
	case "install_msi":
		return installMSI(cmd, client, deviceCredential)
	case "install_rustdesk":
		return installRustdesk(cmd, client, deviceCredential)
	default:
		return protocol.CommandResult{CommandID: cmd.CommandID, Status: "completed"}
	}
}

func runScript(cmd protocol.Command) protocol.CommandResult {
	result := protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed"}

	var p runScriptPayload
	if err := json.Unmarshal(cmd.Payload, &p); err != nil {
		result.Stderr = fmt.Sprintf("invalid payload: %v", err)
		return result
	}

	// run_as_system: false hands off to the platform-specific run-as-user
	// path (real on Windows via agent/internal/usersession, a clear-failure
	// stub everywhere else) -- the build tags on runScriptAsUser's two
	// implementations are the actual platform gate, not a runtime GOOS
	// check here.
	if !p.runAsSystem() {
		return runScriptAsUser(cmd, p)
	}

	timeout := p.timeout()

	tmpPath, err := writeTempScript(p.Shell, p.Script)
	if err != nil {
		result.Stderr = fmt.Sprintf("temp file: %v", err)
		return result
	}
	defer os.Remove(tmpPath)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var shellCmd *exec.Cmd
	switch p.Shell {
	case "powershell":
		// -ExecutionPolicy Bypass: Windows client editions (10/11) default
		// PowerShell's execution policy to Restricted, which refuses to load
		// any local .ps1 file via -File regardless of who's running it --
		// confirmed on real hardware via a real UnauthorizedAccess error
		// ("running scripts is disabled on this system"). Windows Server
		// defaults to RemoteSigned instead, which already allows this, so
		// this gap only ever surfaced against a real client-desktop target.
		// Bypass only overrides this one process's own session-scoped
		// policy check -- it never touches the machine's actual configured
		// policy (registry/Group Policy), same as a technician manually
		// passing -ExecutionPolicy Bypass at an elevated prompt would.
		shellCmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpPath)
	case "bash":
		shellCmd = exec.CommandContext(ctx, "bash", tmpPath)
	default: // "sh" and anything else
		shellCmd = exec.CommandContext(ctx, "sh", tmpPath)
	}

	if len(p.Variables) > 0 {
		env := os.Environ()
		for k, v := range p.Variables {
			env = append(env, k+"="+v)
		}
		shellCmd.Env = env
	}

	var stdout, stderr bytes.Buffer
	shellCmd.Stdout = &stdout
	shellCmd.Stderr = &stderr

	runErr := shellCmd.Run()
	result.Stdout = stdout.String()
	result.Stderr = stderr.String()

	if ctx.Err() == context.DeadlineExceeded {
		result.Stderr += fmt.Sprintf("\n[beacon: script killed after %v]", timeout)
		return result // status stays "failed"
	}

	// Non-zero exit code is still "completed" — the script ran, it just failed
	if exitErr, ok := runErr.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
	}
	result.Status = "completed"
	return result
}
