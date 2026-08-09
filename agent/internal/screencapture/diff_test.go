package screencapture

import "testing"

func makeRows(rowBytes, numRows int, fill byte) []byte {
	buf := make([]byte, rowBytes*numRows)
	for i := range buf {
		buf[i] = fill
	}
	return buf
}

func TestDiffChangedRowRangeIdentical(t *testing.T) {
	const rowBytes = 16
	prev := makeRows(rowBytes, 10, 0x42)
	curr := makeRows(rowBytes, 10, 0x42)

	_, _, changed := diffChangedRowRange(prev, curr, rowBytes)
	if changed {
		t.Fatal("identical buffers should report no change")
	}
}

func TestDiffChangedRowRangeSingleRow(t *testing.T) {
	const rowBytes = 16
	prev := makeRows(rowBytes, 10, 0x00)
	curr := makeRows(rowBytes, 10, 0x00)
	curr[5*rowBytes] = 0xFF // touch row 5 only

	minY, maxY, changed := diffChangedRowRange(prev, curr, rowBytes)
	if !changed {
		t.Fatal("expected a change")
	}
	if minY != 5 || maxY != 5 {
		t.Fatalf("range = [%d,%d], want [5,5]", minY, maxY)
	}
}

func TestDiffChangedRowRangeMultipleScatteredRows(t *testing.T) {
	const rowBytes = 16
	prev := makeRows(rowBytes, 20, 0x00)
	curr := makeRows(rowBytes, 20, 0x00)
	curr[2*rowBytes] = 0x01    // row 2
	curr[15*rowBytes+3] = 0x02 // row 15
	// rows in between (3-14) stay identical -- range should still bound
	// from the outermost changed rows, not require every row in between
	// to differ.

	minY, maxY, changed := diffChangedRowRange(prev, curr, rowBytes)
	if !changed {
		t.Fatal("expected a change")
	}
	if minY != 2 || maxY != 15 {
		t.Fatalf("range = [%d,%d], want [2,15]", minY, maxY)
	}
}

func TestDiffChangedRowRangeFirstAndLastRow(t *testing.T) {
	const rowBytes = 8
	prev := makeRows(rowBytes, 5, 0x00)
	curr := makeRows(rowBytes, 5, 0x00)
	curr[0] = 0xAA            // row 0
	curr[4*rowBytes+7] = 0xBB // row 4 (last)

	minY, maxY, changed := diffChangedRowRange(prev, curr, rowBytes)
	if !changed {
		t.Fatal("expected a change")
	}
	if minY != 0 || maxY != 4 {
		t.Fatalf("range = [%d,%d], want [0,4]", minY, maxY)
	}
}

func TestDiffChangedRowRangeAllRowsChanged(t *testing.T) {
	const rowBytes = 4
	prev := makeRows(rowBytes, 6, 0x00)
	curr := makeRows(rowBytes, 6, 0xFF)

	minY, maxY, changed := diffChangedRowRange(prev, curr, rowBytes)
	if !changed || minY != 0 || maxY != 5 {
		t.Fatalf("range = [%d,%d] changed=%v, want [0,5] true", minY, maxY, changed)
	}
}

func TestDiffChangedRowRangeMismatchedSizeFallsBackToFullChange(t *testing.T) {
	prev := make([]byte, 100)
	curr := make([]byte, 200) // 20 rows @ rowBytes=10

	minY, maxY, changed := diffChangedRowRange(prev, curr, 10)
	if !changed {
		t.Fatal("mismatched buffer sizes should be treated as a full change, not silently ignored")
	}
	// The whole current buffer must be reported as changed, not just row
	// 0 -- a real bug caught here: an earlier version hardcoded (0, 0),
	// which would have rendered every session's first frame as a single
	// row with the rest of the screen left blank.
	if minY != 0 || maxY != 19 {
		t.Fatalf("range = [%d,%d], want [0,19] (the full current buffer)", minY, maxY)
	}
}

// TestDiffChangedRowRangeFirstCallNoPreviousFrame mirrors exactly what
// GDICapturer.Capture does on the very first call of a session: prev is
// nil (no prior frame exists yet). Must report the entire buffer as
// changed, the same size-mismatch path the test above exercises directly.
func TestDiffChangedRowRangeFirstCallNoPreviousFrame(t *testing.T) {
	const rowBytes = 8
	curr := makeRows(rowBytes, 12, 0x7A)

	minY, maxY, changed := diffChangedRowRange(nil, curr, rowBytes)
	if !changed {
		t.Fatal("a nil previous frame must be treated as a full change")
	}
	if minY != 0 || maxY != 11 {
		t.Fatalf("range = [%d,%d], want [0,11] (all 12 rows)", minY, maxY)
	}
}

func TestDiffChangedRowRangeEmptyBuffers(t *testing.T) {
	_, _, changed := diffChangedRowRange(nil, nil, 10)
	if changed {
		t.Fatal("two empty buffers have nothing to diff, should report no change")
	}
}
