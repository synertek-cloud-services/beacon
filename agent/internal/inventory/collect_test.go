package inventory

import "testing"

func TestCountRealBatteries(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   string
		want int
	}{
		{"no battery", "", 0},
		{"blank lines only", "\r\n\r\n", 0},
		{"real laptop battery", "Primary\r\n", 1},
		{"hyper-v virtual battery", "Microsoft Hyper-V Virtual Battery\r\n", 0},
		{"virtual plus real", "Microsoft Hyper-V Virtual Battery\r\nPrimary\r\n", 1},
		{"two real batteries", "Primary\r\nSecondary\r\n", 2},
		{"case-insensitive", "some VIRTUAL battery\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := countRealBatteries(tc.in); got != tc.want {
				t.Fatalf("countRealBatteries(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}
