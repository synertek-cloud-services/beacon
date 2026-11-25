package screeninject

// This file carries no //go:build tag: the Ctrl+Alt+Delete detection is pure
// keysym bookkeeping, unit-testable without Windows.

const (
	keysymControlL = 0xFFE3
	keysymControlR = 0xFFE4
	keysymAltL     = 0xFFE9
	keysymAltR     = 0xFFEA
	keysymDelete   = 0xFFFF
)

// cadTracker watches RFB key events for Ctrl+Alt+Delete. noVNC's
// sendCtrlAltDel sends Ctrl down, Alt down, Delete down, then the releases,
// so held-modifier state is enough to recognise it.
type cadTracker struct {
	ctrl, alt int // count of held Left/Right keys, so L+R held then one released still counts
}

// observe records one key event and reports whether it is the Delete press that
// completes Ctrl+Alt+Delete.
func (t *cadTracker) observe(down bool, keysym uint32) bool {
	step := -1
	if down {
		step = 1
	}
	switch keysym {
	case keysymControlL, keysymControlR:
		t.ctrl += step
		if t.ctrl < 0 {
			t.ctrl = 0
		}
	case keysymAltL, keysymAltR:
		t.alt += step
		if t.alt < 0 {
			t.alt = 0
		}
	case keysymDelete:
		return down && t.ctrl > 0 && t.alt > 0
	}
	return false
}
