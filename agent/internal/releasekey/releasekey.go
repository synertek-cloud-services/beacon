// Package releasekey owns the Ed25519 public key trusted by agent updates.
//
// PublicKeyHex is a variable so the release build can replace the upstream
// default with a host-controlled key using Go's -X linker flag. Plain local
// builds continue to trust the upstream Beacon release channel.
package releasekey

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
)

var PublicKeyHex = "ab8124275d6723c5ff33efb31de1795ac193797ebec13a09197ae8a9b3ea642d"

// PublicKey decodes and validates the public key embedded in this build.
func PublicKey() (ed25519.PublicKey, error) {
	publicKey, err := hex.DecodeString(PublicKeyHex)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return nil, errors.New("invalid embedded agent release public key")
	}
	return ed25519.PublicKey(publicKey), nil
}

// ValidatePrivateKey confirms that a signing key belongs to the public key
// embedded in this build.
func ValidatePrivateKey(privateKey ed25519.PrivateKey) error {
	if len(privateKey) != ed25519.PrivateKeySize {
		return errors.New("invalid Ed25519 private key")
	}
	canonicalPrivateKey := ed25519.NewKeyFromSeed(privateKey.Seed())
	if !bytes.Equal(canonicalPrivateKey, privateKey) {
		return errors.New("Ed25519 private key has an inconsistent public half")
	}
	publicKey, err := PublicKey()
	if err != nil {
		return err
	}
	derivedPublicKey := privateKey.Public().(ed25519.PublicKey)
	if !bytes.Equal(derivedPublicKey, publicKey) {
		return errors.New("signing key does not match the public key embedded in this release build")
	}
	return nil
}
