// sign computes an Ed25519 signature over the SHA-256 digest of a binary file.
// The hex-encoded signature is what you pass to the admin version-publish API.
//
// Usage:
//
//	BEACON_SIGNING_KEY=<hex private key> go run ./tools/sign <binary-path>
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: sign <binary-path>")
	}
	binaryPath := os.Args[1]

	keyHex := os.Getenv("BEACON_SIGNING_KEY")
	if keyHex == "" {
		log.Fatal("BEACON_SIGNING_KEY env var not set")
	}

	privBytes, err := hex.DecodeString(keyHex)
	if err != nil || len(privBytes) != ed25519.PrivateKeySize {
		log.Fatalf("BEACON_SIGNING_KEY: expected %d hex bytes, got %d", ed25519.PrivateKeySize, len(privBytes))
	}

	data, err := os.ReadFile(binaryPath)
	if err != nil {
		log.Fatalf("read binary: %v", err)
	}

	digest := sha256.Sum256(data)
	sig := ed25519.Sign(ed25519.PrivateKey(privBytes), digest[:])

	fmt.Println(hex.EncodeToString(sig))
}
