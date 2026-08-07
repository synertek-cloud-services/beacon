//go:build windows

package credential

import (
	"fmt"
	"os/exec"
)

// Use well-known SIDs instead of localized account names so the ACL works on
// every Windows language. The installer is elevated; failure to apply this
// ACL fails installation rather than leaving the bootstrap token readable.
func restrictEnrollmentBootstrap(path string) error {
	output, err := exec.Command(
		"icacls", path,
		"/inheritance:r",
		"/grant:r", "*S-1-5-18:(F)",
		"/grant:r", "*S-1-5-32-544:(F)",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls: %w: %s", err, output)
	}
	return nil
}
