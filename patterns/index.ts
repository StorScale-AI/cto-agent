import type { PatternResult } from './types.js';
import * as consoleLeak from './console-leak.js';
import * as envVarMismatch from './env-var-mismatch.js';
import * as brokenRequire from './broken-require.js';
import * as secretScannerFp from './secret-scanner-fp.js';
import * as missingAgentIndex from './missing-agent-index.js';
import * as npmAudit from './npm-audit.js';

export type { PatternResult, FilePatch, PatternMatcher } from './types.js';

const CONFIDENCE_THRESHOLD = 0.8;

// Ordered by specificity — most deterministic patterns first
const PATTERNS = [
  consoleLeak,
  brokenRequire,
  missingAgentIndex,
  secretScannerFp,
  envVarMismatch,
  npmAudit,
];

/**
 * Run all pattern matchers against CI failure logs.
 * Returns the first match above the confidence threshold, or null.
 */
export function matchPatterns(logText: string, annotations: string[] = []): PatternResult | null {
  for (const pattern of PATTERNS) {
    const result = pattern.match(logText, annotations);
    if (result?.matched && result.confidence >= CONFIDENCE_THRESHOLD) {
      return result;
    }
  }
  return null;
}

/**
 * Run all pattern matchers and return ALL matches (for diagnostics).
 * Includes low-confidence matches that wouldn't trigger auto-fix.
 */
export function matchAllPatterns(logText: string, annotations: string[] = []): PatternResult[] {
  const results: PatternResult[] = [];
  for (const pattern of PATTERNS) {
    const result = pattern.match(logText, annotations);
    if (result?.matched) {
      results.push(result);
    }
  }
  return results;
}
