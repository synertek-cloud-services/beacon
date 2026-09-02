package rfb

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
)

// zrleTileSize is the fixed tile edge ZRLE divides a rectangle into (RFC
// 6143 §7.7.6) -- always 64, not configurable, and edge tiles along the
// right/bottom of a rectangle whose W/H isn't a multiple of it are simply
// clipped to whatever remains.
const zrleTileSize = 64

// zrleSubencodingRaw is ZRLE's per-tile sub-encoding byte for "this tile's
// pixels follow uncompressed (before the surrounding zlib compression)".
// RFC 6143 also defines Solid/PackedPalette/PlainRLE/PaletteRLE
// sub-encodings for better per-tile ratio, but explicitly permits an
// encoder to always choose Raw -- every compliant decoder (including
// noVNC) must handle it with no special-casing. v1 deliberately only ever
// emits this one: it skips the riskiest part of ZRLE to get exactly right
// (palette construction, RLE run-counting) while the surrounding zlib
// stream still does the real compression work. Palette/RLE tiles are a
// scoped-out, purely additive enhancement to this file alone if real-world
// testing ever shows more ratio is needed.
const zrleSubencodingRaw = 0

// ZRLEEncoder incrementally encodes FramebufferUpdate rectangles as ZRLE
// (RFC 6143 §7.7.6): zlib-compressed, 64x64-tiled pixel data. It is
// stateful and must be reused for every rectangle of one RFB connection,
// never recreated mid-session -- the spec requires ZRLE rectangles within
// a single connection to share one continuous zlib stream, decoded
// strictly in the order they were encoded, and a real decoder relies on
// that (a fresh zlib.Writer per call would emit a new stream header each
// time and desync the client's inflate state on the very next rectangle).
// Not safe for concurrent use -- agent/internal/rfbserver's capture
// goroutine, which is already the sole writer to the connection, is this
// type's sole owner and caller.
type ZRLEEncoder struct {
	buf *bytes.Buffer
	zw  *zlib.Writer
}

// NewZRLEEncoder returns a ready-to-use encoder bound to a fresh zlib
// stream. zlib.BestSpeed, not the default level: capture is already paced
// to ~30fps (see screencapture.minCaptureInterval), and a slower/higher-
// ratio level risks the encode step itself becoming the bottleneck it's
// meant to fix -- confirmed/tuned against real capture timing during
// hardware verification, not just assumed.
func NewZRLEEncoder() *ZRLEEncoder {
	buf := new(bytes.Buffer)
	zw, _ := zlib.NewWriterLevel(buf, zlib.BestSpeed) // BestSpeed is always a valid level; error is unreachable
	return &ZRLEEncoder{buf: buf, zw: zw}
}

// cpixelWidth returns the byte width of one ZRLE CPIXEL for pf. RFC 6143
// §7.7.6: when bits-per-pixel is 32 and depth is 24 or less, CPIXEL drops
// the one byte a full pixel always leaves zero (every channel's Max is
// bounded to 8 bits by depth<=24, so the packed value never exceeds the
// low 24 bits) and is 3 bytes; otherwise CPIXEL is the full pixel width.
func cpixelWidth(pf PixelFormat) int {
	if pf.BitsPerPixel == 32 && pf.Depth <= 24 {
		return 3
	}
	return int(pf.BitsPerPixel) / 8
}

// truncateToCPIXEL copies pixel (a full bytesPerPixel-wide pixel, already
// packed to pf's byte order -- see PackRow) into dst, a pre-sized
// cpixelWidth(pf)-byte buffer. Only called when truncation actually
// applies (len(dst) < len(pixel)); the always-zero byte dropped is the
// most-significant one for the packed value's byte order -- index 3 for
// little-endian (PackRow writes the pixel via PutUint32 LSB-first, so the
// always-zero high byte lands last), index 0 for big-endian (MSB-first,
// so it lands first).
func truncateToCPIXEL(dst []byte, pf PixelFormat, pixel []byte) {
	if pf.BigEndian {
		copy(dst, pixel[1:4])
	} else {
		copy(dst, pixel[0:3])
	}
}

// EncodeRect ZRLE-encodes one w x h rectangle already packed to pf (the
// same already-PackRow'd byte layout agent/internal/screencapture's
// GDICapturer.Capture and rfbserver's chunkRectangle already produce for
// Raw rectangles -- row stride int(w)*bytesPerPixel(pf)). Returns the
// ready-to-use Rectangle.Pixels payload: a 4-byte big-endian length
// followed by that many bytes of zlib-compressed data, continuing this
// encoder's single persistent stream (see the type doc comment).
func (e *ZRLEEncoder) EncodeRect(w, h uint16, pf PixelFormat, packed []byte) ([]byte, error) {
	if w == 0 || h == 0 {
		return append([]byte(nil), 0, 0, 0, 0), nil
	}

	bytesPerPixel := int(pf.BitsPerPixel) / 8
	if bytesPerPixel <= 0 {
		return nil, fmt.Errorf("rfb: ZRLE: invalid bits-per-pixel %d", pf.BitsPerPixel)
	}
	rowBytes := int(w) * bytesPerPixel

	cpw := cpixelWidth(pf)
	truncate := cpw != bytesPerPixel
	pixelScratch := make([]byte, cpw)

	var tiles bytes.Buffer
	for ty := 0; ty < int(h); ty += zrleTileSize {
		th := zrleTileSize
		if remaining := int(h) - ty; th > remaining {
			th = remaining
		}
		for tx := 0; tx < int(w); tx += zrleTileSize {
			tw := zrleTileSize
			if remaining := int(w) - tx; tw > remaining {
				tw = remaining
			}

			tiles.WriteByte(zrleSubencodingRaw)
			for ry := 0; ry < th; ry++ {
				rowStart := (ty+ry)*rowBytes + tx*bytesPerPixel
				for rx := 0; rx < tw; rx++ {
					pixStart := rowStart + rx*bytesPerPixel
					pixel := packed[pixStart : pixStart+bytesPerPixel]
					if truncate {
						truncateToCPIXEL(pixelScratch, pf, pixel)
						tiles.Write(pixelScratch)
					} else {
						tiles.Write(pixel)
					}
				}
			}
		}
	}

	if _, err := e.zw.Write(tiles.Bytes()); err != nil {
		return nil, fmt.Errorf("rfb: ZRLE: zlib write: %w", err)
	}
	// Flush, not Close -- Close would emit a new zlib stream header/
	// terminator and break the "one continuous stream per connection"
	// contract the next EncodeRect call (and the real decoder on the other
	// end) depends on.
	if err := e.zw.Flush(); err != nil {
		return nil, fmt.Errorf("rfb: ZRLE: zlib flush: %w", err)
	}

	out := make([]byte, 4+e.buf.Len())
	binary.BigEndian.PutUint32(out[0:4], uint32(e.buf.Len()))
	copy(out[4:], e.buf.Bytes())
	e.buf.Reset() // clears the buffer's contents only -- the zlib.Writer's own compression state/history keeps going, unaffected
	return out, nil
}
