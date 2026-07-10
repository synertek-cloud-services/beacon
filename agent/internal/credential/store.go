package credential

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

type Stored struct {
	DeviceID         string `json:"device_id"`
	TenantID         string `json:"tenant_id"`
	DeviceCredential string `json:"device_credential"`
}

func path() string {
	// When running as a system service (root/SYSTEM), use the system-wide path.
	// Otherwise (local dev, non-root) fall back to the user config dir.
	switch runtime.GOOS {
	case "windows":
		if pd := os.Getenv("PROGRAMDATA"); pd != "" {
			return filepath.Join(pd, "Beacon", "credential.json")
		}
	case "darwin":
		if os.Getuid() == 0 {
			return "/Library/Application Support/Beacon/credential.json"
		}
	default: // linux
		if os.Getuid() == 0 {
			return "/etc/beacon/credential.json"
		}
	}
	// Non-root fallback: ~/.config/beacon/credential.json
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "beacon", "credential.json")
}

func Load() (*Stored, error) {
	data, err := os.ReadFile(path())
	if err != nil {
		return nil, err // os.IsNotExist(err) true when not yet enrolled
	}
	var c Stored
	return &c, json.Unmarshal(data, &c)
}

func Save(c *Stored) error {
	p := path()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	// TODO Phase 1 hardening: encrypt with DPAPI on Windows before writing
	return os.WriteFile(p, data, 0o600)
}
