package executor

type installRustdeskPayload struct {
	DownloadToken string `json:"download_token"`
	SHA256        string `json:"sha256"`
	SizeBytes     int64  `json:"size_bytes"`
	PasswordToken string `json:"password_token"`
}
