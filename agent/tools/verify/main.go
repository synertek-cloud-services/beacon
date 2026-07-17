// verify checks that a binary's Ed25519 signature matches the pinned public key.
// Exits 0 if valid, non-zero if not.
//
// Usage:
//
//	BEACON_SIGNATURE_HEX=<hex sig> go run ./tools/verify <binary-path>
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
)

// Must match pinnedPublicKey in agent/internal/updater/verify.go.
const pinnedPublicKey = "673119993b2e981690afb9567065d53813e5cd83409d6b7f1f2a62175a220282"

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: BEACON_SIGNATURE_HEX=<hex> go run ./tools/verify <binary-path>")
	}

	sigHex := os.Getenv("BEACON_SIGNATURE_HEX")
	if sigHex == "" {
		log.Fatal("BEACON_SIGNATURE_HEX env var not set")
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		log.Fatalf("BEACON_SIGNATURE_HEX: expected %d hex bytes, got %d", ed25519.SignatureSize, len(sigBytes))
	}

	pubBytes, _ := hex.DecodeString(pinnedPublicKey)

	var data []byte
	if os.Args[1] == "-" {
		data, err = io.ReadAll(os.Stdin)
		if err != nil {
			log.Fatalf("read stdin: %v", err)
		}
	} else {
		data, err = os.ReadFile(os.Args[1])
		if err != nil {
			log.Fatalf("read binary: %v", err)
		}
	}

	digest := sha256.Sum256(data)
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), digest[:], sigBytes) {
		fmt.Fprintf(os.Stderr, "INVALID: signature does not match pinned public key for %s\n", os.Args[1])
		os.Exit(1)
	}
	fmt.Printf("OK: signature valid for %s\n", os.Args[1])
}
