import type { PatternResult } from './types.js';

/**
 * Detects CI failures from console.log/warn/error usage in production code.
 * CI output format: "Direct console usage found. Use shared/utils/logger.js instead:"
 * followed by file:line pairs like "agents/foo/index.js:42: console.log('...')"
 */

const TRIGGER_REGEX = /Direct console usage found.*instead:/;
const LEAK_LINE_REGEX = /^(\S+\.js):(\d+):\s*(console\.(log|warn|error)\(.+)/;

interface LeakLocation {
  file: string;
  line: number;
  original: string;
  method: 'log' | 'warn' | 'error';
}

function parseLeaks(logText: string): LeakLocation[] {
  const lines = logText.split('\n');
  const leaks: LeakLocation[] = [];
  let inSection = false;

  for (const line of lines) {
    if (TRIGGER_REGEX.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // Strip CI log prefixes: "JobName\tStepName\tTimestamp content" or just "Timestamp content"
      const cleaned = line
        .replace(/^[^\t]*\t[^\t]*\t/, '')
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '')
        .trim();
      const match = cleaned.match(LEAK_LINE_REGEX);
      if (match) {
        leaks.push({
          file: match[1],
          line: parseInt(match[2], 10),
          original: match[3],
          method: match[4] as 'log' | 'warn' | 'error',
        });
      } else if (cleaned.startsWith('##[error]') || cleaned === '') {
        inSection = false;
      }
    }
  }
  return leaks;
}

const METHOD_MAP: Record<string, string> = {
  log: 'info',
  warn: 'warn',
  error: 'error',
};

export function match(logText: string, _annotations: string[]): PatternResult | null {
  if (!TRIGGER_REGEX.test(logText)) return null;

  const leaks = parseLeaks(logText);
  if (leaks.length === 0) return null;

  // Group by file
  const byFile = new Map<string, LeakLocation[]>();
  for (const leak of leaks) {
    const existing = byFile.get(leak.file) || [];
    existing.push(leak);
    byFile.set(leak.file, existing);
  }

  const files = Array.from(byFile.entries()).map(([file, fileLeaks]) => ({
    path: file,
    content: fileLeaks.map(l =>
      `// Line ${l.line}: Replace console.${l.method}(...) with logger.${METHOD_MAP[l.method]}(...)`
    ).join('\n'),
    action: 'modify' as const,
  }));

  return {
    matched: true,
    patternName: 'console-leak',
    description: `Replace ${leaks.length} console.${leaks[0].method} call(s) with logger in ${byFile.size} file(s)`,
    confidence: 0.95,
    files,
    testFiles: [],
  };
}
