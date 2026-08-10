//go:build windows

// Package wingetupdate drives Windows Package Manager (winget, built into
// modern Windows 10/11) to detect and silently upgrade third-party
// software -- Software Management's actual update mechanism, confirmed via
// AskUserQuestion before building. Chosen deliberately over a hand-rolled
// per-app installer-URL/version-detection catalog: winget's own huge,
// externally-maintained package database means Beacon never has to build
// or keep one, which is the real ongoing-maintenance cost a from-scratch
// catalog would otherwise carry.
//
// Deliberately raw-output-passthrough, not a structured per-package
// success/failure result -- unlike wuinstall's PowerShell+ConvertTo-Json
// approach (a real, reliable structured-output contract), winget is a
// plain CLI with no guaranteed stable machine-readable output mode across
// every installed version, and this sandbox has no winget install to
// verify a hand-parsed format against. Surfacing winget's own real text
// output verbatim through the existing Command History Stdout/Stderr
// display (already generic, already used for run_script results) is more
// trustworthy than a parser that might silently misread an unverified
// format.
package wingetupdate

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// wingetTimeout is per-invocation, not per-Upgrade-call -- an allowlist of
// several package IDs runs one invocation per ID (see Upgrade below), each
// getting its own budget rather than sharing one across all of them.
// Generous relative to collectPatches' 180s: a single app's silent
// installer can itself take minutes (matches install_patches' own 15-
// minute reasoning for the same kind of download-then-install work).
const wingetTimeout = 10 * time.Minute

// Result is intentionally raw-text, not structured -- see the package doc
// comment for why. Ran records the literal command line(s) executed
// (redundant with Output's own echoed command, but useful as a quick
// summary without scrolling a technician has to read through potentially
// long real winget output).
type Result struct {
	Ran    []string `json:"ran"`
	Output string   `json:"output"` // combined stdout+stderr, every invocation concatenated with a header
	AllOK  bool     `json:"all_ok"` // true only if every invocation exited 0
	Error  string   `json:"error,omitempty"`
}

// Upgrade runs `winget upgrade` -- either --all (packageIDs empty) in a
// single invocation, or one `--id <id>` invocation per entry in packageIDs
// (winget's own CLI only accepts one --id per invocation, so an allowlist
// of several packages genuinely needs several separate calls, each
// captured and reported independently so one failure doesn't hide the
// others' real output).
func Upgrade(packageIDs []string) Result {
	var invocations [][]string
	if len(packageIDs) == 0 {
		invocations = [][]string{upgradeArgs("")}
	} else {
		for _, id := range packageIDs {
			invocations = append(invocations, upgradeArgs(id))
		}
	}

	var ran []string
	var out strings.Builder
	allOK := true

	for _, args := range invocations {
		cmdLine := "winget " + strings.Join(args, " ")
		ran = append(ran, cmdLine)
		out.WriteString("=== " + cmdLine + " ===\n")

		ctx, cancel := context.WithTimeout(context.Background(), wingetTimeout)
		cmd := exec.CommandContext(ctx, "winget", args...)
		var buf bytes.Buffer
		cmd.Stdout = &buf
		cmd.Stderr = &buf
		err := cmd.Run()
		cancel()

		out.Write(buf.Bytes())
		out.WriteString("\n")
		if err != nil {
			allOK = false
			out.WriteString(fmt.Sprintf("(exit error: %v)\n", err))
		}
	}

	return Result{Ran: ran, Output: out.String(), AllOK: allOK}
}

func upgradeArgs(packageID string) []string {
	args := []string{"upgrade"}
	if packageID != "" {
		args = append(args, "--id", packageID, "--exact")
	} else {
		args = append(args, "--all")
	}
	// --disable-interactivity suppresses any interactive prompt winget might
	// otherwise show (the agent has no interactive session to answer one
	// from); --silent passes through to each package's own installer;
	// --accept-*-agreements is required non-interactively the first time
	// winget or a given source's license terms haven't been accepted yet.
	args = append(args, "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements")
	return args
}
