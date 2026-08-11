//go:build windows

// beacon-screenshare is a standalone, Windows-only helper launched into a
// logged-in user's own desktop session by the SYSTEM-context agent service
// (via agent/internal/usersession.RunAsActiveUser/RunAsSession/
// RunAsSessionAsSystem -- see agent/internal/session/screenshare.go), one
// process per Web Remote session. It dials the relay WebSocket directly
// (never the main agent process) and runs a minimal RFB server against the
// real GDI screen capture and SendInput injection backends, so the whole
// capture+injection loop happens natively inside the target session with no
// window-station tricks needed.
//
// Usage: beacon-screenshare.exe --session-id=<id> --ws-url=<wss://...> [--report-token=<token>] [--monitor=<device-name>]
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime/debug"
	"time"

	"github.com/gorilla/websocket"

	"github.com/synertek-cloud-services/beacon/agent/internal/credential"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/screencapture"
	"github.com/synertek-cloud-services/beacon/agent/internal/screeninject"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

func main() {
	// This is a -H=windowsgui binary with no console -- without redirecting
	// output somewhere durable, a crash, a failed dial, or a failed
	// capturer init is completely invisible: log.Fatal's default os.Stderr
	// write goes nowhere anyone can ever see, and the browser side just
	// times out after 70s with zero diagnostic trail anywhere. Found live:
	// a real "Web Remote doesn't connect" report had nothing in the main
	// agent's own agent.log either, since that's a different process and
	// this one was never wired to log anywhere at all.
	//
	// Writes to its own beacon-screenshare.log, not agent.log, deliberately
	// -- that same live report also turned up agent.log itself sitting
	// completely silent on the affected device (a still-unexplained
	// recurrence of the exact lost-startup-race class setupLogging exists
	// to fix), so sharing that path risks this logging losing the same
	// race for the same reason, for a second time, on the same box. A
	// fresh, differently-named file gets its own independent shot at
	// opening cleanly regardless of whatever's going on with agent.log.
	// Same retry-forever-on-a-lost-startup-race pattern either way,
	// proven in agent/cmd/agent/main.go's setupLogging.
	setupLogging(credential.Dir())

	sessionID := flag.String("session-id", "", "Beacon session ID")
	wsURL := flag.String("ws-url", "", "relay WebSocket URL")
	reportToken := flag.String("report-token", "", "per-session token authenticating the displays report (optional)")
	monitorFlag := flag.String("monitor", "", "target monitor's real GDI device name, e.g. \\\\.\\DISPLAY2 (optional, defaults to the primary monitor)")
	flag.Parse()

	log.Printf("beacon-screenshare: session %s: starting", *sessionID)

	// A panic here would otherwise be entirely silent for the same reason
	// log.Fatal's default output was -- no console, nothing else redirects
	// panic output anywhere durable. Recovering and logging it (then still
	// exiting non-zero) turns a completely invisible crash into at least
	// one diagnosable line.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("beacon-screenshare: session %s: PANIC: %v\n%s", *sessionID, r, debug.Stack())
			os.Exit(1)
		}
	}()

	if *wsURL == "" {
		log.Fatal("beacon-screenshare: --ws-url is required")
	}

	conn, _, err := websocket.DefaultDialer.Dial(*wsURL, nil)
	if err != nil {
		log.Fatalf("beacon-screenshare: session %s: dial: %v", *sessionID, err)
	}
	defer conn.Close()
	log.Printf("beacon-screenshare: session %s: connected to relay", *sessionID)

	monitors, err := win32.EnumMonitors()
	if err != nil {
		log.Fatalf("beacon-screenshare: session %s: enumerate monitors: %v", *sessionID, err)
	}
	log.Printf("beacon-screenshare: session %s: %d monitor(s) enumerated", *sessionID, len(monitors))

	// Best-effort, fire-and-forget -- a technician who never sees a
	// monitor list just gets no Displays switcher, not a broken session.
	// The RFB connection below doesn't depend on this succeeding at all.
	if *reportToken != "" {
		go reportDisplays(*sessionID, *wsURL, *reportToken, monitors)
	}

	targetRect := primaryMonitorRect(monitors)
	if *monitorFlag != "" {
		found := false
		for _, m := range monitors {
			if m.DeviceName == *monitorFlag {
				targetRect = m.Rect
				found = true
				break
			}
		}
		if !found {
			// A stale selection (e.g. the requested monitor was
			// disconnected since the technician picked it) falls back to
			// the primary rather than failing the session outright --
			// still capturing something beats refusing to connect.
			log.Printf("beacon-screenshare: session %s: requested monitor %q not found, falling back to primary", *sessionID, *monitorFlag)
		}
	}

	cap, err := screencapture.NewGDICapturerForMonitor(targetRect)
	if err != nil {
		log.Fatalf("beacon-screenshare: session %s: capturer: %v", *sessionID, err)
	}
	width, height := cap.Size()
	log.Printf("beacon-screenshare: session %s: capturer ready (%dx%d)", *sessionID, width, height)
	inj := screeninject.NewForMonitor(targetRect)

	if err := rfbserver.Serve(newWSByteStream(conn), cap, inj); err != nil {
		log.Printf("beacon-screenshare: session %s: Serve: %v", *sessionID, err)
	}
	log.Printf("beacon-screenshare: session %s: closed", *sessionID)
}

// primaryMonitorRect picks the primary monitor's rect out of an
// EnumMonitors result, falling back to the first entry if (contrary to
// how every real system is configured) none is flagged primary -- still
// capturing something beats refusing to start.
func primaryMonitorRect(monitors []win32.MonitorInfo) win32.RECT {
	for _, m := range monitors {
		if m.Primary {
			return m.Rect
		}
	}
	if len(monitors) > 0 {
		return monitors[0].Rect
	}
	return win32.RECT{}
}

// displayInfo is one entry in the JSON array POSTed to
// worker/src/routes/sessions.ts's POST .../displays -- field names and
// shape must match what that route (and, downstream, WebRemotePage.vue's
// Displays switcher) expects.
type displayInfo struct {
	DeviceName string `json:"device_name"`
	Index      int    `json:"index"`
	Primary    bool   `json:"primary"`
	Width      int32  `json:"width"`
	Height     int32  `json:"height"`
	X          int32  `json:"x"`
	Y          int32  `json:"y"`
}

// reportClient is a dedicated, short-timeout HTTP client for
// reportDisplays below -- mirrors agent/internal/updater's own dedicated-
// timeout-client convention, so a hung request here can never block the
// RFB session itself, which doesn't depend on this call at all.
var reportClient = &http.Client{Timeout: 10 * time.Second}

// reportDisplays POSTs the enumerated monitor list back to the worker,
// authenticated by the per-session report-token -- never the device's own
// long-lived credential, deliberately: this process runs inside the
// less-trusted interactive user's own session, not the SYSTEM-context
// agent, so only a narrowly-scoped, session-specific token is ever handed
// to it.
func reportDisplays(sessionID, wsURLStr, reportToken string, monitors []win32.MonitorInfo) {
	reportURL, err := deriveReportURL(wsURLStr, sessionID)
	if err != nil {
		log.Printf("beacon-screenshare: session %s: report displays: bad ws-url: %v", sessionID, err)
		return
	}

	displays := make([]displayInfo, len(monitors))
	for i, m := range monitors {
		displays[i] = displayInfo{
			DeviceName: m.DeviceName,
			Index:      i,
			Primary:    m.Primary,
			Width:      m.Rect.Right - m.Rect.Left,
			Height:     m.Rect.Bottom - m.Rect.Top,
			X:          m.Rect.Left,
			Y:          m.Rect.Top,
		}
	}
	body, err := json.Marshal(struct {
		Displays []displayInfo `json:"displays"`
	}{Displays: displays})
	if err != nil {
		log.Printf("beacon-screenshare: session %s: report displays: marshal: %v", sessionID, err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, reportURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("beacon-screenshare: session %s: report displays: build request: %v", sessionID, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+reportToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := reportClient.Do(req)
	if err != nil {
		log.Printf("beacon-screenshare: session %s: report displays: %v", sessionID, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("beacon-screenshare: session %s: report displays: worker returned %d", sessionID, resp.StatusCode)
	}
}

// deriveReportURL builds the displays-report endpoint from the same
// relay WebSocket URL this process was already given (--ws-url), rather
// than needing a separate worker-URL flag -- wss://host/v1/sessions/<id>/ws
// becomes https://host/v1/sessions/<id>/displays (ws/wss -> http/https,
// same host, sessionID already known independently).
func deriveReportURL(wsURLStr, sessionID string) (string, error) {
	u, err := url.Parse(wsURLStr)
	if err != nil {
		return "", err
	}
	scheme := "https"
	if u.Scheme == "ws" {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/v1/sessions/%s/displays", scheme, u.Host, sessionID), nil
}

// setupLogging mirrors agent/cmd/agent/main.go's function of the same name
// almost verbatim -- same lost-startup-race root cause, same fix (try
// once synchronously, then retry every 5s indefinitely in the background
// until it succeeds), a different target file (see main's own comment on
// why: independent from agent.log on purpose). Not extracted into a shared
// package: it's ~15 lines, and both call sites already independently
// import unrelated things (this one has no existing dependency on
// anything setupLogging would need to be factored alongside).
func setupLogging(credDir string) {
	if err := os.MkdirAll(credDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(credDir, "beacon-screenshare.log")
	if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(os.Stderr, f))
		return
	}
	go func() {
		for {
			time.Sleep(5 * time.Second)
			f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				continue
			}
			log.SetOutput(io.MultiWriter(os.Stderr, f))
			log.Printf("beacon-screenshare: beacon-screenshare.log opened (delayed -- initial attempt lost a startup sharing-mode race)")
			return
		}
	}()
}

// wsByteStream adapts a *websocket.Conn into an io.ReadWriter, buffering
// leftover bytes between ReadMessage calls -- unlike shell.go's unbounded
// PTY byte stream, noVNC can and does batch multiple RFB client messages
// into one outgoing WebSocket frame (e.g. SetPixelFormat+SetEncodings+the
// first FramebufferUpdateRequest arrive together right after ServerInit).
// A naive one-ReadMessage-per-Read adapter would silently drop everything
// in a batched frame after the first message.
type wsByteStream struct {
	conn *websocket.Conn
	buf  []byte
}

func newWSByteStream(conn *websocket.Conn) *wsByteStream {
	return &wsByteStream{conn: conn}
}

func (s *wsByteStream) Read(p []byte) (int, error) {
	for len(s.buf) == 0 {
		mt, data, err := s.conn.ReadMessage()
		if err != nil {
			return 0, err
		}
		if mt == websocket.BinaryMessage {
			s.buf = data
		}
		// Non-binary frames (e.g. a stray text/control frame) are
		// silently skipped -- RFB has no legitimate use for one here.
	}
	n := copy(p, s.buf)
	s.buf = s.buf[n:]
	return n, nil
}

func (s *wsByteStream) Write(p []byte) (int, error) {
	if err := s.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}
