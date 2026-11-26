package wingetupdate

import (
	"strconv"
	"strings"
)

// This file carries no //go:build tag: it is pure string handling with no OS
// dependency, so it can be unit-tested off Windows.

// newestDir returns the package folder with the highest version, where the
// version is the part of the folder name between the first and second
// underscore ("Name_1.29.379.0_x64__publisher"). Compared numerically per
// dot-separated field: plain text order puts "1.10" before "1.9", which would
// pick an older folder when an old version's directory survives an update.
// Empty input returns "".
func newestDir(matches []string) string {
	best := ""
	for _, m := range matches {
		if best == "" || versionLess(folderVersion(best), folderVersion(m)) {
			best = m
		}
	}
	return best
}

// folderVersion extracts the version from a package folder path.
func folderVersion(path string) string {
	name := path
	if i := strings.LastIndexAny(path, `\/`); i >= 0 {
		name = path[i+1:]
	}
	parts := strings.Split(name, "_")
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

// versionLess reports whether dotted version a is lower than b, numerically per
// field; a missing field counts as 0 and a non-numeric one as 0.
func versionLess(a, b string) bool {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		var x, y int
		if i < len(as) {
			x, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			y, _ = strconv.Atoi(bs[i])
		}
		if x != y {
			return x < y
		}
	}
	return false
}

// withPathPrefix returns env with dir put at the front of the PATH variable,
// adding one if there is none. Windows environment variable names are case
// insensitive, so "Path" and "PATH" are both matched.
func withPathPrefix(env []string, dir string) []string {
	out := make([]string, 0, len(env)+1)
	done := false
	for _, kv := range env {
		name, value, ok := strings.Cut(kv, "=")
		if !done && ok && strings.EqualFold(name, "PATH") {
			out = append(out, name+"="+dir+";"+value)
			done = true
			continue
		}
		out = append(out, kv)
	}
	if !done {
		out = append(out, "PATH="+dir)
	}
	return out
}
