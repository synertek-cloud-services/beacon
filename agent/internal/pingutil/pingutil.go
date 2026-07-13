// Package pingutil sends ICMP pings by shelling out to the platform's native
// ping binary and parsing its output, rather than raw ICMP sockets — those
// need elevated privileges on Unix, and this matches the codebase's existing
// convention for OS-specific data (see agent/internal/audit/hardware.go).
package pingutil

import (
	"context"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"time"
)

var (
	statsRe  = regexp.MustCompile(`(\d+) packets transmitted, (\d+) (?:packets )?received`)
	rttRe    = regexp.MustCompile(`(?:rtt|round-trip) min/avg/max(?:/mdev|/stddev) = [\d.]+/([\d.]+)/`)
	winStats = regexp.MustCompile(`Packets: Sent = (\d+), Received = (\d+)`)
	winAvg   = regexp.MustCompile(`Average = (\d+)ms`)
)

// Ping sends count ICMP echo requests to target and reports how many were
// sent/received and the average round-trip time of the received ones.
// A genuine failure to run ping at all (binary missing, deadline exceeded)
// is conservatively reported as fully unreachable rather than an error —
// "couldn't determine reachability" and "unreachable" should alert the same way.
func Ping(target string, count int) (sent, received int, avgRttMs float64) {
	deadline := time.Duration(count)*2*time.Second + 10*time.Second
	ctx, cancel := context.WithTimeout(context.Background(), deadline)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", strconv.Itoa(count), target)
	} else {
		cmd = exec.CommandContext(ctx, "ping", "-c", strconv.Itoa(count), target)
	}

	// ping exits non-zero on packet loss — that's expected, not a failure.
	// Still parse whatever stdout it produced.
	out, _ := cmd.Output()
	text := string(out)

	if runtime.GOOS == "windows" {
		if m := winStats.FindStringSubmatch(text); m != nil {
			sent, _ = strconv.Atoi(m[1])
			received, _ = strconv.Atoi(m[2])
		}
		if m := winAvg.FindStringSubmatch(text); m != nil {
			avgRttMs, _ = strconv.ParseFloat(m[1], 64)
		}
	} else {
		if m := statsRe.FindStringSubmatch(text); m != nil {
			sent, _ = strconv.Atoi(m[1])
			received, _ = strconv.Atoi(m[2])
		}
		if m := rttRe.FindStringSubmatch(text); m != nil {
			avgRttMs, _ = strconv.ParseFloat(m[1], 64)
		}
	}

	if sent == 0 {
		// Nothing parsed — ping never ran or produced unexpected output.
		sent = count
		received = 0
	}
	return sent, received, avgRttMs
}
