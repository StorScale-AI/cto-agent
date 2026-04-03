import { describe, it, expect } from 'vitest';
import { match } from '../../patterns/console-leak.js';

const SAMPLE_LOG = `
Tests	Run test suite	2026-04-03T17:58:51.3120318Z ##[group]Run npm test
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.0001Z ##[group]Run check
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.1000Z ::error::Direct console usage found. Use shared/utils/logger.js instead:
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.1001Z agents/dynamic-pricing/index.js:42: console.log('Pricing updated')
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.1002Z agents/dynamic-pricing/index.js:87: console.warn('No rates found')
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.1003Z shared/integrations/airtable.js:15: console.error('Airtable connection failed')
Lint & Format	Check for console.log leaks	2026-04-03T17:58:54.2000Z ##[error]Process completed with exit code 1.
`;

describe('console-leak pattern matcher', () => {
  it('should detect console.log leaks from CI output', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
    expect(result!.patternName).toBe('console-leak');
    expect(result!.confidence).toBe(0.95);
    expect(result!.files).toHaveLength(2); // 2 unique files
  });

  it('should group leaks by file', () => {
    const result = match(SAMPLE_LOG, []);
    const files = result!.files.map(f => f.path);
    expect(files).toContain('agents/dynamic-pricing/index.js');
    expect(files).toContain('shared/integrations/airtable.js');
  });

  it('should return null for logs without console leaks', () => {
    const cleanLog = 'Tests passed. All good.';
    expect(match(cleanLog, [])).toBeNull();
  });

  it('should handle single leak', () => {
    const singleLeak = `
::error::Direct console usage found. Use shared/utils/logger.js instead:
agents/foo/index.js:10: console.log('test')
##[error]Process completed with exit code 1.
`;
    const result = match(singleLeak, []);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
  });
});
