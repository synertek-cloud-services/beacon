package rfb

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"io"
	"testing"
)

func zrle32bppPixelFormat() PixelFormat {
	return testPixelFormat() // 32bpp, depth 24, little-endian -- the identity format real noVNC negotiates
}

func zrle16bppPixelFormat() PixelFormat {
	return PixelFormat{
		BitsPerPixel: 16, Depth: 16, BigEndian: false, TrueColor: true,
		RedMax: 31, GreenMax: 63, BlueMax: 31,
		RedShift: 11, GreenShift: 5, BlueShift: 0,
	}
}

// buildPackedFrame builds a w x h buffer already packed to pf, the same way
// agent/internal/screencapture's real capture path does: BGRA source rows
// run through PackRow. A deterministic per-pixel pattern (distinct per row
// and column) lets a round-trip test catch a coordinate/tiling mistake, not
// just a uniform-color one that would hide bugs like a transposed x/y.
func buildPackedFrame(w, h uint16, pf PixelFormat) []byte {
	bytesPerPixel := int(pf.BitsPerPixel) / 8
	rowBytes := int(w) * bytesPerPixel
	packed := make([]byte, rowBytes*int(h))
	srcRow := make([]byte, int(w)*4)
	for y := 0; y < int(h); y++ {
		for x := 0; x < int(w); x++ {
			srcRow[x*4+0] = byte(x*7 + y) // B
			srcRow[x*4+1] = byte(x + y*3) // G
			srcRow[x*4+2] = byte(x ^ y)   // R
			srcRow[x*4+3] = 0xFF          // A, ignored by PackRow
		}
		PackRow(packed[y*rowBytes:(y+1)*rowBytes], pf, srcRow)
	}
	return packed
}

// decodeZRLERects decodes a sequence of ZRLEEncoder.EncodeRect payloads,
// produced in order by one encoder, back into packed pixel bytes per
// rectangle -- and in doing so verifies they share one continuous zlib
// stream (a single zlib.Reader is constructed once, over every payload's
// compressed bytes concatenated in call order, exactly like a real
// streaming RFB client would consume them).
func decodeZRLERects(t *testing.T, payloads [][]byte, dims []struct {
	w, h uint16
	pf   PixelFormat
}) [][]byte {
	t.Helper()
	if len(payloads) != len(dims) {
		t.Fatalf("payloads/dims length mismatch: %d vs %d", len(payloads), len(dims))
	}

	var compressed bytes.Buffer
	for i, p := range payloads {
		if len(p) < 4 {
			t.Fatalf("payload %d too short: %d bytes", i, len(p))
		}
		n := int(binary.BigEndian.Uint32(p[0:4]))
		if len(p) != 4+n {
			t.Fatalf("payload %d length field = %d, actual compressed bytes = %d", i, n, len(p)-4)
		}
		compressed.Write(p[4:])
	}

	zr, err := zlib.NewReader(bytes.NewReader(compressed.Bytes()))
	if err != nil {
		t.Fatalf("zlib.NewReader: %v", err)
	}
	defer zr.Close()

	out := make([][]byte, len(dims))
	for i, d := range dims {
		if d.w == 0 || d.h == 0 {
			out[i] = nil
			continue
		}
		bytesPerPixel := int(d.pf.BitsPerPixel) / 8
		cpw := cpixelWidth(d.pf)
		rowBytes := int(d.w) * bytesPerPixel
		packed := make([]byte, rowBytes*int(d.h))

		for ty := 0; ty < int(d.h); ty += zrleTileSize {
			th := zrleTileSize
			if remaining := int(d.h) - ty; th > remaining {
				th = remaining
			}
			for tx := 0; tx < int(d.w); tx += zrleTileSize {
				tw := zrleTileSize
				if remaining := int(d.w) - tx; tw > remaining {
					tw = remaining
				}

				var sub [1]byte
				if _, err := io.ReadFull(zr, sub[:]); err != nil {
					t.Fatalf("rect %d: read subencoding: %v", i, err)
				}
				if sub[0] != zrleSubencodingRaw {
					t.Fatalf("rect %d: subencoding = %d, want Raw (0) -- v1 must only ever emit Raw", i, sub[0])
				}

				tilePixels := make([]byte, tw*th*cpw)
				if _, err := io.ReadFull(zr, tilePixels); err != nil {
					t.Fatalf("rect %d: read tile pixels: %v", i, err)
				}

				for ry := 0; ry < th; ry++ {
					rowStart := (ty+ry)*rowBytes + tx*bytesPerPixel
					for rx := 0; rx < tw; rx++ {
						src := tilePixels[(ry*tw+rx)*cpw : (ry*tw+rx+1)*cpw]
						dst := packed[rowStart+rx*bytesPerPixel : rowStart+rx*bytesPerPixel+bytesPerPixel]
						if cpw == bytesPerPixel {
							copy(dst, src)
							continue
						}
						// The byte CPIXEL dropped is always zero (that's the
						// whole premise cpixelWidth relies on) -- put it
						// back to compare against the original packed bytes.
						if d.pf.BigEndian {
							dst[0] = 0
							copy(dst[1:], src)
						} else {
							copy(dst[:3], src)
							dst[3] = 0
						}
					}
				}
			}
		}
		out[i] = packed
	}
	return out
}

func TestZRLEEncodeRectRoundTripExactTileMultiple(t *testing.T) {
	pf := zrle32bppPixelFormat()
	w, h := uint16(128), uint16(128) // exactly 2x2 64x64 tiles
	packed := buildPackedFrame(w, h, pf)

	enc := NewZRLEEncoder()
	payload, err := enc.EncodeRect(w, h, pf, packed)
	if err != nil {
		t.Fatalf("EncodeRect: %v", err)
	}

	decoded := decodeZRLERects(t, [][]byte{payload}, []struct {
		w, h uint16
		pf   PixelFormat
	}{{w, h, pf}})
	if !bytes.Equal(decoded[0], packed) {
		t.Fatal("decoded pixels do not match the original packed frame")
	}
}

func TestZRLEEncodeRectRoundTripRemainderTiles(t *testing.T) {
	pf := zrle32bppPixelFormat()
	w, h := uint16(100), uint16(70) // not a multiple of 64 in either dimension
	packed := buildPackedFrame(w, h, pf)

	enc := NewZRLEEncoder()
	payload, err := enc.EncodeRect(w, h, pf, packed)
	if err != nil {
		t.Fatalf("EncodeRect: %v", err)
	}

	decoded := decodeZRLERects(t, [][]byte{payload}, []struct {
		w, h uint16
		pf   PixelFormat
	}{{w, h, pf}})
	if !bytes.Equal(decoded[0], packed) {
		t.Fatal("decoded pixels do not match the original packed frame")
	}
}

func TestZRLEEncodeRectRoundTripOnePixel(t *testing.T) {
	pf := zrle32bppPixelFormat()
	w, h := uint16(1), uint16(1)
	packed := buildPackedFrame(w, h, pf)

	enc := NewZRLEEncoder()
	payload, err := enc.EncodeRect(w, h, pf, packed)
	if err != nil {
		t.Fatalf("EncodeRect: %v", err)
	}

	decoded := decodeZRLERects(t, [][]byte{payload}, []struct {
		w, h uint16
		pf   PixelFormat
	}{{w, h, pf}})
	if !bytes.Equal(decoded[0], packed) {
		t.Fatal("decoded pixel does not match the original")
	}
}

func TestZRLEEncodeRectRoundTrip16bppNoTruncation(t *testing.T) {
	pf := zrle16bppPixelFormat()
	if cpixelWidth(pf) != 2 {
		t.Fatalf("cpixelWidth(16bpp) = %d, want 2 (no truncation)", cpixelWidth(pf))
	}
	w, h := uint16(80), uint16(50)
	packed := buildPackedFrame(w, h, pf)

	enc := NewZRLEEncoder()
	payload, err := enc.EncodeRect(w, h, pf, packed)
	if err != nil {
		t.Fatalf("EncodeRect: %v", err)
	}

	decoded := decodeZRLERects(t, [][]byte{payload}, []struct {
		w, h uint16
		pf   PixelFormat
	}{{w, h, pf}})
	if !bytes.Equal(decoded[0], packed) {
		t.Fatal("decoded pixels do not match the original packed frame")
	}
}

func TestZRLEEncodeRectMultiCallStreamContinuity(t *testing.T) {
	pf := zrle32bppPixelFormat()
	dims := []struct {
		w, h uint16
		pf   PixelFormat
	}{
		{64, 64, pf},
		{200, 40, pf}, // remainder tiles, different dims than the previous call
		{1, 1, pf},
		{128, 128, pf},
	}

	enc := NewZRLEEncoder()
	var packedFrames [][]byte
	var payloads [][]byte
	for _, d := range dims {
		packed := buildPackedFrame(d.w, d.h, d.pf)
		packedFrames = append(packedFrames, packed)
		payload, err := enc.EncodeRect(d.w, d.h, d.pf, packed)
		if err != nil {
			t.Fatalf("EncodeRect: %v", err)
		}
		payloads = append(payloads, payload)
	}

	decoded := decodeZRLERects(t, payloads, dims)
	for i := range dims {
		if !bytes.Equal(decoded[i], packedFrames[i]) {
			t.Fatalf("call %d: decoded pixels do not match the original packed frame", i)
		}
	}
}

func TestZRLEEncodeRectZeroDimensions(t *testing.T) {
	pf := zrle32bppPixelFormat()
	enc := NewZRLEEncoder()

	for _, tc := range []struct{ w, h uint16 }{{0, 5}, {5, 0}, {0, 0}} {
		payload, err := enc.EncodeRect(tc.w, tc.h, pf, nil)
		if err != nil {
			t.Fatalf("EncodeRect(%d, %d): %v", tc.w, tc.h, err)
		}
		if len(payload) != 4 || binary.BigEndian.Uint32(payload) != 0 {
			t.Fatalf("EncodeRect(%d, %d) payload = %v, want a 4-byte zero length", tc.w, tc.h, payload)
		}
	}
}

func TestCPixelWidth(t *testing.T) {
	cases := []struct {
		name string
		pf   PixelFormat
		want int
	}{
		{"32bpp depth24 (identity, truncated)", zrle32bppPixelFormat(), 3},
		{"32bpp depth32 (no truncation)", PixelFormat{BitsPerPixel: 32, Depth: 32}, 4},
		{"16bpp", zrle16bppPixelFormat(), 2},
		{"8bpp", PixelFormat{BitsPerPixel: 8, Depth: 8}, 1},
	}
	for _, tc := range cases {
		if got := cpixelWidth(tc.pf); got != tc.want {
			t.Errorf("%s: cpixelWidth = %d, want %d", tc.name, got, tc.want)
		}
	}
}
