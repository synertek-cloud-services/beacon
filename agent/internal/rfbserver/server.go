// Package rfbserver orchestrates the agent/internal/rfb wire codec into a
// working single-client RFB server, against a Capturer/Injector interface
// pair rather than concrete OS calls -- this is what lets the handshake and
// message-loop sequencing be unit-tested without any Windows dependency.
// The real Windows-backed implementations of these interfaces live in
// agent/internal/screencapture and agent/internal/screeninject.
package rfbserver

import (
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
)

// Capturer captures the primary monitor's current contents.
type Capturer interface {
	// Size returns the primary monitor's dimensions in real pixels
	// (post-DPI-awareness-fix -- see screencapture.NewGDICapturer).
	Size() (width, height uint16)
	// Capture returns one full-frame rectangle (X=0, Y=0, W=Size().width,
	// H=Size().height) packed to match pf.
	Capture(pf rfb.PixelFormat) (rfb.Rectangle, error)
}

// Injector injects keyboard/mouse input into the captured session.
type Injector interface {
	KeyEvent(down bool, keysym uint32) error
	PointerEvent(mask uint8, x, y uint16) error
}

// CursorShapeProvider is an optional Capturer capability: a fixed (v1 is
// non-animated -- one hardcoded arrow shape, not real per-icon Windows
// cursor tracking) cursor shape to advertise via the RFB Cursor
// pseudo-encoding, once a connecting client signals support for it (RFC
// 6143 §7.7.2, encoding -239). A client that supports this renders the
// cursor locally, at its own tracked mouse position, once it has the
// shape -- real-hardware testing found mouse movement felt "choppy"
// because every bit of visible cursor movement otherwise requires a full
// capture-and-send round trip (the cursor is normally baked directly into
// the captured pixels); this is the actual fix, not just a nice-to-have.
// Optional because the fake Capturer used by this package's own tests has
// no real cursor to report.
type CursorShapeProvider interface {
	// CursorShape returns one rfb.NewCursorRectangle-built Rectangle, with
	// pixel data packed to pf (the client's currently negotiated
	// PixelFormat -- the same one passed to Capture, and for the same
	// reason: the shape's pixel bytes must match whatever byte layout the
	// client already allocated its render buffer for). Called at most once
	// per session (v1's shape never changes), so it's fine for this to do
	// real work rather than returning a precomputed constant.
	CursorShape(pf rfb.PixelFormat) rfb.Rectangle
}

// CursorCompositingToggle is an optional Capturer capability: lets Serve
// tell a capturer to stop baking the OS cursor into captured frame pixels
// once the connecting client supports the Cursor pseudo-encoding --
// otherwise a supporting client would show two overlapping cursors (its
// own locally-rendered one, plus the server's baked-in one). A Capturer
// that doesn't implement this (e.g. the test fakes) is simply never asked.
type CursorCompositingToggle interface {
	SetCursorCompositingEnabled(enabled bool)
}

// bandHeight is the number of framebuffer rows sent per FramebufferUpdate
// rectangle. Splitting into bands (rather than one giant rectangle per
// frame) keeps a single WebSocket message comfortably under any message-
// size ceiling regardless of monitor resolution -- RFB already supports
// multiple rectangles per update for exactly this reason.
const bandHeight = 128

// captureTimeout bounds how long a single Capture() call is allowed to
// block. Generous relative to a normal capture (well under a second even
// on real hardware), but bounded so a GDI call that hangs outright --
// rather than cleanly returning an error -- can't take the whole session
// down with it. Known, deliberate tradeoff: Go has no way to forcibly
// cancel an arbitrary blocking call, so a timed-out Capture() leaves its
// goroutine permanently stuck (a small, bounded leak) rather than actually
// stopping the hung syscall -- acceptable because this only fires for a
// rare, bounded condition (a UAC prompt or similar desktop switch), not
// continuously, and a session that survives with a leaked goroutine per
// occurrence is a clear improvement over one that hangs forever.
const captureTimeout = 3 * time.Second

// captureWithTimeout runs cap.Capture(pf) with a bounded timeout, since a
// desktop-switch condition (see the UAC comment where this is called) has
// been observed to hang a GDI call outright rather than return a clean
// error.
func captureWithTimeout(cap Capturer, pf rfb.PixelFormat, timeout time.Duration) (rfb.Rectangle, error) {
	type result struct {
		rect rfb.Rectangle
		err  error
	}
	done := make(chan result, 1)
	go func() {
		rect, err := cap.Capture(pf)
		done <- result{rect, err}
	}()
	select {
	case r := <-done:
		return r.rect, r.err
	case <-time.After(timeout):
		return rfb.Rectangle{}, fmt.Errorf("capture timed out after %s", timeout)
	}
}

// defaultPixelFormat is the format advertised in ServerInit before any
// client SetPixelFormat negotiation -- 32bpp truecolor, matching what a
// real noVNC client requests anyway.
func defaultPixelFormat() rfb.PixelFormat {
	return rfb.PixelFormat{
		BitsPerPixel: 32, Depth: 24, BigEndian: false, TrueColor: true,
		RedMax: 255, GreenMax: 255, BlueMax: 255,
		RedShift: 16, GreenShift: 8, BlueShift: 0,
	}
}

// Serve runs the full RFB handshake against rw, then services
// FramebufferUpdateRequest/KeyEvent/PointerEvent messages until the client
// disconnects or a fatal I/O error occurs. It blocks until the session
// ends; callers run it in its own goroutine per connection.
//
// FramebufferUpdateRequest handling (capture, which is deliberately paced
// -- see screencapture's minCaptureInterval -- and can take real time even
// unpaced) runs on its own goroutine, decoupled from the read loop below.
// Real-hardware testing found that serializing capture and input through
// one sequential loop made mouse movement feel laggy: noVNC sends
// PointerEvent messages far more often than FramebufferUpdateRequests, and
// any that arrived while a capture was in flight had to wait for it to
// finish before the loop could even read them, let alone inject them.
// KeyEvent/PointerEvent still update via the caller's Injector immediately
// and in-order as the read loop sees them -- only the (slower, one-way)
// capture-and-send path was ever the bottleneck.
func Serve(rw io.ReadWriter, cap Capturer, inj Injector) error {
	if err := rfb.WriteProtocolVersion(rw); err != nil {
		return fmt.Errorf("rfbserver: write protocol version: %w", err)
	}
	if _, err := rfb.ReadProtocolVersion(rw); err != nil {
		return fmt.Errorf("rfbserver: read protocol version: %w", err)
	}

	if err := rfb.WriteSecurityHandshake(rw); err != nil {
		return fmt.Errorf("rfbserver: write security handshake: %w", err)
	}
	if _, err := rfb.ReadSecurityChoice(rw); err != nil {
		return fmt.Errorf("rfbserver: read security choice: %w", err)
	}
	// Only one security type (None) was ever offered, so any successfully
	// read choice is necessarily that one -- always report success.
	if err := rfb.WriteSecurityResult(rw, true); err != nil {
		return fmt.Errorf("rfbserver: write security result: %w", err)
	}

	if _, err := rfb.ReadClientInit(rw); err != nil {
		return fmt.Errorf("rfbserver: read client init: %w", err)
	}

	width, height := cap.Size()

	cursorShaper, _ := cap.(CursorShapeProvider)
	cursorToggle, _ := cap.(CursorCompositingToggle)

	var stateMu sync.Mutex
	pf := defaultPixelFormat()
	// cursorEncodingSupported is set from the client's SetEncodings message
	// (read loop, below) and consumed by the capture goroutine, which is
	// the one place that actually acts on it -- see the comment at its use
	// site for why this is handled there rather than immediately upon
	// receipt.
	cursorEncodingSupported := false
	// cursorHandled tracks whether the capture goroutine has already
	// disabled server-side cursor compositing and sent the one-time cursor
	// shape rectangle for this session, so it only ever does so once.
	cursorHandled := false

	// updateRequested coalesces pending FramebufferUpdateRequests: a
	// buffered channel of size 1 where a send is dropped (not blocked) if
	// one is already pending. The capture goroutine only ever needs to
	// know "there's at least one outstanding request to satisfy," not how
	// many arrived while it was busy -- coalescing keeps a burst of
	// requests (noVNC's own immediate-re-request behavior) from queuing
	// up redundant captures.
	updateRequested := make(chan struct{}, 1)
	captureErr := make(chan error, 1)

	go func() {
		defer close(captureErr)
		for range updateRequested {
			stateMu.Lock()
			currentPF := pf
			needsCursorHandling := cursorEncodingSupported && !cursorHandled
			if needsCursorHandling {
				cursorHandled = true
			}
			stateMu.Unlock()

			var cursorRect *rfb.Rectangle
			if needsCursorHandling {
				// Order matters: disable compositing *before* capturing the
				// next frame, so that frame (and every one after) stops
				// baking the cursor into the pixels -- the client is about
				// to start rendering it locally instead. A capturer that
				// doesn't support toggling (e.g. this package's own test
				// fakes) is simply left alone.
				if cursorToggle != nil {
					cursorToggle.SetCursorCompositingEnabled(false)
				}
				if cursorShaper != nil {
					rect := cursorShaper.CursorShape(currentPF)
					cursorRect = &rect
				}
			}

			full, err := captureWithTimeout(cap, currentPF, captureTimeout)
			if err != nil {
				// Deliberately non-fatal: a Capture() failure or hang is
				// often a transient, expected condition, not a dead
				// session -- found live when a UAC prompt appeared
				// mid-session and killed the whole connection. UAC runs on
				// Windows' secure desktop, a different desktop than the
				// one beacon-screenshare.exe is bound to (winsta0\default,
				// see usersession.RunAsSession), so GDI capture calls can
				// plausibly fail *or block indefinitely* for as long as
				// the secure desktop is active -- captureWithTimeout
				// covers both, not just a cleanly-returned error (a first
				// version of this fix only handled the error case, and
				// real-hardware testing showed the session still died,
				// consistent with a hang rather than a clean failure). Log
				// and answer with an empty update instead of tearing down
				// an otherwise-healthy connection -- the next
				// FramebufferUpdateRequest naturally retries once the
				// desktop switches back. A write failure below is still
				// treated as fatal: that's a real connection problem, not
				// a transient capture one.
				log.Printf("rfbserver: capture: %v (skipping this update, session stays open)", err)
				// Still deliver a pending cursor shape even though the
				// screen capture itself failed/timed out -- cursorHandled
				// was already latched true above, so this is the only
				// chance this session gets to send it before compositing
				// stays permanently disabled with no shape ever rendered.
				var rects []rfb.Rectangle
				if cursorRect != nil {
					rects = []rfb.Rectangle{*cursorRect}
				}
				if werr := rfb.WriteFramebufferUpdate(rw, rects); werr != nil {
					captureErr <- fmt.Errorf("rfbserver: write empty framebuffer update after capture error: %w", werr)
					return
				}
				continue
			}
			rects := chunkRectangle(full, currentPF, bandHeight)
			if cursorRect != nil {
				rects = append([]rfb.Rectangle{*cursorRect}, rects...)
			}
			if err := rfb.WriteFramebufferUpdate(rw, rects); err != nil {
				captureErr <- fmt.Errorf("rfbserver: write framebuffer update: %w", err)
				return
			}
		}
	}()
	defer close(updateRequested)

	if err := rfb.WriteServerInit(rw, width, height, pf, "Beacon Web Remote"); err != nil {
		return fmt.Errorf("rfbserver: write server init: %w", err)
	}

	for {
		msg, err := rfb.ReadClientMessage(rw)
		if err != nil {
			if err == io.EOF {
				return nil // clean client disconnect
			}
			return fmt.Errorf("rfbserver: read client message: %w", err)
		}

		// Surface a capture-goroutine failure promptly rather than only
		// noticing it once the next read also happens to fail -- a write
		// error there doesn't necessarily unblock a concurrent read on
		// the same connection right away.
		select {
		case err := <-captureErr:
			if err != nil {
				return err
			}
		default:
		}

		switch m := msg.(type) {
		case rfb.SetPixelFormatMsg:
			// Must be honored, not discarded (unlike SetEncodings below):
			// noVNC allocates its own render buffer to match whatever
			// format it requests immediately after ServerInit, and
			// continuing to send a different byte layout corrupts the
			// image client-side.
			stateMu.Lock()
			pf = m.PixelFormat
			stateMu.Unlock()

		case rfb.SetEncodingsMsg:
			// This server only ever sends Raw for ordinary screen content
			// regardless of what's offered/negotiated here -- the one
			// exception is checking for Cursor pseudo-encoding (-239)
			// support, which the capture goroutine acts on (see its own
			// comment) rather than this read loop, since only that
			// goroutine is allowed to write to rw.
			for _, enc := range m.Encodings {
				if enc == rfb.EncodingCursorPseudo {
					stateMu.Lock()
					cursorEncodingSupported = true
					stateMu.Unlock()
					break
				}
			}

		case rfb.FramebufferUpdateRequestMsg:
			select {
			case updateRequested <- struct{}{}:
			default: // one already pending -- coalesce, don't queue a second
			}

		case rfb.KeyEventMsg:
			// Deliberately non-fatal, same reasoning as the capture-error
			// handling above: a UAC prompt's secure desktop is a separate
			// desktop from the one this process's input is bound to
			// (winsta0\default), and SendInput synthesizing input into a
			// desktop it can't currently reach is a real, expected,
			// transient failure -- confirmed live: a first version of this
			// fix only made *capture* errors survivable, and real-hardware
			// testing showed UAC still killed the session outright, because
			// this injection path still treated any SendInput failure
			// (which real-hardware testing that same UAC prompt very
			// plausibly also triggers -- the technician has no way to know
			// a secure desktop just appeared and keeps clicking/typing) as
			// fatal. Injection failures have nothing to do with whether the
			// underlying WebSocket connection itself is healthy, unlike a
			// WriteFramebufferUpdate failure, so treating them as fatal was
			// never actually justified even outside the UAC case.
			if err := inj.KeyEvent(m.Down, m.Keysym); err != nil {
				log.Printf("rfbserver: key event: %v (dropping this event, session stays open)", err)
			}

		case rfb.PointerEventMsg:
			if err := inj.PointerEvent(m.ButtonMask, m.X, m.Y); err != nil {
				log.Printf("rfbserver: pointer event: %v (dropping this event, session stays open)", err)
			}

		case rfb.ClientCutTextMsg:
			// Clipboard sync is out of scope for v1 -- silently dropped.

		default:
			return fmt.Errorf("rfbserver: unhandled client message type %T", msg)
		}
	}
}

// chunkRectangle splits one full-frame rectangle into fixed-height
// horizontal bands. pf must be the format full.Pixels is already packed
// to, so each row's byte width can be computed correctly.
func chunkRectangle(full rfb.Rectangle, pf rfb.PixelFormat, height uint16) []rfb.Rectangle {
	if full.H == 0 || full.W == 0 {
		return nil
	}
	bytesPerPixel := int(pf.BitsPerPixel) / 8
	rowBytes := int(full.W) * bytesPerPixel

	var rects []rfb.Rectangle
	for y := uint16(0); y < full.H; y += height {
		h := height
		if remaining := full.H - y; h > remaining {
			h = remaining
		}
		start := int(y) * rowBytes
		end := start + int(h)*rowBytes
		if end > len(full.Pixels) {
			end = len(full.Pixels)
		}
		rects = append(rects, rfb.Rectangle{
			X: full.X, Y: full.Y + y, W: full.W, H: h,
			Pixels: full.Pixels[start:end],
		})
	}
	return rects
}
