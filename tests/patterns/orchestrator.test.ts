import { describe, it, expect } from 'vitest';
import { matchPatterns, matchAllPatterns } from '../../patterns/index.js';

describe('pattern orchestrator', () => {
  it('should match console leak pattern', () => {
    const log = `::error::Direct console usage found. Use shared/utils/logger.js instead:
agents/foo/index.js:10: console.log('test')
##[error]Process completed with exit code 1.`;

    const result = matchPatterns(log);
    expect(result).not.toBeNull();
    expect(result!.patternName).toBe('console-leak');
  });

  it('should match broken require pattern', () => {
    const log = '::error::Broken require in agents/foo/index.js: ../../missing';
    const result = matchPatterns(log);
    expect(result).not.toBeNull();
    expect(result!.patternName).toBe('broken-require');
  });

  it('should match missing agent pattern', () => {
    const log = '::error::Missing agents: test-agent';
    const result = matchPatterns(log);
    expect(result).not.toBeNull();
    expect(result!.patternName).toBe('missing-agent-index');
  });

  it('should return null for unrecognized failures', () => {
    const log = 'Error: Something completely unexpected happened';
    expect(matchPatterns(log)).toBeNull();
  });

  it('should skip low-confidence matches (npm-audit)', () => {
    const log = 'npm audit --audit-level=high\nnpm audit found 3 vulnerabilities\n2 high 1 critical';
    const result = matchPatterns(log);
    expect(result).toBeNull(); // npm-audit has confidence 0.3, below 0.8 threshold
  });

  it('should return all matches via matchAllPatterns', () => {
    const log = 'npm audit --audit-level=high\nnpm audit found 3 vulnerabilities\n2 high 1 critical';
    const results = matchAllPatterns(log);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].patternName).toBe('npm-audit');
  });

  it('should return first high-confidence match (priority order)', () => {
    // Log that could match multiple patterns — console-leak is first in priority
    const log = `::error::Direct console usage found. Use shared/utils/logger.js instead:
agents/foo/index.js:10: console.log('test')
##[error]Process completed with exit code 1.
::error::Broken require in agents/bar/index.js: ../../missing`;

    const result = matchPatterns(log);
    expect(result!.patternName).toBe('console-leak'); // Higher priority
  });
});
