package releasekey

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func TestPublicKey(t *testing.T) {
	original := PublicKeyHex
	t.Cleanup(func() { PublicKeyHex = original })

	if _, err := PublicKey(); err != nil {
		t.Fatalf("default public key is invalid: %v", err)
	}

	PublicKeyHex = "not-a-key"
	if _, err := PublicKey(); err == nil {
		t.Fatal("expected an invalid embedded key to be rejected")
	}
}

func TestValidatePrivateKey(t *testing.T) {
	original := PublicKeyHex
	t.Cleanup(func() { PublicKeyHex = original })

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	PublicKeyHex = hex.EncodeToString(publicKey)
	if err := ValidatePrivateKey(privateKey); err != nil {
		t.Fatalf("matching key was rejected: %v", err)
	}

	corruptedPrivateKey := append(ed25519.PrivateKey(nil), privateKey...)
	corruptedPrivateKey[len(corruptedPrivateKey)-1] ^= 0xff
	PublicKeyHex = hex.EncodeToString(corruptedPrivateKey[ed25519.SeedSize:])
	if err := ValidatePrivateKey(corruptedPrivateKey); err == nil {
		t.Fatal("private key with an inconsistent public half was accepted")
	}
	PublicKeyHex = hex.EncodeToString(publicKey)

	_, otherPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrivateKey(otherPrivateKey); err == nil {
		t.Fatal("mismatched signing key was accepted")
	}
}
