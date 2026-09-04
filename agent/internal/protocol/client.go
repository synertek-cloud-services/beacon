package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	serverURL string
	http      *http.Client
}

func NewClient(serverURL string) *Client {
	return &Client{
		serverURL: serverURL,
		http:      &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Enroll(token string, req EnrollRequest) (*EnrollResponse, error) {
	return post[EnrollResponse](c, "/v1/enroll", "Bearer "+token, req)
}

func (c *Client) CheckIn(deviceCredential string, req CheckInRequest) (*CheckInResponse, error) {
	return post[CheckInResponse](c, "/v1/check-in", "Bearer "+deviceCredential, req)
}

func (c *Client) Audit(deviceCredential string, req AuditRequest) (*AuditResponse, error) {
	return post[AuditResponse](c, "/v1/audit", "Bearer "+deviceCredential, req)
}

// DownloadComponentFile returns a private component-file response authorized
// by both the enrolled device credential and a short-lived command grant. The
// caller owns and must close the response body.
func (c *Client) DownloadComponentFile(deviceCredential, token string) (*http.Response, error) {
	b, err := json.Marshal(struct {
		Token string `json:"token"`
	}{Token: token})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.serverURL+"/v1/component-files/download", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deviceCredential)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("HTTP %d downloading component file: %s", resp.StatusCode, string(body))
	}
	return resp, nil
}

// DownloadRustdeskInstaller returns the pinned RustDesk installer, authorized
// the same way as DownloadComponentFile (device credential + short-lived
// command grant) -- a separate endpoint rather than reusing
// DownloadComponentFile directly, since the installer isn't a
// component_files row. The caller owns and must close the response body.
func (c *Client) DownloadRustdeskInstaller(deviceCredential, token string) (*http.Response, error) {
	b, err := json.Marshal(struct {
		Token string `json:"token"`
	}{Token: token})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.serverURL+"/v1/rustdesk-installer/download", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deviceCredential)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("HTTP %d downloading RustDesk installer: %s", resp.StatusCode, string(body))
	}
	return resp, nil
}

// RedeemRustdeskPassword retrieves the plaintext unattended-access password
// generated for this device's install_rustdesk command, authorized by the
// device credential plus a short-lived, single-use grant token -- see
// worker/src/routes/rustdesk-password.ts's own doc comment for why this
// exists as a separate redemption step rather than the password ever
// appearing in the command payload itself.
func (c *Client) RedeemRustdeskPassword(deviceCredential, token string) (string, error) {
	b, err := json.Marshal(struct {
		Token string `json:"token"`
	}{Token: token})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, c.serverURL+"/v1/rustdesk-password/redeem", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deviceCredential)
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("HTTP %d redeeming RustDesk password: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Password, nil
}

// BrandingIdentityResponse mirrors GET /v1/branding/identity's response
// shape. Deliberately camelCase JSON tags -- this hits the same public,
// dashboard-facing endpoint the dashboard itself calls, not a new
// device-scoped wire contract, so it follows that endpoint's own naming
// instead of this file's snake_case device-protocol convention.
type BrandingIdentityResponse struct {
	SupportURL string `json:"supportUrl"`
}

// identityClient gets its own short timeout, same reasoning as the
// updater package's versionCheckClient -- a hung request here must never
// block checkIn()'s caller.
var identityClient = &http.Client{Timeout: 30 * time.Second}

// BrandingIdentity fetches the host's current branding identity --
// unauthenticated, public, and deliberately polled independently of
// check-in rather than folded into CheckInResponse. support_url is pure
// one-way config with no round trip, a worse fit for the check-in wire
// protocol than any field already there -- see CLAUDE.md's Network
// Discovery / Patch Management sections for the check-in-extension rule
// this sidesteps.
func (c *Client) BrandingIdentity() (*BrandingIdentityResponse, error) {
	resp, err := identityClient.Get(c.serverURL + "/v1/branding/identity")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from /v1/branding/identity", resp.StatusCode)
	}
	var result BrandingIdentityResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func post[T any](c *Client, path, auth string, body any) (*T, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.serverURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", auth)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, path)
	}
	var result T
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
