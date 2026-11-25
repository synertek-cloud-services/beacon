//go:build windows

package screencapture

import (
	"log"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

var (
	_ rfbserver.Capturer                = (*AutoCapturer)(nil)
	_ rfbserver.DesktopFollower         = (*AutoCapturer)(nil)
	_ rfbserver.CursorShapeProvider     = (*AutoCapturer)(nil)
	_ rfbserver.CursorCompositingToggle = (*AutoCapturer)(nil)
)

// gdiFailuresBeforeDXGI is how many consecutive GDI Capture errors it takes
// before AutoCapturer tries DXGI. More than one so a transient failure (a
// desktop switch mid-call) doesn't flip a healthy machine over.
const gdiFailuresBeforeDXGI = 3

// AutoCapturer captures with GDI -- the proven path, unchanged for every
// machine where it works -- and falls over to DXGI Desktop Duplication when
// GDI keeps failing, which is what a display driven only by a virtual
// adapter (no GPU-backed device) does: BitBlt/GetDIBits fail there while
// Desktop Duplication still delivers frames. The switch happens inside
// Capture, i.e. on rfbserver's desktop-attached capture thread, and is
// one-way for the life of the session.
type AutoCapturer struct {
	gdi  *GDICapturer
	dxgi *DXGICapturer

	useDXGI     bool
	gdiFailures int
}

// NewCapturerForMonitor returns an AutoCapturer for the given monitor rect.
func NewCapturerForMonitor(rect win32.RECT) (*AutoCapturer, error) {
	gdi, err := NewGDICapturerForMonitor(rect)
	if err != nil {
		return nil, err
	}
	return &AutoCapturer{gdi: gdi, dxgi: newDXGICapturerForMonitor(rect)}, nil
}

// Size returns the target monitor's dimensions.
func (a *AutoCapturer) Size() (uint16, uint16) { return a.gdi.Size() }

// Capture implements rfbserver.Capturer.
func (a *AutoCapturer) Capture(pf rfb.PixelFormat) (rfb.Rectangle, error) {
	if a.useDXGI {
		return a.dxgi.Capture(pf)
	}

	rect, err := a.gdi.Capture(pf)
	if err == nil {
		a.gdiFailures = 0
		return rect, nil
	}
	a.gdiFailures++
	if a.gdiFailures < gdiFailuresBeforeDXGI {
		return rect, err
	}

	// GDI has now failed repeatedly. Only switch if DXGI can actually open;
	// otherwise stay on GDI and report its error as before.
	if openErr := a.dxgi.ensureOpen(); openErr != nil {
		log.Printf("screencapture: GDI capture failing (%v) and DXGI unavailable: %v", err, openErr)
		a.gdiFailures = 0
		return rect, err
	}
	log.Printf("screencapture: GDI capture failing (%v); switching to DXGI Desktop Duplication", err)
	a.useDXGI = true
	return a.dxgi.Capture(pf)
}

// FollowInputDesktop implements rfbserver.DesktopFollower. Attaching the
// thread to the input desktop is independent of the capture backend.
func (a *AutoCapturer) FollowInputDesktop() error { return a.gdi.FollowInputDesktop() }

// CursorShape implements rfbserver.CursorShapeProvider.
func (a *AutoCapturer) CursorShape(pf rfb.PixelFormat) rfb.Rectangle { return a.gdi.CursorShape(pf) }

// SetCursorCompositingEnabled implements rfbserver.CursorCompositingToggle,
// forwarding to whichever backends exist so the choice survives a later
// switch to DXGI.
func (a *AutoCapturer) SetCursorCompositingEnabled(enabled bool) {
	a.gdi.SetCursorCompositingEnabled(enabled)
	a.dxgi.SetCursorCompositingEnabled(enabled)
}
