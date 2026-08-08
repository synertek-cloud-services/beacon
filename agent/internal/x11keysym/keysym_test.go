package x11keysym

import "testing"

func TestToVirtualKey(t *testing.T) {
	cases := []struct {
		name   string
		keysym uint32
		wantVK uint16
	}{
		{"digit 0", 0x0030, 0x30},
		{"digit 9", 0x0039, 0x39},
		{"uppercase A", 0x0041, 0x41},
		{"uppercase Z", 0x005A, 0x5A},
		{"lowercase a", 0x0061, 0x41}, // same VK as uppercase
		{"lowercase z", 0x007A, 0x5A},
		{"space", 0x0020, vkSpace},
		{"BackSpace", 0xFF08, vkBack},
		{"Tab", 0xFF09, vkTab},
		{"Return", 0xFF0D, vkReturn},
		{"Escape", 0xFF1B, vkEscape},
		{"Delete", 0xFFFF, vkDelete},
		{"Home", 0xFF50, vkHome},
		{"Left", 0xFF51, vkLeft},
		{"Up", 0xFF52, vkUp},
		{"Right", 0xFF53, vkRight},
		{"Down", 0xFF54, vkDown},
		{"Page_Up", 0xFF55, vkPrior},
		{"Page_Down", 0xFF56, vkNext},
		{"End", 0xFF57, vkEnd},
		{"Insert", 0xFF63, vkInsert},
		{"Shift_L", 0xFFE1, vkLShift},
		{"Shift_R", 0xFFE2, vkRShift},
		{"Control_L", 0xFFE3, vkLControl},
		{"Control_R", 0xFFE4, vkRControl},
		{"Caps_Lock", 0xFFE5, vkCapital},
		{"Alt_L", 0xFFE9, vkLMenu},
		{"Alt_R", 0xFFEA, vkRMenu},
		{"Super_L", 0xFFEB, vkLWin},
		{"Super_R", 0xFFEC, vkRWin},
		{"F1", 0xFFBE, vkF1},
		{"F12", 0xFFC9, vkF1 + 11},
		{"minus", 0x002D, vkOEMMinus},
		{"equal", 0x003D, vkOEMPlus},
		{"exclam maps to '1' VK", 0x0021, vk0 + 1},
		{"parenright maps to '0' VK", 0x0029, vk0},
		{"question maps to slash VK", 0x003F, vkOEM2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			vk, ok := ToVirtualKey(c.keysym)
			if !ok {
				t.Fatalf("keysym %#x: not found in table", c.keysym)
			}
			if vk != c.wantVK {
				t.Fatalf("keysym %#x: vk = %#x, want %#x", c.keysym, vk, c.wantVK)
			}
		})
	}
}

func TestToVirtualKeyUnmapped(t *testing.T) {
	// A keysym from outside this deliberately-non-exhaustive table (e.g. a
	// dead key or IME composition code) must report ok=false, not panic
	// or return a bogus VK.
	if _, ok := ToVirtualKey(0xFE50); ok { // XK_dead_grave
		t.Fatal("expected dead-key keysym to be unmapped")
	}
}

func TestAllTableEntriesAreNonZeroExceptDigitZero(t *testing.T) {
	// Every mapped VK should be a plausible non-zero code -- guards against
	// an init-loop off-by-one silently zeroing an entry, except VK 0x00 is
	// never a real VK code we assign here, so this is a cheap sanity net.
	for keysym, vk := range table {
		if vk == 0 {
			t.Errorf("keysym %#x maps to VK 0, looks uninitialized", keysym)
		}
	}
}
