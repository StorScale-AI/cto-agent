import { describe, it, expect } from 'vitest';
import { match } from '../../patterns/secret-scanner-fp.js';

// Real CI log from today's failure
const SAMPLE_LOG = `
Security Audit	Check for hardcoded secrets	::error::Potential hardcoded secrets detected:
Security Audit	Check for hardcoded secrets	shared/integrations/stortrack.js:18:    this.password = process.env.STORTRACK_PASSWORD || '';
Security Audit	Check for hardcoded secrets	shared/connectors/stortrack/live.js:35:    this.password = process.env.STORTRACK_PASSWORD || '';
Security Audit	Check for hardcoded secrets	##[error]Process completed with exit code 1.
`;

const REAL_SECRET_LOG = `
Security Audit	Check for hardcoded secrets	::error::Potential hardcoded secrets detected:
Security Audit	Check for hardcoded secrets	agents/foo/index.js:10:    const key = 'sk-ant-api03-realkey123';
Security Audit	Check for hardcoded secrets	##[error]Process completed with exit code 1.
`;

const MIXED_LOG = `
Security Audit	Check for hardcoded secrets	::error::Potential hardcoded secrets detected:
Security Audit	Check for hardcoded secrets	shared/integrations/stortrack.js:18:    this.password = process.env.STORTRACK_PASSWORD || '';
Security Audit	Check for hardcoded secrets	agents/foo/index.js:10:    const key = 'sk_live_realkey123';
Security Audit	Check for hardcoded secrets	##[error]Process completed with exit code 1.
`;

describe('secret-scanner-fp pattern matcher', () => {
  it('should detect false positives (all process.env reads)', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
    expect(result!.patternName).toBe('secret-scanner-fp');
    expect(result!.confidence).toBe(0.85);
  });

  it('should NOT match when there are real secrets', () => {
    const result = match(REAL_SECRET_LOG, []);
    expect(result).toBeNull();
  });

  it('should NOT match when there is a mix of real and false positives', () => {
    const result = match(MIXED_LOG, []);
    expect(result).toBeNull();
  });

  it('should return null for logs without secret scanner output', () => {
    expect(match('Tests passed.', [])).toBeNull();
  });

  it('should target ci.yml for the fix', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result!.files[0].path).toBe('.github/workflows/ci.yml');
  });
});
