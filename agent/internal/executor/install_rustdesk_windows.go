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

	"github.com/synertek-cloud-services/beacon/agent/internal/protocol"
)

const defaultRustdeskInstallTimeout = 5 * time.Minute

// installedRustdeskPath is where a real RustDesk install actually lands its
// executable -- NOT YET CONFIRMED against a real Windows install, only
// against RustDesk's own documented default install location. Verify this
// (and every other step below marked the same way) against a real device
// before calling this feature done, same standing bar this codebase already
// applies to the rest of Web Remote.
func installedRustdeskPath() string {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	return filepath.Join(programFiles, "RustDesk", "rustdesk.exe")
}

func installRustdesk(cmd protocol.Command, client *protocol.Client, deviceCredential string) protocol.CommandResult {
	result := protocol.CommandResult{CommandID: cmd.CommandID, Status: "failed"}
	var payload installRustdeskPayload
	if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
		result.Stderr = fmt.Sprintf("invalid install_rustdesk payload: %v", err)
		return result
	}
	if payload.DownloadToken == "" || payload.PasswordToken == "" || payload.SizeBytes < 1 {
		result.Stderr = "invalid install_rustdesk payload"
		return result
	}

	stageDir, err := os.MkdirTemp("", "beacon-rustdesk-*")
	if err != nil {
		result.Stderr = fmt.Sprintf("create staging directory: %v", err)
		return result
	}
	defer os.RemoveAll(stageDir)

	installerPath := filepath.Join(stageDir, "rustdesk-installer.exe")
	if err := downloadAndVerifyRustdeskInstaller(client, deviceCredential, payload, installerPath); err != nil {
		result.Stderr = fmt.Sprintf("download installer: %v", err)
		return result
	}

	// The password is redeemed before running anything -- if this fails,
	// nothing has touched the machine yet.
	password, err := client.RedeemRustdeskPassword(deviceCredential, payload.PasswordToken)
	if err != nil {
		result.Stderr = fmt.Sprintf("redeem password: %v", err)
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultRustdeskInstallTimeout)
	defer cancel()

	if out, err := runRustdesk(ctx, installerPath, "--silent-install"); err != nil {
		result.Stderr = fmt.Sprintf("silent install: %v\n%s", err, out)
		return result
	}

	rd := installedRustdeskPath()
	if out, err := runRustdesk(ctx, rd, "--install-service"); err != nil {
		result.Stderr = fmt.Sprintf("install service: %v\n%s", err, out)
		return result
	}
	// NOTE: never logged/returned -- password only ever passed as a live
	// argument to this one process invocation, never written to result.Stdout
	// or result.Stderr on any path below.
	if _, err := runRustdesk(ctx, rd, "--password", password); err != nil {
		result.Stderr = "set unattended password failed"
		return result
	}

	idOut, err := runRustdesk(ctx, rd, "--get-id")
	if err != nil {
		result.Stderr = fmt.Sprintf("get id: %v", err)
		return result
	}
	// Output format not yet confirmed against a real client -- assumed to be
	// the bare ID on stdout, possibly with surrounding whitespace/newline.
	id := strings.TrimSpace(idOut)
	if id == "" {
		result.Stderr = "rustdesk --get-id returned no id"
		return result
	}

	reportJSON, _ := json.Marshal(struct {
		RustdeskID string `json:"rustdesk_id"`
	}{RustdeskID: id})
	result.Status = "completed"
	result.Stdout = string(reportJSON)
	return result
}

func runRustdesk(ctx context.Context, exePath string, args ...string) (string, error) {
	process := exec.CommandContext(ctx, exePath, args...)
	var stdout, stderr bytes.Buffer
	process.Stdout = &stdout
	process.Stderr = &stderr
	err := process.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return stdout.String() + stderr.String(), fmt.Errorf("timed out")
	}
	if err != nil {
		return stdout.String() + stderr.String(), err
	}
	return stdout.String(), nil
}

func downloadAndVerifyRustdeskInstaller(client *protocol.Client, deviceCredential string, payload installRustdeskPayload, destination string) error {
	response, err := client.DownloadRustdeskInstaller(deviceCredential, payload.DownloadToken)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	destinationFile, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o700)
	if err != nil {
		return err
	}
	defer destinationFile.Close()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(destinationFile, hash), response.Body)
	if err != nil {
		return err
	}
	if written != payload.SizeBytes {
		return fmt.Errorf("size mismatch: got %d bytes, expected %d", written, payload.SizeBytes)
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), payload.SHA256) {
		return fmt.Errorf("SHA-256 mismatch")
	}
	return nil
}
