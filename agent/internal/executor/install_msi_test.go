package executor

import "testing"

func TestExpandInstallerArgument(t *testing.T) {
	argument, err := expandInstallerArgument(`SITE=${CV_AV_SITE_TOKEN};ASSET=${CF_ASSET_TAG}`, map[string]string{
		"CV_AV_SITE_TOKEN": "license-value",
		"CF_ASSET_TAG":     "server-01",
	})
	if err != nil {
		t.Fatalf("expandInstallerArgument returned error: %v", err)
	}
	if want := "SITE=license-value;ASSET=server-01"; argument != want {
		t.Fatalf("argument = %q, want %q", argument, want)
	}
}

func TestExpandInstallerArgumentRejectsMissingValue(t *testing.T) {
	if _, err := expandInstallerArgument(`${CV_MISSING}`, nil); err == nil {
		t.Fatal("expected missing variable error")
	}
}
