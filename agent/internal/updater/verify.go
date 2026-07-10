package updater

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
)

// pinnedPublicKey is the Ed25519 public key that all released agent binaries
// must be signed against. Generated once with tools/keygen — never rotate
// without rebuilding all deployed agents.
const pinnedPublicKey = "673119993b2e981690afb9567065d53813e5cd83409d6b7f1f2a62175a220282"

// verifyBinary checks that the file at path was signed by the private key
// corresponding to pinnedPublicKey. sigHex is the hex-encoded Ed25519 signature
// over the SHA-256 digest of the binary content.
func verifyBinary(path, sigHex string) error {
	pubBytes, err := hex.DecodeString(pinnedPublicKey)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return errors.New("updater: invalid pinned public key")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)

	sig, err := hex.DecodeString(sigHex)
	if err != nil {
		return errors.New("updater: invalid signature encoding")
	}

	if !ed25519.Verify(ed25519.PublicKey(pubBytes), digest[:], sig) {
		return errors.New("updater: signature verification failed — binary rejected")
	}
	return nil
}
