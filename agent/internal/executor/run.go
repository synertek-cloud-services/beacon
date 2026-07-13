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
	Shell          string `json:"shell"`
	Script         string `json:"script"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

// Execute runs a command and returns its result. Unknown types are silently
// ignored — old agents must not choke on new command types added by the server.
func Execute(cmd protocol.Command) protocol.CommandResult {
	switch cmd.Type {
	case "run_script":
		return runScript(cmd)
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

	timeout := time.Duration(p.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = defaultScriptTimeout
	}

	// Write to a temp file so multi-line scripts work without quoting issues
	ext := ".sh"
	if p.Shell == "powershell" {
		ext = ".ps1"
	}
	tmp, err := os.CreateTemp("", "beacon-*"+ext)
	if err != nil {
		result.Stderr = fmt.Sprintf("temp file: %v", err)
		return result
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.WriteString(p.Script); err != nil {
		result.Stderr = fmt.Sprintf("writing script: %v", err)
		return result
	}
	tmp.Close()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var shellCmd *exec.Cmd
	switch p.Shell {
	case "powershell":
		shellCmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-File", tmp.Name())
	case "bash":
		shellCmd = exec.CommandContext(ctx, "bash", tmp.Name())
	default: // "sh" and anything else
		shellCmd = exec.CommandContext(ctx, "sh", tmp.Name())
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
