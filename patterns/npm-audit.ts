import type { PatternResult } from './types.js';

/**
 * Detects npm audit failures. These are usually not auto-fixable
 * (requires manual judgment about breaking changes), so this matcher
 * mostly classifies them for escalation. Only matches if CI actually
 * failed due to audit (not continue-on-error).
 */

const AUDIT_REGEX = /npm audit.*found \d+ vulnerabilit/i;
const HIGH_CRITICAL_REGEX = /(\d+) (high|critical)/gi;

export function match(logText: string, _annotations: string[]): PatternResult | null {
  if (!AUDIT_REGEX.test(logText)) return null;

  const matches = [...logText.matchAll(HIGH_CRITICAL_REGEX)];
  if (matches.length === 0) return null;

  // npm audit failures are generally not safe to auto-fix
  // (npm audit fix --force can introduce breaking changes)
  // Return low confidence so it escalates to Claude Code or Slack
  return {
    matched: true,
    patternName: 'npm-audit',
    description: `npm audit found vulnerabilities: ${matches.map(m => `${m[1]} ${m[2]}`).join(', ')}`,
    confidence: 0.3, // Below threshold — will escalate
    escalateOnly: true, // npm audit failures can't be auto-fixed safely
    files: [],
    testFiles: [],
  };
}
