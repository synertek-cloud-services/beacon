// Shared between routes/admin/components.ts (storing/validating the rules) and
// routes/checkin.ts (evaluating them against a completed command's stdout/stderr).
export interface PostCondition {
  id:         string;
  stream:     'stdout' | 'stderr' | 'both';
  match_type: 'contains' | 'regex';
  pattern:    string;
  enabled:    boolean;
}

export function evaluatePostConditions(conditions: PostCondition[], stdout: string, stderr: string): boolean {
  for (const cond of conditions) {
    if (!cond.enabled) continue;
    const text = cond.stream === 'stdout' ? stdout : cond.stream === 'stderr' ? stderr : `${stdout}\n${stderr}`;
    if (cond.match_type === 'contains' && text.includes(cond.pattern)) return true;
    if (cond.match_type === 'regex') {
      try {
        if (new RegExp(cond.pattern).test(text)) return true;
      } catch {
        // invalid pattern authored client-side — ignore rather than crash check-in
      }
    }
  }
  return false;
}
