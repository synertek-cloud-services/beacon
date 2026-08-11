package session

import (
	"encoding/base64"
	"testing"
	"unicode/utf16"
)

// TestEncodePowerShellCommandRoundTrips confirms the exact contract
// -EncodedCommand requires: base64 of UTF-16LE code units, no BOM. Decodes
// independently (not by calling encodePowerShellCommand's own internals)
// and reconstructs the original string, the same round-trip a real
// powershell.exe -EncodedCommand invocation performs internally.
func TestEncodePowerShellCommandRoundTrips(t *testing.T) {
	cases := []string{
		"",
		"Write-Host 'hello'",
		elevatedMenuScript, // the real payload this exists for
		"em dash — and utf8 — chars",
	}
	for _, want := range cases {
		encoded := encodePowerShellCommand(want)

		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatalf("encodePowerShellCommand(%q): invalid base64: %v", want, err)
		}
		if len(raw)%2 != 0 {
			t.Fatalf("encodePowerShellCommand(%q): decoded byte length %d is odd, not valid UTF-16LE", want, len(raw))
		}

		units := make([]uint16, len(raw)/2)
		for i := range units {
			// little-endian, matching what encodePowerShellCommand writes
			units[i] = uint16(raw[i*2]) | uint16(raw[i*2+1])<<8
		}
		got := string(utf16.Decode(units))

		if got != want {
			t.Errorf("round trip mismatch:\n want %q\n got  %q", want, got)
		}
	}
}

// TestEncodePowerShellCommandNoBOM confirms nothing analogous to
// writeTempScript's UTF-8 BOM prefix leaks in here -- -EncodedCommand's
// contract is exactly the UTF-16LE bytes of the string, nothing prepended.
func TestEncodePowerShellCommandNoBOM(t *testing.T) {
	encoded := encodePowerShellCommand("x")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("invalid base64: %v", err)
	}
	// UTF-16LE 'x' is 0x78 0x00 -- exactly 2 bytes, no BOM (which would be
	// 0xFF 0xFE prepended for UTF-16LE, or 0xFE 0xFF for UTF-16BE).
	if len(raw) != 2 || raw[0] != 0x78 || raw[1] != 0x00 {
		t.Fatalf("expected exactly [0x78, 0x00] for \"x\", got %v", raw)
	}
}
