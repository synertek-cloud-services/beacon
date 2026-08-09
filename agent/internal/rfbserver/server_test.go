package rfbserver

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
	"time"

	"github.com/synertek-cloud-services/beacon/agent/internal/rfb"
)

// pipeConn adapts a pair of unidirectional io.Pipe halves into a single
// io.ReadWriter, standing in for the real net/websocket transport.
type pipeConn struct {
	io.Reader
	io.Writer
}

// fakeCapturer returns a deterministic synthetic buffer instead of real
// GDI output -- byte i of the (assumed-32bpp) framebuffer is byte(i%256).
// Records the last PixelFormat it was asked to capture in, so tests can
// confirm Serve actually honors a client's SetPixelFormat.
type fakeCapturer struct {
	w, h     uint16
	lastPF   rfb.PixelFormat
	captures int
}

func (f *fakeCapturer) Size() (uint16, uint16) { return f.w, f.h }

func (f *fakeCapturer) Capture(pf rfb.PixelFormat) (rfb.Rectangle, error) {
	f.lastPF = pf
	f.captures++
	n := int(f.w) * int(f.h) * 4
	buf := make([]byte, n)
	for i := range buf {
		buf[i] = byte(i % 256)
	}
	return rfb.Rectangle{X: 0, Y: 0, W: f.w, H: f.h, Pixels: buf}, nil
}

type recordedKeyEvent struct {
	down   bool
	keysym uint32
}
type recordedPointerEvent struct {
	mask uint8
	x, y uint16
}

type fakeInjector struct {
	keys     []recordedKeyEvent
	pointers []recordedPointerEvent
}

func (f *fakeInjector) KeyEvent(down bool, keysym uint32) error {
	f.keys = append(f.keys, recordedKeyEvent{down, keysym})
	return nil
}
func (f *fakeInjector) PointerEvent(mask uint8, x, y uint16) error {
	f.pointers = append(f.pointers, recordedPointerEvent{mask, x, y})
	return nil
}

// testHarness wires a Serve() goroutine to a synchronous client-side driver
// over an in-memory pipe pair, matching Serve's exact read/write ordering
// so neither side deadlocks.
type testHarness struct {
	t        *testing.T
	client   pipeConn
	cap      *fakeCapturer
	inj      *fakeInjector
	serveErr chan error
}

func newTestHarness(t *testing.T, w, h uint16) *testHarness {
	t.Helper()
	c2sR, c2sW := io.Pipe()
	s2cR, s2cW := io.Pipe()

	serverSide := pipeConn{Reader: c2sR, Writer: s2cW}
	clientSide := pipeConn{Reader: s2cR, Writer: c2sW}

	h1 := &testHarness{
		t:        t,
		client:   clientSide,
		cap:      &fakeCapturer{w: w, h: h},
		inj:      &fakeInjector{},
		serveErr: make(chan error, 1),
	}

	go func() {
		h1.serveErr <- Serve(serverSide, h1.cap, h1.inj)
	}()

	h1.clientHandshake()
	return h1
}

// clientHandshake drives the client side of the RFB handshake, matching
// exactly the sequence Serve performs server-side.
func (h *testHarness) clientHandshake() {
	h.t.Helper()

	if _, err := rfb.ReadProtocolVersion(h.client); err != nil {
		h.t.Fatalf("client: read protocol version: %v", err)
	}
	if err := rfb.WriteProtocolVersion(h.client); err != nil {
		h.t.Fatalf("client: write protocol version: %v", err)
	}

	// Read security type list: count(1) + types(count).
	var countB [1]byte
	if _, err := io.ReadFull(h.client, countB[:]); err != nil {
		h.t.Fatalf("client: read security count: %v", err)
	}
	types := make([]byte, countB[0])
	if _, err := io.ReadFull(h.client, types); err != nil {
		h.t.Fatalf("client: read security types: %v", err)
	}
	if _, err := h.client.Write([]byte{types[0]}); err != nil {
		h.t.Fatalf("client: write security choice: %v", err)
	}

	var result [4]byte
	if _, err := io.ReadFull(h.client, result[:]); err != nil {
		h.t.Fatalf("client: read security result: %v", err)
	}
	if binary.BigEndian.Uint32(result[:]) != 0 {
		h.t.Fatalf("client: security handshake failed")
	}

	if _, err := h.client.Write([]byte{1}); err != nil { // ClientInit, shared=1
		h.t.Fatalf("client: write client init: %v", err)
	}

	// ServerInit: width(2) height(2) PixelFormat(16) name-len(4) name(...)
	var hdr [20]byte
	if _, err := io.ReadFull(h.client, hdr[:]); err != nil {
		h.t.Fatalf("client: read server init header: %v", err)
	}
	var nameLen [4]byte
	if _, err := io.ReadFull(h.client, nameLen[:]); err != nil {
		h.t.Fatalf("client: read server init name length: %v", err)
	}
	name := make([]byte, binary.BigEndian.Uint32(nameLen[:]))
	if _, err := io.ReadFull(h.client, name); err != nil {
		h.t.Fatalf("client: read server init name: %v", err)
	}
}

func (h *testHarness) sendSetPixelFormat(pf rfb.PixelFormat) {
	h.t.Helper()
	var buf bytes.Buffer
	buf.WriteByte(0) // SetPixelFormat message type
	buf.Write([]byte{0, 0, 0})
	enc := pf.Encode()
	buf.Write(enc[:])
	if _, err := h.client.Write(buf.Bytes()); err != nil {
		h.t.Fatalf("client: send SetPixelFormat: %v", err)
	}
}

func (h *testHarness) requestUpdate() []rfb.Rectangle {
	h.t.Helper()
	var buf bytes.Buffer
	buf.WriteByte(3) // FramebufferUpdateRequest
	buf.WriteByte(0) // non-incremental
	for _, v := range []uint16{0, 0, 0, 0} {
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], v)
		buf.Write(b[:])
	}
	if _, err := h.client.Write(buf.Bytes()); err != nil {
		h.t.Fatalf("client: send FramebufferUpdateRequest: %v", err)
	}
	return h.readFramebufferUpdate()
}

func (h *testHarness) readFramebufferUpdate() []rfb.Rectangle {
	h.t.Helper()
	var hdr [4]byte
	if _, err := io.ReadFull(h.client, hdr[:]); err != nil {
		h.t.Fatalf("client: read FramebufferUpdate header: %v", err)
	}
	if hdr[0] != 0 {
		h.t.Fatalf("client: expected FramebufferUpdate (type 0), got %d", hdr[0])
	}
	n := binary.BigEndian.Uint16(hdr[2:4])
	rects := make([]rfb.Rectangle, n)
	for i := range rects {
		var rb [12]byte
		if _, err := io.ReadFull(h.client, rb[:]); err != nil {
			h.t.Fatalf("client: read rect header %d: %v", i, err)
		}
		x := binary.BigEndian.Uint16(rb[0:2])
		y := binary.BigEndian.Uint16(rb[2:4])
		w := binary.BigEndian.Uint16(rb[4:6])
		ht := binary.BigEndian.Uint16(rb[6:8])
		enc := int32(binary.BigEndian.Uint32(rb[8:12]))
		if enc != rfb.EncodingRaw {
			h.t.Fatalf("client: rect %d: unexpected encoding %d", i, enc)
		}
		pixels := make([]byte, int(w)*int(ht)*4) // assumes 32bpp, true for these tests
		if _, err := io.ReadFull(h.client, pixels); err != nil {
			h.t.Fatalf("client: read rect %d pixels: %v", i, err)
		}
		rects[i] = rfb.Rectangle{X: x, Y: y, W: w, H: ht, Pixels: pixels}
	}
	return rects
}

func (h *testHarness) sendKeyEvent(down bool, keysym uint32) {
	h.t.Helper()
	var buf bytes.Buffer
	buf.WriteByte(4)
	if down {
		buf.WriteByte(1)
	} else {
		buf.WriteByte(0)
	}
	buf.Write([]byte{0, 0})
	var ks [4]byte
	binary.BigEndian.PutUint32(ks[:], keysym)
	buf.Write(ks[:])
	if _, err := h.client.Write(buf.Bytes()); err != nil {
		h.t.Fatalf("client: send KeyEvent: %v", err)
	}
}

func (h *testHarness) sendPointerEvent(mask uint8, x, y uint16) {
	h.t.Helper()
	var buf bytes.Buffer
	buf.WriteByte(5)
	buf.WriteByte(mask)
	for _, v := range []uint16{x, y} {
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], v)
		buf.Write(b[:])
	}
	if _, err := h.client.Write(buf.Bytes()); err != nil {
		h.t.Fatalf("client: send PointerEvent: %v", err)
	}
}

func (h *testHarness) closeAndWaitClean() {
	h.t.Helper()
	if closer, ok := h.client.Writer.(io.Closer); ok {
		closer.Close()
	}
	select {
	case err := <-h.serveErr:
		if err != nil {
			h.t.Fatalf("Serve returned error on clean disconnect: %v", err)
		}
	case <-time.After(2 * time.Second):
		h.t.Fatal("Serve did not return after client disconnect")
	}
}

func TestHandshakeAndFramebufferUpdate(t *testing.T) {
	h := newTestHarness(t, 4, 3) // 4x3 fits in a single band (< bandHeight)
	rects := h.requestUpdate()

	if len(rects) != 1 {
		t.Fatalf("rect count = %d, want 1 (frame shorter than bandHeight)", len(rects))
	}
	r := rects[0]
	if r.X != 0 || r.Y != 0 || r.W != 4 || r.H != 3 {
		t.Fatalf("rect dims = %+v, want {0 0 4 3 ...}", struct{ X, Y, W, H uint16 }{r.X, r.Y, r.W, r.H})
	}
	want := make([]byte, 4*3*4)
	for i := range want {
		want[i] = byte(i % 256)
	}
	if !bytes.Equal(r.Pixels, want) {
		t.Fatalf("pixel data mismatch")
	}
	if h.cap.captures != 1 {
		t.Fatalf("captures = %d, want 1", h.cap.captures)
	}

	h.closeAndWaitClean()
}

func TestFramebufferUpdateChunksIntoBands(t *testing.T) {
	// 300 rows should split into bands of 128, 128, 44 given bandHeight=128.
	h := newTestHarness(t, 2, 300)
	rects := h.requestUpdate()

	if len(rects) != 3 {
		t.Fatalf("rect count = %d, want 3", len(rects))
	}
	wantHeights := []uint16{128, 128, 44}
	wantY := []uint16{0, 128, 256}
	var reassembled []byte
	for i, r := range rects {
		if r.H != wantHeights[i] {
			t.Fatalf("rect %d height = %d, want %d", i, r.H, wantHeights[i])
		}
		if r.Y != wantY[i] {
			t.Fatalf("rect %d Y = %d, want %d", i, r.Y, wantY[i])
		}
		if r.W != 2 {
			t.Fatalf("rect %d width = %d, want 2", i, r.W)
		}
		reassembled = append(reassembled, r.Pixels...)
	}
	want := make([]byte, 2*300*4)
	for i := range want {
		want[i] = byte(i % 256)
	}
	if !bytes.Equal(reassembled, want) {
		t.Fatalf("reassembled pixel data does not match original buffer")
	}

	h.closeAndWaitClean()
}

func TestSetPixelFormatIsHonored(t *testing.T) {
	h := newTestHarness(t, 4, 3)

	custom := rfb.PixelFormat{
		BitsPerPixel: 16, Depth: 16, BigEndian: false, TrueColor: true,
		RedMax: 31, GreenMax: 63, BlueMax: 31,
		RedShift: 11, GreenShift: 5, BlueShift: 0,
	}
	h.sendSetPixelFormat(custom)

	// Drive one more request/response so the SetPixelFormat message is
	// guaranteed to have been processed before we inspect cap.lastPF --
	// the client and server take turns, so this synchronizes them.
	var buf bytes.Buffer
	buf.WriteByte(3)
	buf.WriteByte(0)
	for _, v := range []uint16{0, 0, 0, 0} {
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], v)
		buf.Write(b[:])
	}
	if _, err := h.client.Write(buf.Bytes()); err != nil {
		t.Fatalf("client: send FramebufferUpdateRequest: %v", err)
	}

	// Read the header only (rects sized for 32bpp assumption don't apply
	// here since format changed to 16bpp) -- just confirm a message
	// arrives and the capturer recorded the new format.
	var hdr [4]byte
	if _, err := io.ReadFull(h.client, hdr[:]); err != nil {
		t.Fatalf("client: read update header: %v", err)
	}
	// Drain the rest of the message (rect headers + 16bpp pixel data) so
	// the pipe doesn't deadlock on close.
	n := binary.BigEndian.Uint16(hdr[2:4])
	for i := uint16(0); i < n; i++ {
		var rb [12]byte
		io.ReadFull(h.client, rb[:])
		w := binary.BigEndian.Uint16(rb[4:6])
		ht := binary.BigEndian.Uint16(rb[6:8])
		io.ReadFull(h.client, make([]byte, int(w)*int(ht)*2)) // 16bpp = 2 bytes/pixel
	}

	if h.cap.lastPF != custom {
		t.Fatalf("capturer's last PixelFormat = %+v, want %+v", h.cap.lastPF, custom)
	}

	h.closeAndWaitClean()
}

func TestInputEventsForwarded(t *testing.T) {
	h := newTestHarness(t, 4, 3)

	h.sendKeyEvent(true, 0xFF0D)
	h.sendKeyEvent(false, 0xFF0D)
	h.sendPointerEvent(0x01, 100, 200)

	// Round-trip a FramebufferUpdateRequest to synchronize: by the time
	// its response arrives, the server has necessarily already processed
	// every message sent before it (RFB messages are handled in order).
	h.requestUpdate()

	if len(h.inj.keys) != 2 {
		t.Fatalf("recorded %d key events, want 2", len(h.inj.keys))
	}
	if !h.inj.keys[0].down || h.inj.keys[0].keysym != 0xFF0D {
		t.Fatalf("key[0] = %+v", h.inj.keys[0])
	}
	if h.inj.keys[1].down || h.inj.keys[1].keysym != 0xFF0D {
		t.Fatalf("key[1] = %+v", h.inj.keys[1])
	}
	if len(h.inj.pointers) != 1 || h.inj.pointers[0] != (recordedPointerEvent{0x01, 100, 200}) {
		t.Fatalf("pointers = %+v", h.inj.pointers)
	}

	h.closeAndWaitClean()
}

func TestCleanDisconnectReturnsNilError(t *testing.T) {
	h := newTestHarness(t, 4, 3)
	h.closeAndWaitClean() // asserts Serve returned nil, not just that it returned
}
