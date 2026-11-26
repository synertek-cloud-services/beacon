package wingetupdate

import (
	"reflect"
	"testing"
)

func TestWithPathPrefix(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  []string
		want []string
	}{
		{"prepends to PATH", []string{"A=1", "PATH=C:\\x;C:\\y", "B=2"}, []string{"A=1", "PATH=D;C:\\x;C:\\y", "B=2"}},
		{"matches Path case-insensitively and keeps its spelling", []string{"Path=C:\\x"}, []string{"Path=D;C:\\x"}},
		{"adds PATH when missing", []string{"A=1"}, []string{"A=1", "PATH=D"}},
		{"empty env", nil, []string{"PATH=D"}},
		{"only the first PATH is changed", []string{"PATH=1", "path=2"}, []string{"PATH=D;1", "path=2"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := append([]string(nil), tc.env...)
			got := withPathPrefix(tc.env, "D")
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			if !reflect.DeepEqual(tc.env, in) {
				t.Fatalf("input env was modified: %v -> %v", in, tc.env)
			}
		})
	}
}

func TestNewestDir(t *testing.T) {
	if got := newestDir(nil); got != "" {
		t.Fatalf("empty input = %q, want empty", got)
	}
	for _, tc := range []struct {
		name string
		in   []string
		want string
	}{
		{"single", []string{`C:\W\VCLibs_14.0.33728.0_x64__x`}, `C:\W\VCLibs_14.0.33728.0_x64__x`},
		{"higher patch wins", []string{`W\V_14.0.33519.0_x64__x`, `W\V_14.0.33728.0_x64__x`, `W\V_14.0.30035.0_x64__x`}, `W\V_14.0.33728.0_x64__x`},
		{"1.10 beats 1.9 (text order gets this wrong)", []string{`W\App_1.9.25180.0_x64__x`, `W\App_1.10.100.0_x64__x`}, `W\App_1.10.100.0_x64__x`},
		{"forward slashes", []string{`W/App_1.9.0.0_x64__x`, `W/App_1.29.379.0_x64__x`}, `W/App_1.29.379.0_x64__x`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := newestDir(tc.in); got != tc.want {
				t.Fatalf("newestDir = %q, want %q", got, tc.want)
			}
		})
	}
}
