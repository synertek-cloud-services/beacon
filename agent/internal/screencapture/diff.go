package screencapture

import "bytes"

// This file deliberately carries no //go:build tag, unlike
// capture_windows.go -- the diffing logic here is pure byte comparison
// with no OS dependency, so it can be unit-tested without real GDI.

// diffChangedRowRange compares prev and curr, both full raw framebuffers
// laid out as consecutive rows of rowBytes each, and returns the inclusive
// [minY, maxY] range of rows that differ. anyChanged is false (minY/maxY
// undefined) when the buffers are identical -- the common case for a
// mostly-static desktop between two successive captures, and the case
// GDICapturer uses to skip packing/sending a rectangle at all.
//
// Row-bounded rather than a tighter 2D dirty-rect: still a large practical
// win over sending the whole frame on every request (the actual
// real-hardware-observed cause of Web Remote's LAN slowness -- capture-on-
// request with no diffing meant every single incremental update repacked
// and sent the entire screen, regardless of how little had actually
// changed), without the added complexity of per-column tracking.
func diffChangedRowRange(prev, curr []byte, rowBytes int) (minY, maxY int, anyChanged bool) {
	if rowBytes <= 0 || len(curr) == 0 {
		return 0, 0, false
	}
	if len(prev) != len(curr) {
		// No previous frame to compare against (the very first capture of
		// a session -- prev is nil) or a resolution change mid-session
		// (not expected in v1's fixed-resolution design, but not a reason
		// to panic either) -- the entire current buffer must be treated as
		// changed, not just row 0: an earlier version of this function
		// returned a hardcoded (0, 0, true) here, which would have made
		// every session's very first frame render as a single row with
		// the rest of the screen left blank.
		return 0, (len(curr) / rowBytes) - 1, true
	}

	rows := len(curr) / rowBytes
	minY, maxY = -1, -1
	for y := 0; y < rows; y++ {
		start := y * rowBytes
		end := start + rowBytes
		if !bytes.Equal(prev[start:end], curr[start:end]) {
			if minY == -1 {
				minY = y
			}
			maxY = y
		}
	}
	return minY, maxY, minY != -1
}
