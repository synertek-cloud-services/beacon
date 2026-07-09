package main

import (
	"log"
	"os"
)

func main() {
	// TODO Phase 1:
	// - parse flags: --server-url, --enroll-token
	// - load stored device credential (DPAPI-encrypted on Windows)
	// - if no credential: run enrollment, persist result
	// - install as system service if not already running as one
	// - start check-in loop (60s default interval)
	log.Println("beacon agent starting")
	os.Exit(0)
}
