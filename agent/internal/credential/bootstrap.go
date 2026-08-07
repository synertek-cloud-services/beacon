package credential

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const enrollmentBootstrapFilename = "enrollment-bootstrap.json"

// EnrollmentBootstrap is a short-lived handoff from the elevated installer to
// the service's first start. The enrollment token must never be put in the
// service command line, where any local process that can query service config
// could read it.
type EnrollmentBootstrap struct {
	ServerURL string `json:"server_url"`
	Token     string `json:"token"`
}

func enrollmentBootstrapPath() string {
	return filepath.Join(Dir(), enrollmentBootstrapFilename)
}

// SaveEnrollmentBootstrap stores the token only until the agent has created
// its per-device credential. On Windows, restrictEnrollmentBootstrap applies
// a SYSTEM/Administrators-only ACL after the file is created.
func SaveEnrollmentBootstrap(serverURL, token string) error {
	if serverURL == "" || token == "" {
		return fmt.Errorf("server URL and enrollment token are required")
	}

	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return fmt.Errorf("create credential directory: %w", err)
	}

	data, err := json.Marshal(EnrollmentBootstrap{ServerURL: serverURL, Token: token})
	if err != nil {
		return fmt.Errorf("encode enrollment bootstrap: %w", err)
	}

	p := enrollmentBootstrapPath()
	if err := os.WriteFile(p, data, 0o600); err != nil {
		return fmt.Errorf("write enrollment bootstrap: %w", err)
	}
	if err := restrictEnrollmentBootstrap(p); err != nil {
		_ = os.Remove(p)
		return fmt.Errorf("secure enrollment bootstrap: %w", err)
	}
	return nil
}

func LoadEnrollmentBootstrap() (*EnrollmentBootstrap, error) {
	data, err := os.ReadFile(enrollmentBootstrapPath())
	if err != nil {
		return nil, err
	}
	var bootstrap EnrollmentBootstrap
	if err := json.Unmarshal(data, &bootstrap); err != nil {
		return nil, fmt.Errorf("decode enrollment bootstrap: %w", err)
	}
	if bootstrap.ServerURL == "" || bootstrap.Token == "" {
		return nil, fmt.Errorf("enrollment bootstrap is incomplete")
	}
	return &bootstrap, nil
}

func RemoveEnrollmentBootstrap() error {
	return os.Remove(enrollmentBootstrapPath())
}
