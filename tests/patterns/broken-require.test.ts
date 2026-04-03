import { describe, it, expect } from 'vitest';
import { match } from '../../patterns/broken-require.js';

const SAMPLE_LOG = `
Validate Agent Structure	Check for require() resolution	::error::Broken require in agents/seo-agent/index.js: ../../shared/integrations/missing-client
Validate Agent Structure	Check for require() resolution	::error::Broken require in agents/ad-agent/index.js: ../../shared/utils/old-helper
Validate Agent Structure	Check for require() resolution	::error::2 broken require() paths found
`;

describe('broken-require pattern matcher', () => {
  it('should detect broken require paths', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
    expect(result!.patternName).toBe('broken-require');
    expect(result!.confidence).toBe(0.9);
    expect(result!.files).toHaveLength(2);
  });

  it('should identify affected files', () => {
    const result = match(SAMPLE_LOG, []);
    const files = result!.files.map(f => f.path);
    expect(files).toContain('agents/seo-agent/index.js');
    expect(files).toContain('agents/ad-agent/index.js');
  });

  it('should return null for clean logs', () => {
    const cleanLog = '✓ All require() paths resolve correctly';
    expect(match(cleanLog, [])).toBeNull();
  });

  it('should handle single broken require', () => {
    const single = '::error::Broken require in agents/foo/index.js: ../../bar';
    const result = match(single, []);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
  });
});
