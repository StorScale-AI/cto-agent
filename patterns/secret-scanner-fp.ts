import type { PatternResult } from './types.js';

/**
 * Detects false positives from the CI secret scanner.
 * CI output: "::error::Potential hardcoded secrets detected:"
 * followed by file:line matches like "shared/integrations/stortrack.js:18: this.password = process.env.X || '';"
 *
 * We only match lines that reference process.env (not actual hardcoded secrets).
 */

const TRIGGER_REGEX = /::error::Potential hardcoded secrets detected:/;
const SECRET_LINE_REGEX = /^(\S+\.js):(\d+):\s*(.+)/;
const PROCESS_ENV_REGEX = /process\.env\./;

interface FalsePositive {
  file: string;
  line: number;
  content: string;
}

export function match(logText: string, _annotations: string[]): PatternResult | null {
  if (!TRIGGER_REGEX.test(logText)) return null;

  const lines = logText.split('\n');
  const falsePositives: FalsePositive[] = [];
  const realSecrets: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (TRIGGER_REGEX.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // Strip CI log prefixes: "JobName\tStepName\tTimestamp content" or just "Timestamp content"
      const cleaned = line
        .replace(/^[^\t]*\t[^\t]*\t/, '')           // Strip tab-separated job/step prefix
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '') // Strip timestamp
        .trim();
      const m = cleaned.match(SECRET_LINE_REGEX);
      if (m) {
        if (PROCESS_ENV_REGEX.test(m[3])) {
          falsePositives.push({ file: m[1], line: parseInt(m[2], 10), content: m[3] });
        } else {
          realSecrets.push(cleaned);
        }
      } else if (cleaned.startsWith('##[error]') && cleaned !== '##[error]Potential hardcoded secrets detected:') {
        inSection = false;
      }
    }
  }

  // Only auto-fix if ALL detections are false positives (process.env references)
  if (falsePositives.length === 0 || realSecrets.length > 0) return null;

  // The fix: the CI workflow's password regex needs to be tightened
  // to not match process.env reads like: this.password = process.env.X || '';
  return {
    matched: true,
    patternName: 'secret-scanner-fp',
    description: `${falsePositives.length} false positive(s) in secret scanner — all are process.env reads`,
    confidence: 0.85,
    files: [{
      path: '.github/workflows/ci.yml',
      content: `// Tighten password regex to not match process.env patterns. Flagged files: ${falsePositives.map(fp => fp.file).join(', ')}`,
      action: 'modify',
    }],
    testFiles: [],
  };
}
