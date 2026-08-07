package credential

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestEnrollmentBootstrapRoundTrip(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("test path is user-scoped on non-root Unix only")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	if err := SaveEnrollmentBootstrap("https://beacon.example.com", "token-value"); err != nil {
		t.Fatalf("SaveEnrollmentBootstrap: %v", err)
	}

	bootstrap, err := LoadEnrollmentBootstrap()
	if err != nil {
		t.Fatalf("LoadEnrollmentBootstrap: %v", err)
	}
	if bootstrap.ServerURL != "https://beacon.example.com" || bootstrap.Token != "token-value" {
		t.Fatalf("bootstrap = %#v", bootstrap)
	}

	info, err := os.Stat(filepath.Join(Dir(), enrollmentBootstrapFilename))
	if err != nil {
		t.Fatalf("stat bootstrap: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("bootstrap mode = %o, want 600", info.Mode().Perm())
	}

	if err := RemoveEnrollmentBootstrap(); err != nil {
		t.Fatalf("RemoveEnrollmentBootstrap: %v", err)
	}
	if _, err := LoadEnrollmentBootstrap(); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("LoadEnrollmentBootstrap after removal = %v, want not exist", err)
	}
}
