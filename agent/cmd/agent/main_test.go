package main

import (
	"errors"
	"os"
	"runtime"
	"testing"

	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
)

func TestPrepareEnrollmentBootstrapSkipsExistingCredential(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("test path is user-scoped on non-root Unix only")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	if err := credential.Save(&credential.Stored{DeviceID: "device", TenantID: "company", DeviceCredential: "credential"}); err != nil {
		t.Fatalf("Save credential: %v", err)
	}
	if err := prepareEnrollmentBootstrap("https://beacon.example.com", "deployment-token"); err != nil {
		t.Fatalf("prepareEnrollmentBootstrap: %v", err)
	}
	if _, err := credential.LoadEnrollmentBootstrap(); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("LoadEnrollmentBootstrap = %v, want not exist", err)
	}
}
