// Package filesize measures the size of a file or the recursive total size
// of a folder's regular files, for the file_size policy monitor.
package filesize

import (
	"os"
	"path/filepath"
	"time"
)

// walkBudget bounds how long a folder walk may run. Measure is always
// invoked from its own goroutine per check-in cycle, so a slow walk only
// delays its own result — this just stops a pathological path (e.g.
// accidentally pointed at a drive root) from running forever.
const walkBudget = 30 * time.Second

func Measure(path string) (exists bool, sizeBytes int64, err error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	if !info.IsDir() {
		return true, info.Size(), nil
	}

	deadline := time.Now().Add(walkBudget)
	var total int64
	_ = filepath.WalkDir(path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries, keep walking
		}
		if time.Now().After(deadline) {
			return filepath.SkipAll
		}
		if !d.IsDir() {
			if fi, ferr := d.Info(); ferr == nil {
				total += fi.Size()
			}
		}
		return nil
	})
	return true, total, nil
}
