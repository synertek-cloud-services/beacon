// Package procutil finds running processes by name for the process policy
// monitor, using gopsutil's process package (already a dependency for
// disk/CPU/memory/AV collection elsewhere in the agent) instead of shelling
// out to a platform tool.
package procutil

import (
	"runtime"
	"strings"

	"github.com/shirou/gopsutil/v3/process"
)

// Find reports whether any process named name is running, and the combined
// CPU/memory footprint across all instances sharing that name (Task-Manager
// style grouping — e.g. multiple chrome processes count as one "chrome").
// CPU is normalized by logical core count so it lands in a comparable 0-100
// range, matching Datto's own documented Windows formula.
func Find(name string) (running bool, cpuPercent, memPercent float64) {
	target := strings.ToLower(strings.TrimSuffix(name, ".exe"))
	numCPU := float64(runtime.NumCPU())
	if numCPU < 1 {
		numCPU = 1
	}

	procs, err := process.Processes()
	if err != nil {
		return false, 0, 0
	}

	for _, p := range procs {
		pname, err := p.Name()
		if err != nil {
			continue
		}
		pname = strings.ToLower(strings.TrimSuffix(pname, ".exe"))
		if pname != target {
			continue
		}

		running = true
		if cpu, err := p.CPUPercent(); err == nil {
			cpuPercent += cpu / numCPU
		}
		if mem, err := p.MemoryPercent(); err == nil {
			memPercent += float64(mem)
		}
	}

	return running, cpuPercent, memPercent
}
