//go:build !windows

package credential

func restrictEnrollmentBootstrap(string) error { return nil }
