// Package screencapture (this file specifically) builds Web Remote's v1
// fixed cursor shape -- deliberately not Windows-only, unlike the rest of
// this package, so the shape/packing logic is unit-testable in a normal
// dev sandbox with no GDI dependency at all.
package screencapture

import "github.com/synertek-cloud-services/beacon/agent/internal/rfb"

// cursorArrowWidth/cursorArrowHeight size the v1 fixed cursor shape sent
// via the RFB Cursor pseudo-encoding (see rfbserver.CursorShapeProvider).
// This is a hand-built placeholder shape, not an extraction of the real OS
// cursor -- real per-icon Windows cursor tracking (GetIconInfo, then
// decoding its color+alpha or legacy AND/XOR monochrome mask depending on
// the specific cursor) is real, nontrivial complexity with no real Windows
// hardware in this repo's dev sandbox to verify the decoding against,
// deliberately deferred per the feature's own "explicitly out of scope"
// list. A fixed shape still solves the actual reported problem: what makes
// cursor movement feel smooth is the client rendering *any* shape locally
// at its own already-tracked mouse position instead of waiting on a
// capture round trip for every pixel of movement -- the shape itself
// doesn't need to track the OS's real, rarely-changing-during-an-ordinary-
// remote-support-session arrow icon.
const (
	cursorArrowWidth  uint16 = 12
	cursorArrowHeight uint16 = 16
)

// cursorArrowOpaque reports whether (col, row) is part of the shape: a
// simple solid right-triangle pointer with its tip (and RFB hotspot) at
// (0, 0), defined geometrically rather than as a hand-transcribed ASCII
// bitmap so it's trivially verifiable instead of depending on manually
// counting columns in a string literal.
func cursorArrowOpaque(col, row uint16) bool {
	return col <= row
}

// cursorArrowBorder reports whether an opaque (col, row) pixel sits on the
// triangle's outline (its hypotenuse or its left edge) rather than its
// interior -- outline pixels render black, interior renders white, so the
// shape stays visible against both light and dark backgrounds.
func cursorArrowBorder(col, row uint16) bool {
	return col == row || col == 0
}

// arrowCursorRectangle builds the fixed v1 cursor shape as an
// EncodingCursorPseudo rfb.Rectangle, with pixel data packed to pf.
func arrowCursorRectangle(pf rfb.PixelFormat) rfb.Rectangle {
	w, h := cursorArrowWidth, cursorArrowHeight

	// bgra is the flat BGRA source buffer rfb.PackRow expects (see its own
	// doc comment) -- built once, row-major, matching the pixel order
	// rfb.NewCursorRectangle's mask-building loop also uses, so the packed
	// pixel data and the mask stay aligned to the same (col, row) pixel.
	bgra := make([]byte, int(w)*int(h)*4)
	for row := uint16(0); row < h; row++ {
		for col := uint16(0); col < w; col++ {
			if !cursorArrowOpaque(col, row) {
				continue // left zeroed -- transparent, mask bit will be 0
			}
			i := (int(row)*int(w) + int(col)) * 4
			if cursorArrowBorder(col, row) {
				// Black: BGRA all-zero already, nothing to set.
				continue
			}
			bgra[i], bgra[i+1], bgra[i+2] = 255, 255, 255 // white interior
		}
	}

	packed := make([]byte, int(w)*int(h)*int(pf.BitsPerPixel)/8)
	rfb.PackRow(packed, pf, bgra)

	return rfb.NewCursorRectangle(0, 0, w, h, packed, cursorArrowOpaque)
}
