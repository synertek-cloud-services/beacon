//go:build windows

package screencapture

import (
	"errors"
	"fmt"
	"image"
	"log"
	"time"

	"github.com/kirides/go-d3d/d3d11"
	"github.com/kirides/go-d3d/outputduplication"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

var (
	_ rfbserver.Capturer                = (*DXGICapturer)(nil)
	_ rfbserver.CursorShapeProvider     = (*DXGICapturer)(nil)
	_ rfbserver.CursorCompositingToggle = (*DXGICapturer)(nil)
)

const (
	// dxgiFrameWaitMs is how long one AcquireNextFrame waits for a changed
	// frame. Desktop Duplication only delivers a frame when something on
	// screen actually changed, so on a static desktop every call times out
	// -- that's "unchanged", not an error. Kept far under captureTimeout.
	dxgiFrameWaitMs = 100

	// dxgiFirstFrameBudget bounds how long the very first Capture waits for
	// an initial frame before giving up and answering with an empty update
	// (the client simply re-requests).
	dxgiFirstFrameBudget = 2 * time.Second

	// dxgiMaxOpenFailures is how many consecutive failures to (re)create the
	// duplication Capture tolerates, answering with an empty update each
	// time, before it starts returning the error.
	dxgiMaxOpenFailures = 3
)

// DXGICapturer captures one monitor through DXGI Desktop Duplication.
//
// It exists because GDI BitBlt+GetDIBits fails outright on displays driven
// only by a virtual adapter (Microsoft Remote Display Adapter with no
// GPU-backed device alongside it -- e.g. a Vultr VirtIO Windows Server), while
// Desktop Duplication still works there. See AutoCapturer for when it's used.
//
// The duplication is created lazily on the first Capture, not at
// construction: DuplicateOutput must run on a thread attached to the
// current input desktop, and rfbserver's captureWithTimeout has already
// done that attachment by the time Capture is called. It is released and
// re-created on any acquire error (typically DXGI_ERROR_ACCESS_LOST after a
// desktop switch such as a UAC prompt or a resolution change).
type DXGICapturer struct {
	rect          win32.RECT
	width, height int

	dev *d3d11.ID3D11Device
	ctx *d3d11.ID3D11DeviceContext
	dup *outputduplication.OutputDuplicator

	// img holds the latest full frame. GetImage only overwrites it when the
	// desktop actually changed, so on a timeout it still holds the last
	// good frame.
	img       *image.RGBA
	haveFrame bool
	prevRaw   []byte

	openFailures  int
	lastCaptureAt time.Time

	cursorCompositingEnabled bool
}

func newDXGICapturerForMonitor(rect win32.RECT) *DXGICapturer {
	return &DXGICapturer{
		rect:                     rect,
		width:                    int(rect.Right - rect.Left),
		height:                   int(rect.Bottom - rect.Top),
		cursorCompositingEnabled: true,
	}
}

// SetCursorCompositingEnabled implements rfbserver.CursorCompositingToggle.
func (c *DXGICapturer) SetCursorCompositingEnabled(enabled bool) {
	c.cursorCompositingEnabled = enabled
	if c.dup != nil {
		c.dup.DrawPointer = enabled
	}
}

// CursorShape implements rfbserver.CursorShapeProvider.
func (c *DXGICapturer) CursorShape(pf rfb.PixelFormat) rfb.Rectangle {
	return arrowCursorRectangle(pf)
}

// Size returns the target monitor's dimensions.
func (c *DXGICapturer) Size() (uint16, uint16) {
	return uint16(c.width), uint16(c.height)
}

// outputIndexFor returns the DXGI output index to try first for this
// capturer's monitor: its position in EnumMonitors order, which on the
// default adapter matches DXGI's output order in practice. A wrong guess is
// caught by the size check in open.
func (c *DXGICapturer) outputIndexFor() uint {
	monitors, err := win32.EnumMonitors()
	if err != nil {
		return 0
	}
	for i, m := range monitors {
		if m.Rect == c.rect {
			return uint(i)
		}
	}
	return 0
}

// open creates the D3D11 device and the output duplication. Any panic from
// the COM wrapper is converted to an error so a driver oddity can't take the
// whole screenshare helper down.
func (c *DXGICapturer) open() (err error) {
	defer func() {
		if r := recover(); r != nil {
			c.release()
			err = fmt.Errorf("screencapture: dxgi: panic: %v", r)
		}
	}()

	c.release()
	dev, ctx, err := d3d11.NewD3D11Device()
	if err != nil {
		return fmt.Errorf("screencapture: dxgi: create device: %w", err)
	}
	c.dev, c.ctx = dev, ctx

	dup, err := outputduplication.NewIDXGIOutputDuplication(dev, ctx, c.outputIndexFor())
	if err != nil {
		c.release()
		return fmt.Errorf("screencapture: dxgi: duplicate output: %w", err)
	}
	dup.DrawPointer = c.cursorCompositingEnabled
	c.dup = dup

	if c.img == nil {
		c.img = image.NewRGBA(image.Rect(0, 0, c.width, c.height))
	}
	return nil
}

func (c *DXGICapturer) release() {
	if c.dup != nil {
		c.dup.Release()
		c.dup = nil
	}
	if c.ctx != nil {
		c.ctx.Release()
		c.ctx = nil
	}
	if c.dev != nil {
		c.dev.Release()
		c.dev = nil
	}
}

// ensureOpen opens the duplication if it isn't already.
func (c *DXGICapturer) ensureOpen() error {
	if c.dup != nil {
		return nil
	}
	return c.open()
}

// acquire waits for one changed frame. updated is false for "nothing
// changed" (a timeout, or a cursor-only update). Any other failure releases
// the duplication so the next call re-creates it.
func (c *DXGICapturer) acquire() (updated bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			c.release()
			updated, err = false, fmt.Errorf("screencapture: dxgi: panic: %v", r)
		}
	}()

	if gerr := c.dup.GetImage(c.img, dxgiFrameWaitMs); gerr != nil {
		if errors.Is(gerr, outputduplication.ErrNoImageYet) {
			return false, nil
		}
		c.release()
		return false, gerr
	}
	return true, nil
}

// Capture returns the rows that changed since the previous call, packed to
// match pf, exactly like GDICapturer.Capture -- an unchanged frame is a
// zero-height Rectangle.
func (c *DXGICapturer) Capture(pf rfb.PixelFormat) (rfb.Rectangle, error) {
	if wait := minCaptureInterval - time.Since(c.lastCaptureAt); wait > 0 {
		time.Sleep(wait)
	}
	c.lastCaptureAt = time.Now()

	// Check before touching the duplication: while the session's display is
	// suppressed an already-open duplication can get stuck returning "no new
	// frame" forever (no error, never recovers even once the window is back),
	// so drop it, report the error so the viewer is told, and start from a
	// fresh duplication and a full frame once the display is rendered again.
	if displaySuppressed() {
		c.release()
		c.haveFrame = false
		c.prevRaw = nil
		return rfb.Rectangle{}, errDisplaySuppressed
	}

	if err := c.ensureOpen(); err != nil {
		c.openFailures++
		if c.openFailures >= dxgiMaxOpenFailures {
			return rfb.Rectangle{}, err
		}
		log.Printf("screencapture: %v (will retry)", err)
		return rfb.Rectangle{}, nil
	}
	c.openFailures = 0

	deadline := time.Now().Add(dxgiFirstFrameBudget)
	for {
		updated, err := c.acquire()
		if err != nil {
			// ACCESS_LOST and friends: drop the duplication and answer with
			// an empty update; the next call re-creates it on whichever
			// desktop is now current.
			log.Printf("screencapture: dxgi acquire: %v (reopening)", err)
			return rfb.Rectangle{}, nil
		}
		if updated {
			c.haveFrame = true
			break
		}
		// Nothing changed. Once we hold a frame that's a normal unchanged
		// result; before the first frame, keep waiting (bounded) so the
		// session's first update isn't empty.
		if c.haveFrame || time.Now().After(deadline) {
			return rfb.Rectangle{}, nil
		}
	}

	raw := rgbaToBGRA(c.img.Pix)
	rect := packChangedRows(c.prevRaw, raw, c.width, c.height, pf)
	c.prevRaw = raw
	return rect, nil
}
