//go:build manualsnmp

package discovery

import "testing"

// Throwaway, not committed to the real test suite (see the build tag) --
// run once against a real local net-snmp `snmpd` instance to confirm
// probeSNMPAddr's real gosnmp client round-trips correctly against a
// genuinely independent SNMP agent implementation. Requires a real snmpd
// reachable at 127.0.0.1:16161 with `rocommunity public`, `sysDescr Beacon
// Test SNMP Agent`, `sysName beacon-test-host` in its config -- see
// PROJECT_LOG.md for the exact one-time setup used to verify this.
func TestManualProbeSNMPAddrAgainstRealSnmpd(t *testing.T) {
	sysDescr, sysName, ok := probeSNMPAddr("127.0.0.1", 16161, "public")
	if !ok {
		t.Fatal("expected ok=true against a real running snmpd")
	}
	if sysDescr != "Beacon Test SNMP Agent" {
		t.Fatalf("sysDescr = %q, want %q", sysDescr, "Beacon Test SNMP Agent")
	}
	if sysName != "beacon-test-host" {
		t.Fatalf("sysName = %q, want %q", sysName, "beacon-test-host")
	}
}
