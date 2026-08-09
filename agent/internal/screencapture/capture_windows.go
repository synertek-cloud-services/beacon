//go:build windows

// Package screencapture implements agent/internal/rfbserver.Capturer using
// GDI BitBlt against the primary monitor -- the only capture backend this
// package has (Windows-only, matching Web Remote's v1 scope). Cannot be
// exercised in a non-Windows development sandbox; cross-compile-checked
// only until confirmed on real Windows hardware.
package screencapture

import (
	"fmt"
	"log"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
	"github.com/synertek-cloud-services/beacon/agent/internal/rfbserver"
	"github.com/synertek-cloud-services/beacon/agent/internal/win32"
)

var _ rfbserver.Capturer = (*GDICapturer)(nil)

// GDICapturer captures the primary monitor via BitBlt. Implements
// rfbserver.Capturer.
type GDICapturer struct {
	width, height int32
}

// NewGDICapturer enables per-monitor DPI awareness (must happen once,
// before any screen-dimension or coordinate call -- without it, a scaled
// display reports virtualized dimensions that silently disagree with
// screeninject's coordinate mapping) and reads the primary monitor's real
// size.
func NewGDICapturer() (*GDICapturer, error) {
	if err := win32.EnableDPIAwareness(); err != nil {
		// Non-fatal: capture still works, just risks a coordinate mismatch
		// on a scaled display -- log and continue rather than refuse to
		// start Web Remote entirely over a DPI-awareness API failure.
		log.Printf("screencapture: enable DPI awareness: %v (continuing)", err)
	}

	width := win32.GetSystemMetrics(win32.SM_CXSCREEN)
	height := win32.GetSystemMetrics(win32.SM_CYSCREEN)
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("screencapture: invalid primary monitor dimensions %dx%d", width, height)
	}
	return &GDICapturer{width: width, height: height}, nil
}

// Size returns the primary monitor's dimensions.
func (c *GDICapturer) Size() (uint16, uint16) {
	return uint16(c.width), uint16(c.height)
}

// Capture takes one full-frame screenshot of the primary monitor, packed
// to match pf.
func (c *GDICapturer) Capture(pf rfb.PixelFormat) (rfb.Rectangle, error) {
	screenDC, err := win32.GetDC(0) // 0 = the whole screen
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

	if err := win32.BitBlt(memDC, 0, 0, c.width, c.height, screenDC, 0, 0, win32.SRCCOPY); err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: BitBlt: %w", err)
	}

	// Composite the cursor onto the same memory DC -- BitBlt alone never
	// captures it (it's a separate system overlay, not part of any
	// window's device context). Best-effort: a failed cursor read/draw
	// shouldn't fail the whole capture, it just means one frame renders
	// without a visible pointer.
	if ci, err := win32.GetCursorInfo(); err == nil && ci.CursorVisible() {
		if err := win32.DrawIconEx(memDC, ci.ScreenPos.X, ci.ScreenPos.Y, ci.CursorHandle); err != nil {
			log.Printf("screencapture: draw cursor: %v", err)
		}
	}

	hdr := win32.NewTopDown32BPPHeader(c.width, c.height)
	raw := make([]byte, int(c.width)*int(c.height)*4)
	if err := win32.GetDIBits(memDC, bmp, hdr, raw); err != nil {
		return rfb.Rectangle{}, fmt.Errorf("screencapture: GetDIBits: %w", err)
	}

	bytesPerPixel := int(pf.BitsPerPixel) / 8
	rowBytesIn := int(c.width) * 4
	rowBytesOut := int(c.width) * bytesPerPixel
	out := make([]byte, rowBytesOut*int(c.height))
	for y := 0; y < int(c.height); y++ {
		rfb.PackRow(out[y*rowBytesOut:(y+1)*rowBytesOut], pf, raw[y*rowBytesIn:(y+1)*rowBytesIn])
	}

	return rfb.Rectangle{X: 0, Y: 0, W: uint16(c.width), H: uint16(c.height), Pixels: out}, nil
}
