package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	checkInterval = 24 * time.Hour
	gracePeriod   = 10 * time.Minute
)

// checkInC is closed or sent on when the agent successfully checks in.
// Buffered so NotifyCheckIn never blocks.
var checkInC = make(chan struct{}, 1)

// NotifyCheckIn is called from main after every successful check-in.
// If an update confirmation is pending, this clears it.
func NotifyCheckIn() {
	select {
	case checkInC <- struct{}{}:
	default:
	}
}

type versionResponse struct {
	LatestVersion   string  `json:"latest_version"`
	UpdateAvailable bool    `json:"update_available"`
	DownloadURL     *string `json:"download_url"`
	SignatureHex    *string `json:"signature_hex"`
}

type updateState struct {
	PendingVersion string `json:"pending_version"`
	BackupPath     string `json:"backup_path"`
	DeadlineUnix   int64  `json:"deadline_unix"`
}

// Start begins the self-update goroutine. Call once from main after enrollment.
// serverURL is the Beacon worker base URL (e.g. https://beacon.example.com).
// currentVersion is the version string embedded in the binary (e.g. "0.1.0").
// credDir is the directory where update-state.json will be written.
func Start(serverURL, currentVersion, credDir string) {
	exe, err := os.Executable()
	if err != nil || isDevBuild(exe) {
		log.Printf("updater: disabled (dev build or unresolved path)")
		return
	}

	statePath := filepath.Join(credDir, "update-state.json")

	// If a previous update swap wrote a state file, wait for check-in confirmation
	// before the regular check interval begins.
	if state, err := loadState(statePath); err == nil {
		go awaitConfirmation(exe, state, statePath)
		return // awaitConfirmation schedules the next check after confirming
	}

	go runLoop(serverURL, currentVersion, credDir, exe, statePath)
}

func runLoop(serverURL, currentVersion, credDir, exe, statePath string) {
	// Stagger the first check so all agents don't hammer the worker simultaneously.
	time.Sleep(5 * time.Minute)

	for {
		if err := checkAndApply(serverURL, currentVersion, credDir, exe, statePath); err != nil {
			log.Printf("updater: %v", err)
		}
		time.Sleep(checkInterval)
	}
}

// awaitConfirmation waits for the first successful check-in after an update.
// If none arrives before the deadline, it rolls back.
func awaitConfirmation(exe string, state updateState, statePath string) {
	deadline := time.Unix(state.DeadlineUnix, 0)
	log.Printf("updater: awaiting confirmation of update to %s (deadline %s)", state.PendingVersion, deadline.Format(time.RFC3339))

	select {
	case <-checkInC:
		log.Printf("updater: update to %s confirmed", state.PendingVersion)
		os.Remove(statePath)
		os.Remove(state.BackupPath)
	case <-time.After(time.Until(deadline)):
		log.Printf("updater: update to %s unconfirmed — rolling back", state.PendingVersion)
		if err := rollback(exe, state.BackupPath); err != nil {
			log.Printf("updater: rollback failed: %v", err)
		}
	}
}

func checkAndApply(serverURL, currentVersion, credDir, exe, statePath string) error {
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	url := fmt.Sprintf("%s/v1/agent/version?os=%s&arch=%s&current=%s", serverURL, goos, goarch, currentVersion)
	resp, err := http.Get(url) //nolint:gosec // URL built from known-safe components
	if err != nil {
		return fmt.Errorf("version check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil // no version published for this platform yet
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("version check: HTTP %d", resp.StatusCode)
	}

	var vr versionResponse
	if err := json.NewDecoder(resp.Body).Decode(&vr); err != nil {
		return fmt.Errorf("version check decode: %w", err)
	}

	if !vr.UpdateAvailable {
		log.Printf("updater: already at latest (%s)", currentVersion)
		return nil
	}
	if vr.DownloadURL == nil || vr.SignatureHex == nil {
		return fmt.Errorf("version check: missing download_url or signature_hex")
	}

	log.Printf("updater: new version %s available — downloading", vr.LatestVersion)
	return applyUpdate(exe, statePath, vr.LatestVersion, *vr.DownloadURL, *vr.SignatureHex)
}

func applyUpdate(exe, statePath, version, downloadURL, sigHex string) error {
	newPath := exe + ".new"

	if err := downloadFile(downloadURL, newPath); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("download: %w", err)
	}

	if err := verifyBinary(newPath, sigHex); err != nil {
		os.Remove(newPath)
		return err
	}

	backupPath := exe + ".prev"
	state := updateState{
		PendingVersion: version,
		BackupPath:     backupPath,
		DeadlineUnix:   time.Now().Add(gracePeriod).Unix(),
	}
	if err := saveState(statePath, state); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("save state: %w", err)
	}

	log.Printf("updater: applying %s — restarting", version)

	// atomicSwap does not return on success; it replaces the process.
	if err := atomicSwap(exe, newPath, backupPath); err != nil {
		os.Remove(newPath)
		os.Remove(statePath)
		return fmt.Errorf("swap: %w", err)
	}
	return nil
}

func downloadFile(url, dest string) error {
	resp, err := http.Get(url) //nolint:gosec
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func loadState(path string) (updateState, error) {
	var s updateState
	data, err := os.ReadFile(path)
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(data, &s)
}

func saveState(path string, s updateState) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// isDevBuild detects go run and similar ephemeral build paths.
func isDevBuild(exe string) bool {
	return strings.Contains(exe, "go-build") || strings.Contains(exe, "/T/")
}
