import type { PatternResult } from './types.js';

/**
 * Detects env var name mismatches between agent code and tests.
 * Common pattern: agent uses SUPABASE_SERVICE_ROLE_KEY but test references SUPABASE_SERVICE_KEY.
 *
 * CI output patterns:
 * - "The expression evaluated to a falsy value: assert.ok(agent.config.requiredEnv.includes('OLD_NAME'))"
 * - "The input did not match the regular expression /OLD_NAME/. Input: '...NEW_NAME...'"
 * - "Got unwanted exception. Actual message: \"Missing required environment variables: NEW_NAME\""
 */

interface EnvMismatch {
  testFile: string;
  oldName: string;
  newName: string;
}

const FALSY_REGEX = /assert\.ok\(.*\.includes\('([A-Z_]+)'\)\)/;
const REGEX_MISMATCH = /did not match the regular expression \/([A-Z_]+)\//;
const ACTUAL_NAME_REGEX = /Missing required environment variables: ([A-Z_,\s]+)/;
const LOCATION_REGEX = /location: '(.+\.test\.js):(\d+):\d+'/;

export function match(logText: string, _annotations: string[]): PatternResult | null {
  const mismatches: EnvMismatch[] = [];
  const lines = logText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern 1: assert.ok(x.includes('OLD_NAME')) evaluated to falsy
    const falsyMatch = line.match(FALSY_REGEX);
    if (falsyMatch) {
      const oldName = falsyMatch[1];
      // Look ahead for location
      const locationLine = lines.slice(i, i + 10).find(l => LOCATION_REGEX.test(l));
      const testFile = locationLine?.match(LOCATION_REGEX)?.[1] || '';

      // Look for actual name in nearby lines
      const nearbyText = lines.slice(Math.max(0, i - 20), i + 20).join('\n');
      const actualMatch = nearbyText.match(ACTUAL_NAME_REGEX);
      if (actualMatch && testFile) {
        const newName = actualMatch[1].trim();
        if (oldName !== newName && oldName.length > 3) {
          mismatches.push({ testFile, oldName, newName });
        }
      }
    }

    // Pattern 2: regex mismatch — /OLD_NAME/ didn't match, but NEW_NAME appeared
    const regexMatch = line.match(REGEX_MISMATCH);
    if (regexMatch) {
      const oldName = regexMatch[1];
      const nearbyText = lines.slice(i, i + 5).join('\n');
      const actualMatch = nearbyText.match(ACTUAL_NAME_REGEX);
      const locationLine = lines.slice(i, i + 15).find(l => LOCATION_REGEX.test(l));
      const testFile = locationLine?.match(LOCATION_REGEX)?.[1] || '';

      if (actualMatch && testFile) {
        const newName = actualMatch[1].trim();
        if (oldName !== newName) {
          mismatches.push({ testFile, oldName, newName });
        }
      }
    }
  }

  if (mismatches.length === 0) return null;

  // Deduplicate by oldName+newName
  const unique = new Map<string, EnvMismatch>();
  for (const m of mismatches) {
    unique.set(`${m.oldName}→${m.newName}`, m);
  }
  const deduped = Array.from(unique.values());

  // Group by test file
  const byFile = new Map<string, EnvMismatch[]>();
  for (const m of deduped) {
    const existing = byFile.get(m.testFile) || [];
    existing.push(m);
    byFile.set(m.testFile, existing);
  }

  const files = Array.from(byFile.entries()).map(([file, fileMismatches]) => ({
    path: file,
    content: fileMismatches.map(m =>
      `// Replace all occurrences of '${m.oldName}' with '${m.newName}'`
    ).join('\n'),
    action: 'modify' as const,
  }));

  return {
    matched: true,
    patternName: 'env-var-mismatch',
    description: `Rename ${deduped.length} env var reference(s): ${deduped.map(m => `${m.oldName} → ${m.newName}`).join(', ')}`,
    confidence: 0.85,
    files,
    testFiles: [],
  };
}
