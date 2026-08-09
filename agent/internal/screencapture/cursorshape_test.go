package screencapture

import (
	"testing"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
)

func TestCursorArrowOpaqueShape(t *testing.T) {
	// Tip: only (0,0) opaque on row 0.
	if !cursorArrowOpaque(0, 0) {
		t.Fatal("expected (0,0) opaque -- the hotspot/tip")
	}
	if cursorArrowOpaque(1, 0) {
		t.Fatal("expected (1,0) transparent on the tip row")
	}
	// Diagonal expands with row: col==row always opaque (the hypotenuse).
	for row := uint16(0); row < cursorArrowHeight; row++ {
		if !cursorArrowOpaque(row, row) && row < cursorArrowWidth {
			t.Fatalf("expected (%d,%d) opaque on the diagonal", row, row)
		}
	}
	// Past the diagonal, still within width, must be transparent.
	if cursorArrowOpaque(5, 2) {
		t.Fatal("expected (5,2) transparent -- past the diagonal edge")
	}
}

func TestCursorArrowBorderVsInterior(t *testing.T) {
	// Left edge (col 0) and the diagonal (col==row) are border; everything
	// else opaque is interior.
	if !cursorArrowBorder(0, 5) {
		t.Fatal("expected left edge (0,5) to be border")
	}
	if !cursorArrowBorder(3, 3) {
		t.Fatal("expected diagonal (3,3) to be border")
	}
	if cursorArrowBorder(1, 5) {
		t.Fatal("expected interior (1,5) to not be border")
	}
}

func TestArrowCursorRectangleWellFormed(t *testing.T) {
	pf := rfb.PixelFormat{
		BitsPerPixel: 32, Depth: 24, TrueColor: true,
		RedMax: 255, GreenMax: 255, BlueMax: 255,
		RedShift: 16, GreenShift: 8, BlueShift: 0,
	}
	rect := arrowCursorRectangle(pf)

	if rect.Encoding != rfb.EncodingCursorPseudo {
		t.Fatalf("Encoding = %d, want EncodingCursorPseudo", rect.Encoding)
	}
	if rect.X != 0 || rect.Y != 0 {
		t.Fatalf("hotspot = (%d,%d), want (0,0) -- the tip", rect.X, rect.Y)
	}
	if rect.W != cursorArrowWidth || rect.H != cursorArrowHeight {
		t.Fatalf("dims = %dx%d, want %dx%d", rect.W, rect.H, cursorArrowWidth, cursorArrowHeight)
	}

	bytesPerPixel := int(pf.BitsPerPixel) / 8
	pixelBytes := int(rect.W) * int(rect.H) * bytesPerPixel
	maskRowBytes := int(rect.W+7) / 8
	maskBytes := maskRowBytes * int(rect.H)
	wantLen := pixelBytes + maskBytes
	if len(rect.Pixels) != wantLen {
		t.Fatalf("len(Pixels) = %d, want %d (pixels %d + mask %d)", len(rect.Pixels), wantLen, pixelBytes, maskBytes)
	}

	// The tip pixel (0,0) is opaque and border (black): mask bit 1, pixel
	// bytes zero (black in this pf's shifts too, since black is 0,0,0
	// regardless of shift layout).
	mask := rect.Pixels[pixelBytes:]
	tipMaskByte := mask[0]
	if tipMaskByte&0x80 == 0 {
		t.Fatal("expected tip (0,0) mask bit set (opaque)")
	}
	tipPixel := rect.Pixels[0:bytesPerPixel]
	for _, b := range tipPixel {
		if b != 0 {
			t.Fatalf("expected tip pixel to be black (all zero), got %v", tipPixel)
		}
	}

	// A transparent pixel, e.g. (11,0) -- far right on the tip row, must
	// have its mask bit clear.
	transparentCol, transparentRow := uint16(11), uint16(0)
	byteIdx := int(transparentRow)*maskRowBytes + int(transparentCol)/8
	bitMask := byte(0x80 >> (transparentCol % 8))
	if mask[byteIdx]&bitMask != 0 {
		t.Fatal("expected (11,0) mask bit clear (transparent)")
	}
}

func TestArrowCursorRectangleNonSquarePixelFormat(t *testing.T) {
	// A 16bpp format (e.g. RGB565-ish) exercises PackRow's non-identity
	// path and a non-4-byte-per-pixel size, both skipped by the 32bpp test
	// above.
	pf := rfb.PixelFormat{
		BitsPerPixel: 16, Depth: 16, TrueColor: true,
		RedMax: 31, GreenMax: 63, BlueMax: 31,
		RedShift: 11, GreenShift: 5, BlueShift: 0,
	}
	rect := arrowCursorRectangle(pf)

	bytesPerPixel := 2
	pixelBytes := int(rect.W) * int(rect.H) * bytesPerPixel
	maskRowBytes := int(rect.W+7) / 8
	wantLen := pixelBytes + maskRowBytes*int(rect.H)
	if len(rect.Pixels) != wantLen {
		t.Fatalf("len(Pixels) = %d, want %d", len(rect.Pixels), wantLen)
	}

	// An interior white pixel, e.g. (0, 5) is border not interior -- use
	// (1, 5) instead, which cursorArrowOpaque/Border above already assert
	// is opaque interior. White in RGB565 is all bits set within each
	// channel's max: 0xFFFF.
	interiorCol, interiorRow := uint16(1), uint16(5)
	idx := (int(interiorRow)*int(rect.W) + int(interiorCol)) * bytesPerPixel
	got := uint16(rect.Pixels[idx]) | uint16(rect.Pixels[idx+1])<<8
	if got != 0xFFFF {
		t.Fatalf("interior pixel (1,5) = %#04x, want 0xffff (white)", got)
	}
}
