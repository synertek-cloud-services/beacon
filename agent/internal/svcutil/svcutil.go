// Package svcutil looks up a single Windows service by name for the service
// policy monitor. Windows-only — matches Datto's own OS restriction for this
// monitor, and "service" in the Service Control Manager sense doesn't exist
// on other platforms.
package svcutil

import (
	"context"
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// Find reports whether the named service is running, and — if so — the
// CPU/memory footprint of its hosting process (resolved via the service's
// ProcessId, then read through gopsutil rather than a second WMI query).
func Find(name string) (running bool, cpuPercent, memPercent float64) {
	if runtime.GOOS != "windows" {
		return false, 0, 0
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Escape embedded single quotes so the WQL filter stays well-formed.
	escaped := strings.ReplaceAll(name, "'", "''")
	ps := `Get-CimInstance Win32_Service -Filter "Name='` + escaped + `'" | Select-Object State,ProcessId | ConvertTo-Json -Compress`
	out, err := exec.CommandContext(ctx,
		"powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps,
	).Output()
	if err != nil {
		return false, 0, 0
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "null" {
		return false, 0, 0
	}

	var svc struct {
		State     string `json:"State"`
		ProcessId int32  `json:"ProcessId"`
	}
	if err := json.Unmarshal([]byte(raw), &svc); err != nil {
		return false, 0, 0
	}

	running = strings.EqualFold(svc.State, "Running")
	if !running || svc.ProcessId == 0 {
		return running, 0, 0
	}

	p, err := process.NewProcess(svc.ProcessId)
	if err != nil {
		return running, 0, 0
	}

	numCPU := float64(runtime.NumCPU())
	if numCPU < 1 {
		numCPU = 1
	}
	if cpu, err := p.CPUPercent(); err == nil {
		cpuPercent = cpu / numCPU
	}
	if mem, err := p.MemoryPercent(); err == nil {
		memPercent = float64(mem)
	}

	return running, cpuPercent, memPercent
}
