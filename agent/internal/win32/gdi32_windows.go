//go:build windows

// Package win32 wraps the raw gdi32.dll/user32.dll calls needed for screen
// capture and input injection -- golang.org/x/sys/windows wraps neither
// GDI functions nor SendInput (confirmed by direct inspection before
// writing this package), so this is the first place this codebase calls
// Win32 APIs outside that package's typed wrappers. Isolated into its own
// small package specifically so agent/internal/screencapture and
// agent/internal/screeninject stay readable, mirroring how x/sys/windows
// itself structures typed wrappers around raw NewProc calls.
//
// None of this can be exercised in a non-Windows development sandbox --
// every function here is cross-compile-checked only until confirmed on
// real Windows hardware.
package win32

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

type HDC uintptr
type HBITMAP uintptr
type HGDIOBJ uintptr

const (
	// SRCCOPY is BitBlt's raster-operation code for a plain copy.
	SRCCOPY = 0x00CC0020

	biRGB         = 0
	dibRGBColors  = 0
	gdiErrorValue = ^uintptr(0) // GDI_ERROR / HGDI_ERROR sentinel (-1 as uintptr)
)

var (
	modgdi32 = windows.NewLazySystemDLL("gdi32.dll")

	procCreateCompatibleDC     = modgdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = modgdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = modgdi32.NewProc("SelectObject")
	procBitBlt                 = modgdi32.NewProc("BitBlt")
	procGetDIBits              = modgdi32.NewProc("GetDIBits")
	procDeleteObject           = modgdi32.NewProc("DeleteObject")
	procDeleteDC               = modgdi32.NewProc("DeleteDC")
)

// CreateCompatibleDC creates a memory device context compatible with hdc.
func CreateCompatibleDC(hdc HDC) (HDC, error) {
	r1, _, err := procCreateCompatibleDC.Call(uintptr(hdc))
	if r1 == 0 {
		return 0, fmt.Errorf("win32: CreateCompatibleDC: %w", err)
	}
	return HDC(r1), nil
}

// CreateCompatibleBitmap creates a bitmap compatible with hdc, sized cx*cy.
func CreateCompatibleBitmap(hdc HDC, cx, cy int32) (HBITMAP, error) {
	r1, _, err := procCreateCompatibleBitmap.Call(uintptr(hdc), uintptr(cx), uintptr(cy))
	if r1 == 0 {
		return 0, fmt.Errorf("win32: CreateCompatibleBitmap: %w", err)
	}
	return HBITMAP(r1), nil
}

// SelectObject selects h into hdc, returning the previously selected object.
func SelectObject(hdc HDC, h HGDIOBJ) (HGDIOBJ, error) {
	r1, _, err := procSelectObject.Call(uintptr(hdc), uintptr(h))
	if r1 == 0 || r1 == gdiErrorValue {
		return 0, fmt.Errorf("win32: SelectObject: %w", err)
	}
	return HGDIOBJ(r1), nil
}

// BitBlt copies a w*h block from hdcSrc at (xSrc,ySrc) to hdcDest at
// (xDest,yDest) using rop (SRCCOPY for a plain copy).
func BitBlt(hdcDest HDC, xDest, yDest, w, h int32, hdcSrc HDC, xSrc, ySrc int32, rop uint32) error {
	r1, _, err := procBitBlt.Call(
		uintptr(hdcDest), uintptr(xDest), uintptr(yDest), uintptr(w), uintptr(h),
		uintptr(hdcSrc), uintptr(xSrc), uintptr(ySrc), uintptr(rop),
	)
	if r1 == 0 {
		return fmt.Errorf("win32: BitBlt: %w", err)
	}
	return nil
}

// BitmapInfoHeader mirrors the Win32 BITMAPINFOHEADER structure.
type BitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32 // negative = top-down DIB, avoiding a manual row-flip
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// NewTopDown32BPPHeader returns a BITMAPINFOHEADER describing an
// uncompressed, top-down, 32-bits-per-pixel BI_RGB bitmap of the given
// dimensions -- the format screencapture.GDICapturer requests from
// GetDIBits.
func NewTopDown32BPPHeader(width, height int32) BitmapInfoHeader {
	return BitmapInfoHeader{
		Size:        40, // sizeof(BITMAPINFOHEADER), not sizeof(this Go struct)
		Width:       width,
		Height:      -height,
		Planes:      1,
		BitCount:    32,
		Compression: biRGB,
	}
}

// GetDIBits retrieves hbm's pixel data from hdc into dst, formatted per
// hdr (top-down 32bpp BI_RGB — see NewTopDown32BPPHeader). dst must already
// be sized to width*height*4 bytes.
func GetDIBits(hdc HDC, hbm HBITMAP, hdr BitmapInfoHeader, dst []byte) error {
	if len(dst) == 0 {
		return fmt.Errorf("win32: GetDIBits: empty destination buffer")
	}
	// BITMAPINFO is BITMAPINFOHEADER followed by a colour table -- unused
	// for BI_RGB/32bpp, but GetDIBits still reads the header's Size field
	// to know where pixel-format-specific data would start, so passing
	// just the header (with a correct Size) is sufficient here.
	lines := hdr.Height
	if lines < 0 {
		lines = -lines
	}
	r1, _, err := procGetDIBits.Call(
		uintptr(hdc), uintptr(hbm), 0, uintptr(lines),
		uintptr(unsafe.Pointer(&dst[0])), uintptr(unsafe.Pointer(&hdr)), dibRGBColors,
	)
	if r1 == 0 {
		return fmt.Errorf("win32: GetDIBits: %w", err)
	}
	return nil
}

// DeleteObject frees a GDI object (bitmap, brush, etc.).
func DeleteObject(h HGDIOBJ) error {
	r1, _, err := procDeleteObject.Call(uintptr(h))
	if r1 == 0 {
		return fmt.Errorf("win32: DeleteObject: %w", err)
	}
	return nil
}

// DeleteDC deletes a device context created by CreateCompatibleDC.
func DeleteDC(hdc HDC) error {
	r1, _, err := procDeleteDC.Call(uintptr(hdc))
	if r1 == 0 {
		return fmt.Errorf("win32: DeleteDC: %w", err)
	}
	return nil
}
