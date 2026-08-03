package updater

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"

	"github.com/synertek-cloud-services/beacon/agent/internal/releasekey"
)

// verifyBinary checks that the file at path was signed by the private key
// corresponding to the public key embedded in this agent build. sigHex is the
// hex-encoded Ed25519 signature over the SHA-256 digest of the binary content.
func verifyBinary(path, sigHex string) error {
	publicKey, err := releasekey.PublicKey()
	if err != nil {
		return err
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

	if !ed25519.Verify(publicKey, digest[:], sig) {
		return errors.New("updater: signature verification failed — binary rejected")
	}
	return nil
}
