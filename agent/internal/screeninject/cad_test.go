package screeninject

import "testing"

func TestCADTracker(t *testing.T) {
	var tr cadTracker
	for _, ev := range []struct {
		down   bool
		keysym uint32
		want   bool
	}{
		{true, keysymDelete, false}, // Delete alone
		{false, keysymDelete, false},
		{true, keysymControlL, false},
		{true, keysymDelete, false}, // Ctrl+Delete
		{false, keysymDelete, false},
		{true, keysymAltL, false},
		{true, keysymDelete, true}, // Ctrl+Alt+Delete
		{false, keysymDelete, false},
		{false, keysymAltL, false},
		{false, keysymControlL, false},
		{true, keysymAltR, false},
		{true, keysymDelete, false}, // Alt+Delete: Ctrl released
		{false, keysymDelete, false},
		{false, keysymAltR, false},
		{true, keysymControlR, false},
		{true, keysymAltR, false},
		{true, keysymDelete, true}, // right-hand modifiers count too
	} {
		if got := tr.observe(ev.down, ev.keysym); got != ev.want {
			t.Fatalf("observe(down=%v, %#x) = %v, want %v", ev.down, ev.keysym, got, ev.want)
		}
	}
}
