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

// bandHeight is the number of framebuffer rows sent per FramebufferUpdate
// rectangle. Splitting into bands (rather than one giant rectangle per
// frame) keeps a single WebSocket message comfortably under any message-
// size ceiling regardless of monitor resolution -- RFB already supports
// multiple rectangles per update for exactly this reason.
const bandHeight = 128

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

	var pfMu sync.Mutex
	pf := defaultPixelFormat()

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
			pfMu.Lock()
			currentPF := pf
			pfMu.Unlock()

			full, err := cap.Capture(currentPF)
			if err != nil {
				// Deliberately non-fatal: a Capture() failure is often a
				// transient, expected condition, not a dead session --
				// found live when a UAC prompt appeared mid-session and
				// killed the whole connection. UAC runs on Windows' secure
				// desktop, a different desktop than the one
				// beacon-screenshare.exe is bound to (winsta0\default, see
				// usersession.RunAsSession), so GDI capture calls can
				// plausibly fail for as long as the secure desktop is
				// active. Log and answer with an empty update instead of
				// tearing down an otherwise-healthy connection -- the next
				// FramebufferUpdateRequest naturally retries once the
				// desktop switches back. A write failure below is still
				// treated as fatal: that's a real connection problem, not
				// a transient capture one.
				log.Printf("rfbserver: capture: %v (skipping this update, session stays open)", err)
				if werr := rfb.WriteFramebufferUpdate(rw, nil); werr != nil {
					captureErr <- fmt.Errorf("rfbserver: write empty framebuffer update after capture error: %w", werr)
					return
				}
				continue
			}
			if err := rfb.WriteFramebufferUpdate(rw, chunkRectangle(full, currentPF, bandHeight)); err != nil {
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
			pfMu.Lock()
			pf = m.PixelFormat
			pfMu.Unlock()

		case rfb.SetEncodingsMsg:
			// This server only ever sends Raw regardless of what's
			// offered/negotiated here -- deliberately ignored for v1.

		case rfb.FramebufferUpdateRequestMsg:
			select {
			case updateRequested <- struct{}{}:
			default: // one already pending -- coalesce, don't queue a second
			}

		case rfb.KeyEventMsg:
			if err := inj.KeyEvent(m.Down, m.Keysym); err != nil {
				return fmt.Errorf("rfbserver: key event: %w", err)
			}

		case rfb.PointerEventMsg:
			if err := inj.PointerEvent(m.ButtonMask, m.X, m.Y); err != nil {
				return fmt.Errorf("rfbserver: pointer event: %w", err)
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
