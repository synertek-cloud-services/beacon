//go:build windows

package executor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

const defaultMSITimeout = 15 * time.Minute

func installMSI(cmd protocol.Command, client *protocol.Client, deviceCredential string) protocol.CommandResult {
	result := protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed"}
	var payload installMSIPayload
	if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
		result.Stderr = fmt.Sprintf("invalid MSI payload: %v", err)
		return result
	}
	if payload.Architecture != "amd64" {
		result.Stderr = "unsupported application architecture"
		return result
	}
	if len(payload.Files) == 0 || payload.InstallerFileID == "" {
		result.Stderr = "MSI payload has no installer files"
		return result
	}
	if installed, err := detectionMatches(payload); err != nil {
		result.Stderr = fmt.Sprintf("application detection: %v", err)
		return result
	} else if installed {
		result.Status = "completed"
		result.Stdout = "application already installed (detection matched)"
		return result
	}

	stageDir, err := os.MkdirTemp("", "beacon-application-*")
	if err != nil {
		result.Stderr = fmt.Sprintf("create staging directory: %v", err)
		return result
	}
	defer os.RemoveAll(stageDir)

	paths := make(map[string]string, len(payload.Files))
	usedNames := make(map[string]bool, len(payload.Files))
	for _, file := range payload.Files {
		if file.ID == "" || file.DownloadToken == "" || file.SizeBytes < 1 || !safeStageName(file.OriginalName) {
			result.Stderr = "invalid component file metadata"
			return result
		}
		if usedNames[strings.ToLower(file.OriginalName)] {
			result.Stderr = "component files must have unique names"
			return result
		}
		usedNames[strings.ToLower(file.OriginalName)] = true
		path := filepath.Join(stageDir, file.OriginalName)
		if err := downloadAndVerify(client, deviceCredential, file, path); err != nil {
			result.Stderr = fmt.Sprintf("stage %s: %v", file.OriginalName, err)
			return result
		}
		paths[file.ID] = path
	}

	installerPath, ok := paths[payload.InstallerFileID]
	if !ok {
		result.Stderr = "installer file is not attached"
		return result
	}
	arguments := make([]string, 0, len(payload.InstallerArguments)+2)
	arguments = append(arguments, "/i", installerPath)
	for _, argument := range payload.InstallerArguments {
		expanded, err := expandInstallerArgument(argument, payload.Variables)
		if err != nil {
			result.Stderr = err.Error()
			return result
		}
		arguments = append(arguments, expanded)
	}

	timeout := time.Duration(payload.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = defaultMSITimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	process := exec.CommandContext(ctx, "msiexec.exe", arguments...)
	var stdout, stderr bytes.Buffer
	process.Stdout = &stdout
	process.Stderr = &stderr
	err = process.Run()
	result.Stdout = stdout.String()
	result.Stderr = stderr.String()
	if ctx.Err() == context.DeadlineExceeded {
		result.Stderr += fmt.Sprintf("\n[beacon: MSI install killed after %v]", timeout)
		return result
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
	}
	if err != nil && result.ExitCode != 3010 {
		if result.Stderr == "" {
			result.Stderr = err.Error()
		}
		return result
	}
	if result.ExitCode == 3010 {
		result.Stdout += "\n[beacon: installation succeeded; reboot required]"
	}
	result.Status = "completed"
	return result
}

func safeStageName(name string) bool {
	return name != "" && name != "." && name != ".." && filepath.Base(name) == name && !strings.ContainsAny(name, `\\/`)
}

func downloadAndVerify(client *protocol.Client, deviceCredential string, file componentFile, destination string) error {
	response, err := client.DownloadComponentFile(deviceCredential, file.DownloadToken)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	destinationFile, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer destinationFile.Close()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(destinationFile, hash), response.Body)
	if err != nil {
		return err
	}
	if written != file.SizeBytes {
		return fmt.Errorf("size mismatch: got %d bytes, expected %d", written, file.SizeBytes)
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), file.SHA256) {
		return fmt.Errorf("SHA-256 mismatch")
	}
	return nil
}

func detectionMatches(payload installMSIPayload) (bool, error) {
	switch payload.DetectionType {
	case "", "none":
		return false, nil
	case "msi_product_code":
		if payload.DetectionValue == nil || *payload.DetectionValue == "" {
			return false, fmt.Errorf("missing MSI product code")
		}
		return productCodeInstalled(*payload.DetectionValue), nil
	case "powershell":
		if payload.DetectionValue == nil || *payload.DetectionValue == "" {
			return false, fmt.Errorf("missing PowerShell detection script")
		}
		return exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", *payload.DetectionValue).Run() == nil, nil
	default:
		return false, fmt.Errorf("unknown detection type")
	}
}

func productCodeInstalled(productCode string) bool {
	path := `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\` + productCode
	for _, view := range []uint32{registry.WOW64_64KEY, registry.WOW64_32KEY} {
		key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE|view)
		if err == nil {
			key.Close()
			return true
		}
	}
	return false
}
