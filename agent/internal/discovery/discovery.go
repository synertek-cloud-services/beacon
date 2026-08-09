// Package discovery walks a CIDR range looking for live hosts (a bounded-
// concurrency ping sweep), then cross-references the OS ARP table for MAC
// addresses and attempts best-effort reverse DNS for hostnames. Shells out
// to the platform's native ping/ARP tools rather than raw ICMP/ARP sockets —
// same reasoning as agent/internal/pingutil: those need elevated privileges
// on Unix, and this matches the codebase's existing convention for
// OS-specific data (see agent/internal/audit/hardware.go).
package discovery

import (
	"bufio"
	"context"
	"encoding/binary"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
	"golang.org/x/crypto/ssh"
)

// A single sweep call is bounded to this many total addresses across every
// requested range, mirroring the /20-or-smaller cap the worker already
// enforces when saving a config -- defense in depth, since this payload
// reaches the agent via the commands table with no further validation at
// dispatch time.
const maxHostsPerScan = 4096

// concurrency bounds the ping sweep's worker pool. A sequential 254-host
// /24 sweep at even a fast ~1s-per-host liveness check would take several
// minutes; this keeps a full scan to well under a minute in the common case
// without hammering the network or spawning an unbounded number of
// processes at once.
const concurrency = 32

// pingTimeout is deliberately much shorter than pingutil.Ping's ~12s+
// deadline -- that timeout is calibrated for "check one specific host I
// expect to be healthy," where hitting the timeout is rare. A sweep's
// common case is the opposite: most addresses in a typical range are
// unused, so hitting the timeout is the norm, not the exception. A
// dedicated, short, single-packet check keeps a sweep's total time
// reasonable; it deliberately does not reuse pingutil.Ping.
const pingTimeout = 1200 * time.Millisecond

// overallBudget bounds a single Scan call's total runtime, same
// pathological-run guard as filesize.Measure's walkBudget. The credentialed
// enrichment phase below (see enrichHosts) shares this same deadline with
// the ping sweep rather than getting its own separate budget.
const overallBudget = 5 * time.Minute

// Credentialed Network Discovery (issue #78) -- SNMP v1/v2c and SSH
// (password-only) fingerprinting of hosts the ping sweep above already
// found alive. WinRM is deliberately deferred (higher-risk auth
// negotiation, no first-party Go client). Both protocols are opt-in: an
// empty snmpCommunity/sshUsername+sshPassword passed to Scan disables the
// corresponding protocol entirely, so an agent whose worker never sends
// credentials (the common case -- these fields ride an optional, additive
// payload extension, not a wire-protocol requirement) behaves identically
// to pre-credentialed-discovery Scan.
const (
	sshPort  = 22
	snmpPort = 161

	// enrichConcurrency is smaller than the ping sweep's own concurrency
	// (32) -- these are heavier per-host operations (a real TCP dial plus
	// SSH handshake+auth, or an SNMP round trip with a retry), not a
	// single ICMP packet.
	enrichConcurrency = 16

	// sshDialTimeout bounds both the plain TCP port-check dial and the
	// full SSH handshake+auth dial -- generous for a LAN target, short
	// enough that a closed/filtered port doesn't stall the whole scan.
	sshDialTimeout = 3 * time.Second
	// sshCommandTimeout bounds the one fixed post-auth command
	// (`uname -a`) -- not a configurable command builder, deliberately;
	// see the doc comment on probeSSH.
	sshCommandTimeout = 5 * time.Second

	// snmpTimeout is short because a non-responding host (no SNMP agent,
	// or a wrong community string -- SNMPv1/v2c has no way to distinguish
	// the two, both just produce silence) is the common case across a
	// typical subnet, the same "most addresses won't answer" reasoning
	// pingTimeout above already documents for the ping sweep.
	snmpTimeout  = 1500 * time.Millisecond
	snmpRetries  = 1
	oidSysDescr  = ".1.3.6.1.2.1.1.1.0" // MIB-II System group -- universal across SNMP-speaking devices
	oidSysName   = ".1.3.6.1.2.1.1.5.0"
)

type Host struct {
	IP           string `json:"ip"`
	MAC          string `json:"mac,omitempty"`
	Hostname     string `json:"hostname,omitempty"`
	OpenPorts    []int  `json:"open_ports,omitempty"`
	SNMPSysDescr string `json:"snmp_sys_descr,omitempty"`
	SNMPSysName  string `json:"snmp_sys_name,omitempty"`
	SSHBanner    string `json:"ssh_banner,omitempty"`
	SSHOSInfo    string `json:"ssh_os_info,omitempty"`
}

type Result struct {
	Hosts []Host `json:"hosts"`
	Error string `json:"error,omitempty"`
}

// Scan walks cidrRanges for live hosts (ping sweep + ARP/reverse-DNS, as
// before), then optionally fingerprints each live host via SNMP and/or SSH
// -- snmpCommunity empty disables SNMP; sshUsername/sshPassword both
// required (non-empty) to enable SSH. Neither credential is required: an
// old-shaped dispatch (or a worker that has no CV_SNMP_COMMUNITY/
// CV_SSH_USERNAME/CV_SSH_PASSWORD Company Variables configured for this
// company) just gets today's ping+ARP-only behavior.
func Scan(cidrRanges []string, snmpCommunity, sshUsername, sshPassword string) Result {
	deadline := time.Now().Add(overallBudget)

	var targets []string
	for _, cidr := range cidrRanges {
		ips, err := hostsInCIDR(cidr)
		if err != nil {
			continue // skip an unparseable range rather than failing the whole scan
		}
		targets = append(targets, ips...)
		if len(targets) >= maxHostsPerScan {
			targets = targets[:maxHostsPerScan]
			break
		}
	}
	if len(targets) == 0 {
		return Result{Error: "no valid host addresses in the requested range(s)"}
	}

	alive := sweepAlive(targets, deadline)
	if len(alive) == 0 {
		return Result{Hosts: []Host{}}
	}

	arpTable := readARPTable()

	hosts := make([]Host, 0, len(alive))
	for _, ip := range alive {
		h := Host{IP: ip, MAC: arpTable[ip]}
		if name, ok := reverseLookup(ip); ok {
			h.Hostname = name
		}
		hosts = append(hosts, h)
	}

	enrichHosts(hosts, snmpCommunity, sshUsername, sshPassword, deadline)

	return Result{Hosts: hosts}
}

// enrichHosts runs the credentialed fingerprint phase against every
// already-alive host, bounded by the same deadline the ping sweep above
// respects. A no-op (zero extra network traffic) when neither protocol is
// configured -- checked once here rather than per-host.
func enrichHosts(hosts []Host, snmpCommunity, sshUsername, sshPassword string, deadline time.Time) {
	snmpOn := snmpCommunity != ""
	sshOn := sshUsername != "" && sshPassword != ""
	if !snmpOn && !sshOn {
		return
	}

	sem := make(chan struct{}, enrichConcurrency)
	var wg sync.WaitGroup
	for i := range hosts {
		if time.Now().After(deadline) {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			enrichHost(&hosts[i], snmpOn, snmpCommunity, sshOn, sshUsername, sshPassword)
		}(i)
	}
	wg.Wait()
}

// enrichHost mutates its own, distinct element of the caller's hosts slice
// -- safe for concurrent use across goroutines each given a different
// index, since they never touch the same memory.
func enrichHost(h *Host, snmpOn bool, snmpCommunity string, sshOn bool, sshUsername, sshPassword string) {
	var openPorts []int
	if snmpOn {
		if descr, name, ok := probeSNMP(h.IP, snmpCommunity); ok {
			openPorts = append(openPorts, snmpPort)
			h.SNMPSysDescr = descr
			h.SNMPSysName = name
		}
	}
	if sshOn {
		if open, banner, osInfo, ok := probeSSH(h.IP, sshUsername, sshPassword); open {
			openPorts = append(openPorts, sshPort)
			if ok {
				h.SSHBanner = banner
				h.SSHOSInfo = osInfo
			}
		}
	}
	h.OpenPorts = openPorts
}

// probeSNMP is itself the port/response-check for SNMP -- UDP's
// connectionless nature makes a real port scan unreliable, so a GET
// request that gets no response within snmpTimeout (across snmpRetries
// retries) is the signal "no SNMP here," not a distinguishable error.
// Queries exactly the two universal MIB-II System-group OIDs
// (oidSysDescr/oidSysName); no custom OID configuration in v1.
func probeSNMP(ip, community string) (sysDescr, sysName string, ok bool) {
	return probeSNMPAddr(ip, snmpPort, community)
}

// probeSNMPAddr is probeSNMP with an injectable port -- the real, fixed
// snmpPort (161) is always what production actually uses (see probeSNMP);
// this split exists purely so discovery_test.go can point the real gosnmp
// client at a real local snmpd instance on an unprivileged test port,
// rather than needing root to bind 161.
func probeSNMPAddr(ip string, port uint16, community string) (sysDescr, sysName string, ok bool) {
	client := &gosnmp.GoSNMP{
		Target:    ip,
		Port:      port,
		Community: community,
		Version:   gosnmp.Version2c,
		Timeout:   snmpTimeout,
		Retries:   snmpRetries,
	}
	if err := client.Connect(); err != nil {
		return "", "", false
	}
	defer client.Conn.Close()

	result, err := client.Get([]string{oidSysDescr, oidSysName})
	if err != nil || len(result.Variables) < 2 {
		return "", "", false
	}
	// Positional, not name-matched -- SNMP GET responses preserve request
	// order, and matching by position sidesteps any ambiguity in how a
	// given agent echoes the requested OID string (leading dot or not).
	if b, isBytes := result.Variables[0].Value.([]byte); isBytes {
		sysDescr = string(b)
	}
	if b, isBytes := result.Variables[1].Value.([]byte); isBytes {
		sysName = string(b)
	}
	return sysDescr, sysName, sysDescr != "" || sysName != ""
}

// probeSSH first does a plain TCP dial to :22 -- the deliberate
// port/response-check gate, kept separate from the real credentialed
// attempt below, so a closed/filtered port never gets a real auth attempt
// against it. open reports whether that gate passed (worth recording in
// OpenPorts even if auth then fails -- a wrong password still means "SSH
// is genuinely running here"); ok reports whether a full authenticated
// session was established. No host-key pinning (InsecureIgnoreHostKey) --
// these are ad hoc discovered hosts with no prior trust relationship to
// pin against. On success, runs exactly one fixed, non-interactive command
// (`uname -a`) -- not a configurable command builder, deliberately, same
// "one fixed thing, not a builder" scoping this codebase already applies
// elsewhere (e.g. the reboot marker's single fixed snooze).
func probeSSH(ip, username, password string) (open bool, banner, osInfo string, ok bool) {
	return probeSSHAddr(ip, sshPort, username, password)
}

// probeSSHAddr is probeSSH with an injectable port -- see probeSNMPAddr's
// doc comment for why this split exists (testability against a real local
// server on an unprivileged port, not root-only 22).
func probeSSHAddr(ip string, port int, username, password string) (open bool, banner, osInfo string, ok bool) {
	addr := net.JoinHostPort(ip, strconv.Itoa(port))

	probe, err := net.DialTimeout("tcp", addr, sshDialTimeout)
	if err != nil {
		return false, "", "", false
	}
	probe.Close()
	open = true

	config := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         sshDialTimeout,
	}
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return open, "", "", false
	}
	defer client.Close()

	banner = strings.TrimSpace(string(client.ServerVersion()))

	session, err := client.NewSession()
	if err != nil {
		return open, banner, "", true // auth succeeded; the banner alone is still a real result
	}
	defer session.Close()

	done := make(chan struct{})
	var out []byte
	var runErr error
	go func() {
		out, runErr = session.CombinedOutput("uname -a")
		close(done)
	}()
	select {
	case <-done:
		if runErr == nil {
			osInfo = strings.TrimSpace(string(out))
		}
	case <-time.After(sshCommandTimeout):
		// A stuck command leaks this goroutine -- rare and bounded, same
		// accepted tradeoff as rfbserver.captureWithTimeout.
	}

	return open, banner, osInfo, true
}

// hostsInCIDR enumerates every usable host address in a CIDR range,
// excluding the network and broadcast addresses for ranges with a host
// portion (i.e. skips them for /31 and /32, which have none).
func hostsInCIDR(cidr string) ([]string, error) {
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return nil, err
	}
	ip4 := ipNet.IP.To4()
	if ip4 == nil {
		return nil, nil // IPv6 not supported in v1
	}
	ones, bits := ipNet.Mask.Size()
	hostBits := bits - ones
	if hostBits > 12 { // > /20, matches the worker's own cap -- refuse to walk anything larger
		return nil, nil
	}

	start := binary.BigEndian.Uint32(ip4)
	count := uint32(1) << hostBits
	var out []string
	for i := uint32(0); i < count; i++ {
		if hostBits > 1 && (i == 0 || i == count-1) {
			continue // skip network/broadcast
		}
		var b [4]byte
		binary.BigEndian.PutUint32(b[:], start+i)
		out = append(out, net.IP(b[:]).String())
	}
	return out, nil
}

func sweepAlive(targets []string, deadline time.Time) []string {
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var alive []string

	for _, ip := range targets {
		if time.Now().After(deadline) {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(ip string) {
			defer wg.Done()
			defer func() { <-sem }()
			if isAlive(ip) {
				mu.Lock()
				alive = append(alive, ip)
				mu.Unlock()
			}
		}(ip)
	}
	wg.Wait()
	return alive
}

// isAlive is a fast single-packet liveness check, deliberately not
// pingutil.Ping (see pingTimeout's comment above for why).
func isAlive(target string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), pingTimeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", "1", "-w", "800", target)
	} else {
		cmd = exec.CommandContext(ctx, "ping", "-c", "1", "-W", "1", target)
	}
	return cmd.Run() == nil
}

var (
	winArpLine  = regexp.MustCompile(`^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})\s`)
	unixArpLine = regexp.MustCompile(`\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)`)
	linuxNeigh  = regexp.MustCompile(`^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([0-9a-fA-F:]+)`)
)

// readARPTable dumps the OS's current ARP/neighbor table once (not per
// host — far cheaper than shelling out per address) and parses it into an
// IP->MAC map. MAC is only ever resolvable for a host on the same L2
// segment as the probe; a host reached via a router simply won't appear
// here, which is expected, not an error.
func readARPTable() map[string]string {
	out := map[string]string{}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("arp", "-a")
	case "linux":
		cmd = exec.Command("ip", "neigh", "show")
	default: // darwin and anything else with a BSD-style arp
		cmd = exec.Command("arp", "-a")
	}
	raw, err := cmd.Output()
	if err != nil {
		return out
	}

	scanner := bufio.NewScanner(strings.NewReader(string(raw)))
	for scanner.Scan() {
		line := scanner.Text()
		var m []string
		switch runtime.GOOS {
		case "windows":
			m = winArpLine.FindStringSubmatch(line)
		case "linux":
			m = linuxNeigh.FindStringSubmatch(line)
		default:
			m = unixArpLine.FindStringSubmatch(line)
		}
		if m == nil {
			continue
		}
		mac := strings.ToLower(strings.ReplaceAll(m[2], "-", ":"))
		out[m[1]] = mac
	}
	return out
}

// reverseLookup is best-effort with a short timeout -- a missing/slow PTR
// record is common and should never block or fail the rest of the scan.
func reverseLookup(ip string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	var resolver net.Resolver
	names, err := resolver.LookupAddr(ctx, ip)
	if err != nil || len(names) == 0 {
		return "", false
	}
	return strings.TrimSuffix(names[0], "."), true
}
