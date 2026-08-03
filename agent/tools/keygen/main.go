// keygen creates a host-controlled Ed25519 key for signing agent releases.
// It writes the private key directly to a new mode-0600 file and never prints
// the private material to stdout or stderr.
//
// Usage:
//
//	go run ./tools/keygen --out /secure/path/beacon-agent-signing.key
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
)

func main() {
	outputPath := flag.String("out", "", "new file in which to store the private signing key")
	flag.Parse()

	if *outputPath == "" || flag.NArg() != 0 {
		log.Fatal("usage: go run ./tools/keygen --out /secure/path/beacon-agent-signing.key")
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("generate key: %v", err)
	}

	if err := writePrivateKey(*outputPath, privateKey); err != nil {
		log.Fatalf("store private key: %v", err)
	}

	if runtime.GOOS == "windows" {
		fmt.Printf("Created agent signing key at %s. Restrict its Windows ACL to the release operator.\n", *outputPath)
	} else {
		fmt.Printf("Created agent signing key at %s (mode 0600).\n", *outputPath)
	}
	fmt.Printf("Public key: %s\n", hex.EncodeToString(publicKey))
	fmt.Println("Back up this file securely. Losing it prevents deployed agents from trusting future releases.")
}

func writePrivateKey(path string, privateKey ed25519.PrivateKey) (returnErr error) {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		if err := file.Close(); returnErr == nil && err != nil {
			returnErr = err
		}
		if returnErr != nil {
			_ = os.Remove(path)
		}
	}()

	_, returnErr = fmt.Fprintf(file, "%s\n", hex.EncodeToString(privateKey))
	return returnErr
}
