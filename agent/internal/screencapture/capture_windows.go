//go:build windows

// Package screencapture implements agent/internal/rfbserver.Capturer using
// GDI BitBlt -- Windows-only, matching Web Remote's v1 scope. Cannot be
// exercised in a non-Windows development sandbox; cross-compile-checked
// only until confirmed on real Windows hardware.
package screencapture

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

var _ rfbserver.Capturer = (*GDICapturer)(nil)
var _ rfbserver.DesktopFollower = (*GDICapturer)(nil)

// minCaptureInterval bounds Capture() to roughly 30fps. rfbserver.Serve's
// loop is capture-on-request with no throttling of its own -- real noVNC
// re-issues a FramebufferUpdateRequest immediately after every response,
// so without a floor here this would BitBlt/GetDIBits back-to-back as fast
// as the machine allows, burning CPU on captures nobody can perceive the
// difference of. 30fps is smooth enough for a remote-support/admin session
// (not video/gaming) and bounds worst-case churn regardless of how fast
// the client re-requests -- confirmed necessary by a real-hardware report
// of "horrendously slow" performance even on a LAN, where bandwidth was
// never the bottleneck; see the diffing comment below for the other half
// of that fix.
const minCaptureInterval = 33 * time.Millisecond

var (
	_ rfbserver.CursorShapeProvider     = (*GDICapturer)(nil)
	_ rfbserver.CursorCompositingToggle = (*GDICapturer)(nil)
)

// GDICapturer captures a single monitor's rect (x, y, width, height, in
// virtual-desktop coordinates) via BitBlt. Implements rfbserver.Capturer.
type GDICapturer struct {
	// x, y are the monitor's virtual-desktop origin -- (0,0) for the
	// primary monitor by Windows' own definition, genuinely negative for a
	// monitor positioned above/left of it. width, height are the monitor's
	// own pixel dimensions, not the full virtual desktop's.
	x, y, width, height int32

	// cursorCompositingEnabled starts true (bake the OS cursor into
	// captured frames, matching pre-Cursor-pseudo-encoding behavior) and
	// is set false by rfbserver.Serve once a connecting client signals
	// Cursor pseudo-encoding support -- see SetCursorCompositingEnabled.
	cursorCompositingEnabled bool

	lastCaptureAt time.Time
	// prevRaw holds the previous call's raw (pre-PackRow, 32bpp BGRA)
	// frame, compared against the newly captured one to find which rows
	// actually changed -- see diffChangedRowRange. Only that row range is
	// packed and returned; an unchanged frame returns a zero-height
	// Rectangle (rfbserver/chunkRectangle already treat H==0 as "send no
	// rectangles," an empty FramebufferUpdate, no code change needed
	// there). Not a copy-on-write scheme: each call allocates a fresh raw
	// buffer, so simply keeping the previous call's buffer around and
	// swapping the pointer is safe with no aliasing risk.
	prevRaw []byte

	// desktopMu guards lastDesktop -- see FollowInputDesktop's own doc
	// comment for why this field needs a mutex when nothing else on this
	// struct does.
	desktopMu   sync.Mutex
	lastDesktop string
}

// NewGDICapturer enables per-monitor DPI awareness and captures the
// primary monitor -- a thin wrapper around NewGDICapturerForMonitor for
// the common (and, until multi-monitor support, only) case, so every
// existing caller keeps working unchanged while now riding the same
// EnumMonitors-based rect resolution a specific-monitor capturer uses.
func NewGDICapturer() (*GDICapturer, error) {
	monitors, err := win32.EnumMonitors()
	if err != nil {
		return nil, fmt.Errorf("screencapture: enumerate monitors: %w", err)
	}
	for _, m := range monitors {
		if m.Primary {
			return NewGDICapturerForMonitor(m.Rect)
		}
	}
	// Every real system has exactly one primary monitor by definition, but
	// fall back to the first enumerated entry rather than erroring outright
	// if that invariant is somehow violated -- still capturing something
	// beats refusing to start Web Remote entirely.
	return NewGDICapturerForMonitor(monitors[0].Rect)
}

// NewGDICapturerForMonitor enables per-monitor DPI awareness (must happen
// once, before any screen-dimension or coordinate call -- without it, a
// scaled display reports virtualized dimensions that silently disagree
// with screeninject's coordinate mapping) and targets the given monitor
// rect (virtual-desktop coordinates, as returned by win32.EnumMonitors).
func NewGDICapturerForMonitor(rect win32.RECT) (*GDICapturer, error) {
	if err := win32.EnableDPIAwareness(); err != nil {
		// Non-fatal: capture still works, just risks a coordinate mismatch
		// on a scaled display -- log and continue rather than refuse to
		// start Web Remote entirely over a DPI-awareness API failure.
		log.Printf("screencapture: enable DPI awareness: %v (continuing)", err)
	}

	width := rect.Right - rect.Left
	height := rect.Bottom - rect.Top
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("screencapture: invalid monitor dimensions %dx%d", width, height)
	}
	return &GDICapturer{
		x: rect.Left, y: rect.Top, width: width, height: height,
		cursorCompositingEnabled: true,
	}, nil
}

// SetCursorCompositingEnabled implements rfbserver.CursorCompositingToggle.
// Called (at most once, from false's own only caller) once a connecting
// client has signaled support for the Cursor pseudo-encoding, so this
// capturer stops baking the OS cursor into captured pixels -- the client
// is about to start rendering its own locally-tracked cursor instead, and
// leaving compositing on would show two overlapping cursors.
func (c *GDICapturer) SetCursorCompositingEnabled(enabled bool) {
	c.cursorCompositingEnabled = enabled
}

// CursorShape implements rfbserver.CursorShapeProvider. v1 sends a fixed
// placeholder arrow (see cursorshape.go's own doc comment for why this
// isn't a real extraction of the OS's actual cursor icon) rather than
// reading anything from this capturer's own GDI state.
func (c *GDICapturer) CursorShape(pf rfb.PixelFormat) rfb.Rectangle {
	return arrowCursorRectangle(pf)
}

// Size returns this capturer's target monitor's dimensions.
func (c *GDICapturer) Size() (uint16, uint16) {
	return uint16(c.width), uint16(c.height)
}

// Capture takes a screenshot of this capturer's target monitor and returns
// only the rows that changed since the previous call, packed to match pf --
// an unchanged frame returns a zero-height Rectangle rather than the whole
// screen. Paced to at most ~30fps (see minCaptureInterval).
func (c *GDICapturer) Capture(pf rfb.PixelFormat) (rfb.Rectangle, error) {
	if wait := minCaptureInterval - time.Since(c.lastCaptureAt); wait > 0 {
		time.Sleep(wait)
	}
	c.lastCaptureAt = time.Now()

	// GetDC(0) returns a DC spanning the full virtual desktop (well-
	// established Win32 behavior, not hand-derived), not just the primary
	// monitor -- confirmed directly, not assumed. A BitBlt source origin
	// of (c.x, c.y) (this monitor's own virtual-desktop offset, possibly
	// negative) rather than a hardcoded (0,0) is therefore all that's
	// needed to target any monitor, not just the primary one.
	screenDC, err := win32.GetDC(0) // 0 = the whole virtual desktop
	if err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: GetDC: %w", err)
	}
	defer win32.ReleaseDC(0, screenDC)

	memDC, err := win32.CreateCompatibleDC(screenDC)
	if err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: CreateCompatibleDC: %w", err)
	}
	defer win32.DeleteDC(memDC)

	bmp, err := win32.CreateCompatibleBitmap(screenDC, c.width, c.height)
	if err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: CreateCompatibleBitmap: %w", err)
	}
	defer win32.DeleteObject(win32.HGDIOBJ(bmp))

	oldObj, err := win32.SelectObject(memDC, win32.HGDIOBJ(bmp))
	if err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: SelectObject: %w", err)
	}
	defer win32.SelectObject(memDC, oldObj)

	if err := win32.BitBlt(memDC, 0, 0, c.width, c.height, screenDC, c.x, c.y, win32.SRCCOPY); err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: BitBlt: %w", err)
	}

	// Composite the cursor onto the same memory DC -- BitBlt alone never
	// captures it (it's a separate system overlay, not part of any
	// window's device context). Best-effort: a failed cursor read/draw
	// shouldn't fail the whole capture, it just means one frame renders
	// without a visible pointer. Deliberately done before the diff below,
	// not after -- the cursor moving is itself a real, visible change a
	// technician needs to see, same as any other on-screen content.
	//
	// GetCursorInfo's ScreenPos is virtual-desktop-absolute (same
	// coordinate space GetDC(0) spans); subtracting this monitor's own
	// (c.x, c.y) origin converts it to this capture's local coordinate
	// space -- harmlessly off-canvas (DrawIconEx clips silently) when the
	// cursor is actually on a different monitor than this one.
	//
	// Skipped once a connecting client has signaled Cursor pseudo-encoding
	// support (see SetCursorCompositingEnabled) -- that client is
	// rendering its own cursor locally now, and baking one in here too
	// would show two overlapping cursors.
	if c.cursorCompositingEnabled {
		if ci, err := win32.GetCursorInfo(); err == nil && ci.CursorVisible() {
			if err := win32.DrawIconEx(memDC, ci.ScreenPos.X-c.x, ci.ScreenPos.Y-c.y, ci.CursorHandle); err != nil {
				log.Printf("screencapture: draw cursor: %v", err)
			}
		}
	}

	hdr := win32.NewTopDown32BPPHeader(c.width, c.height)
	raw := make([]byte, int(c.width)*int(c.height)*4)
	if err := win32.GetDIBits(memDC, bmp, hdr, raw); err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: GetDIBits: %w", err)
	}

	rowBytesIn := int(c.width) * 4
	minY, maxY, changed := diffChangedRowRange(c.prevRaw, raw, rowBytesIn)
	c.prevRaw = raw
	if !changed {
		// rfbserver's chunkRectangle already treats H==0 as "nothing to
		// send" (returns no rectangles), and WriteFramebufferUpdate
		// correctly writes an empty, valid FramebufferUpdate for zero
		// rectangles -- no changes needed in either of those to make this
		// case work.
		return rfb.Rectangle{}, nil
	}

	bytesPerPixel := int(pf.BitsPerPixel) / 8
	changedRows := maxY - minY + 1
	rowBytesOut := int(c.width) * bytesPerPixel
	out := make([]byte, rowBytesOut*changedRows)
	for y := 0; y < changedRows; y++ {
		srcRow := raw[(minY+y)*rowBytesIn : (minY+y+1)*rowBytesIn]
		rfb.PackRow(out[y*rowBytesOut:(y+1)*rowBytesOut], pf, srcRow)
	}

	return rfb.Rectangle{X: 0, Y: uint16(minY), W: uint16(c.width), H: uint16(changedRows), Pixels: out}, nil
}

// FollowInputDesktop implements rfbserver.DesktopFollower -- attaches the
// calling thread (already OS-thread-locked by rfbserver's own
// captureWithTimeout, a precondition this relies on but does not itself
// enforce) to whichever desktop currently has input focus, re-attaching
// via SetThreadDesktop only on an actual transition. This is what lets a
// SYSTEM-elevated Web Remote session see and control Windows' secure
// desktop (where a UAC consent/credential prompt renders) -- opening it
// via OpenInputDesktop requires SYSTEM-level privilege in the first
// place, so this call is a no-op-equivalent failure for a non-elevated
// session's capturer (it simply keeps using whatever desktop it last
// attached to, the same graceful-degradation behavior this package
// already had before desktop-following existed).
//
// desktopMu exists because captureTimeout's own documented tradeoff (a
// timed-out Capture() leaks its goroutine rather than being forcibly
// cancelled) means two calls to this method could in rare cases genuinely
// run concurrently -- unlike every other field on this struct, which
// capture's normal one-call-at-a-time pattern already makes safe without
// one.
func (c *GDICapturer) FollowInputDesktop() error {
	hDesk, err := win32.OpenInputDesktop()
	if err != nil {
		return fmt.Errorf("screencapture: open input desktop: %w", err)
	}
	defer win32.CloseDesktop(hDesk)

	name, err := win32.DesktopName(hDesk)
	if err != nil {
		return fmt.Errorf("screencapture: desktop name: %w", err)
	}

	c.desktopMu.Lock()
	defer c.desktopMu.Unlock()
	if name == c.lastDesktop {
		return nil
	}
	if err := win32.SetThreadDesktop(hDesk); err != nil {
		return fmt.Errorf("screencapture: set thread desktop %q: %w", name, err)
	}
	c.lastDesktop = name
	return nil
}
