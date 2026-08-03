//go:build windows

// Package rebootmarker owns the on-disk handshake path shared by the agent
// service and the per-user tray helper.
package rebootmarker

import "path/filepath"

const installDir = `C:\Program Files\Beacon`

func Path() string { return filepath.Join(installDir, "pending-reboot.json") }
