package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
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
