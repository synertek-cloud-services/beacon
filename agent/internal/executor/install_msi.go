package executor

import (
	"regexp"
)

type installMSIPayload struct {
	InstallerFileID    string            `json:"installer_file_id"`
	InstallerArguments []string          `json:"installer_arguments"`
	TimeoutSeconds     int               `json:"timeout_seconds"`
	DetectionType      string            `json:"detection_type"`
	DetectionValue     *string           `json:"detection_value"`
	Architecture       string            `json:"architecture"`
	Files              []componentFile   `json:"files"`
	Variables          map[string]string `json:"variables,omitempty"`
}

type componentFile struct {
	ID            string `json:"id"`
	OriginalName  string `json:"original_name"`
	SHA256        string `json:"sha256"`
	SizeBytes     int64  `json:"size_bytes"`
	DownloadToken string `json:"download_token"`
}

var installerVariablePattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandInstallerArgument supports the explicit ${CV_KEY}/${CF_KEY} notation
// used by Application Component arguments. Expansion happens on the agent,
// immediately before exec.Command, rather than serializing a secret-expanded
// command line into the worker's command history.
func expandInstallerArgument(argument string, variables map[string]string) (string, error) {
	var missing string
	expanded := installerVariablePattern.ReplaceAllStringFunc(argument, func(match string) string {
		key := installerVariablePattern.FindStringSubmatch(match)[1]
		value, ok := variables[key]
		if !ok {
			missing = key
			return match
		}
		return value
	})
	if missing != "" {
		return "", &missingInstallerVariableError{name: missing}
	}
	return expanded, nil
}

type missingInstallerVariableError struct{ name string }

func (e *missingInstallerVariableError) Error() string {
	return "missing installer variable " + e.name
}
