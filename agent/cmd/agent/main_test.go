package main

import (
	"errors"
	"os"
	"runtime"
	"testing"
	"time"

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

func TestJitteredStaysWithinTenPercent(t *testing.T) {
	for _, base := range []time.Duration{60 * time.Second, connectedInterval} {
		lo, hi := base-base/10, base+base/10
		sawBelow, sawAbove := false, false
		for i := 0; i < 5000; i++ {
			d := jittered(base)
			if d < lo || d > hi {
				t.Fatalf("jittered(%v) = %v, outside [%v, %v]", base, d, lo, hi)
			}
			if d < base {
				sawBelow = true
			} else if d > base {
				sawAbove = true
			}
		}
		if !sawBelow || !sawAbove {
			t.Fatalf("jittered(%v) never varied both ways", base)
		}
	}
	if got := jittered(0); got != 0 {
		t.Fatalf("jittered(0) = %v, want 0", got)
	}
}

func TestConnectedIntervalWithJitterStaysUnderOnlineWindow(t *testing.T) {
	// The dashboard calls a device online for 5 minutes after its last check-in.
	if max := connectedInterval + connectedInterval/10; max >= 5*time.Minute {
		t.Fatalf("worst-case connected interval %v reaches the 5-minute online window", max)
	}
}
