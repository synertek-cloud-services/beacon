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
	"strings"
	"sync"
	"time"
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
// pathological-run guard as filesize.Measure's walkBudget.
const overallBudget = 5 * time.Minute

type Host struct {
	IP       string `json:"ip"`
	MAC      string `json:"mac,omitempty"`
	Hostname string `json:"hostname,omitempty"`
}

type Result struct {
	Hosts []Host `json:"hosts"`
	Error string `json:"error,omitempty"`
}

func Scan(cidrRanges []string) Result {
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
	return Result{Hosts: hosts}
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
