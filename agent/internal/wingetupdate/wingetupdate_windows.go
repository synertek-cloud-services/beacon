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
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
	wingetPath, err := resolveWinget()
	if err != nil {
		return Result{Error: err.Error()}
	}

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
		cmdLine := wingetPath + " " + strings.Join(args, " ")
		ran = append(ran, cmdLine)
		out.WriteString("=== " + cmdLine + " ===\n")

		ctx, cancel := context.WithTimeout(context.Background(), wingetTimeout)
		cmd := exec.CommandContext(ctx, wingetPath, args...)
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

// resolveWinget locates the real winget.exe path instead of relying on
// PATH. winget ships inside the "App Installer" package at
// %ProgramFiles%\WindowsApps\Microsoft.DesktopAppInstaller_<version>_x64__8wekyb3d8bbwe\winget.exe
// and is only ever exposed on PATH via a per-user App Execution Alias
// (%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe, a reparse point) -- the
// agent's own SYSTEM-context service, running as a different account
// entirely, never sees that alias. Confirmed live on a real Windows 365
// Cloud PC: a plain "winget" invocation from the agent service failed with
// "executable file not found in %PATH%" even though winget was genuinely
// installed and working fine for the interactive user. The versioned
// folder name changes with every winget update, so it's globbed for and
// resolved fresh on every call rather than assumed/cached.
func resolveWinget() (string, error) {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	matches, err := filepath.Glob(filepath.Join(programFiles, "WindowsApps", "Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe", "winget.exe"))
	if err != nil {
		return "", fmt.Errorf("wingetupdate: glob for winget.exe: %w", err)
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("wingetupdate: winget.exe not found under %s\\WindowsApps -- is the App Installer package installed?", programFiles)
	}
	// Version strings in the folder name sort correctly lexicographically
	// (e.g. "1.26.509.0" < "2025.926.104.0"); the highest one is the
	// currently-active version when more than one is present (an old
	// version's folder can briefly survive an update).
	sort.Strings(matches)
	return matches[len(matches)-1], nil
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
