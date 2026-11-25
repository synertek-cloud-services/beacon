//go:build !windows

package sas

import "errors"

// StartServer is a no-op off Windows.
func StartServer() {}

// Request is unsupported off Windows.
func Request() error { return errors.New("sas: Ctrl+Alt+Delete is Windows-only") }
