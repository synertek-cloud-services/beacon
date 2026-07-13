// Package diskutil enumerates real (non-virtual) disk partitions. Shared by
// the audit snapshot (every 24h) and the check-in snapshot (every 60s) so
// disk_space monitors can evaluate against fresh multi-drive data.
package diskutil

import (
	"github.com/shirou/gopsutil/v3/disk"

	"github.com/synertekcs/beacon/agent/internal/protocol"
)

var excludedFSTypes = map[string]bool{
	"overlay": true, "overlayfs": true, "squashfs": true,
	"tmpfs": true, "devtmpfs": true, "ramfs": true,
	"sysfs": true, "proc": true, "cgroup": true, "cgroup2": true,
	"devfs": true, "autofs": true, "bpf": true, "tracefs": true,
	"hugetlbfs": true, "mqueue": true, "debugfs": true, "fusectl": true,
}

func CollectDisks() ([]protocol.DiskInfo, error) {
	parts, err := disk.Partitions(false)
	if err != nil {
		return nil, err
	}
	var disks []protocol.DiskInfo
	for _, p := range parts {
		if excludedFSTypes[p.Fstype] {
			continue
		}
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil || usage.Total == 0 {
			continue
		}
		label := p.Mountpoint
		if p.Device != "" {
			label = p.Device
		}
		disks = append(disks, protocol.DiskInfo{
			Device:     p.Device,
			Label:      label,
			FSType:     p.Fstype,
			TotalBytes: usage.Total,
			FreeBytes:  usage.Free,
		})
	}
	return disks, nil
}
