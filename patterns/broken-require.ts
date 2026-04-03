import type { PatternResult } from './types.js';

/**
 * Detects broken require() paths from CI validation.
 * CI output format: "::error::Broken require in agents/foo/index.js: ../../shared/missing"
 */

const BROKEN_REQUIRE_REGEX = /::error::Broken require in (\S+): (\S+)/g;

interface BrokenRequire {
  file: string;
  requirePath: string;
}

export function match(logText: string, _annotations: string[]): PatternResult | null {
  const broken: BrokenRequire[] = [];

  let m;
  while ((m = BROKEN_REQUIRE_REGEX.exec(logText)) !== null) {
    broken.push({ file: m[1], requirePath: m[2] });
  }

  if (broken.length === 0) return null;

  const files = broken.map(b => ({
    path: b.file,
    content: `// Fix require path '${b.requirePath}' — resolve correct path`,
    action: 'modify' as const,
  }));

  return {
    matched: true,
    patternName: 'broken-require',
    description: `Fix ${broken.length} broken require() path(s) in ${new Set(broken.map(b => b.file)).size} file(s)`,
    confidence: 0.9,
    files,
    testFiles: [],
  };
}
