package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWritePrivateKeyCreatesRestrictedFileAndRefusesOverwrite(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "signing.key")
	if err := writePrivateKey(path, privateKey); err != nil {
		t.Fatalf("writePrivateKey: %v", err)
	}

	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(contents)); len(got) != ed25519.PrivateKeySize*2 {
		t.Fatalf("stored key has %d hex characters, want %d", len(got), ed25519.PrivateKeySize*2)
	}

	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("key mode = %o, want 600", got)
		}
	}

	if err := writePrivateKey(path, privateKey); err == nil {
		t.Fatal("expected existing key file to be preserved")
	}
}
