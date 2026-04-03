import { describe, it, expect } from 'vitest';
import { match } from '../../patterns/env-var-mismatch.js';

// Real CI log from today's failure
const SAMPLE_LOG = `
Tests	Run test suite	2026-04-03T17:58:54.3711600Z         not ok 3 - should specify required environment variables
Tests	Run test suite	2026-04-03T17:58:54.3713701Z           ---
Tests	Run test suite	2026-04-03T17:58:54.3717383Z           location: '/home/runner/work/storscale-agents/storscale-agents/storscale-agents/tests/unit/deployment-monitor.test.js:63:5'
Tests	Run test suite	2026-04-03T17:58:54.3720748Z           failureType: 'testCodeFailure'
Tests	Run test suite	2026-04-03T17:58:54.3721275Z           error: |-
Tests	Run test suite	2026-04-03T17:58:54.3721792Z             The expression evaluated to a falsy value:
Tests	Run test suite	2026-04-03T17:58:54.3722987Z               assert.ok(agent.config.requiredEnv.includes('SUPABASE_SERVICE_KEY'))
Tests	Run test suite	2026-04-03T17:58:54.3791579Z         not ok 3 - should throw error if SUPABASE_SERVICE_KEY is missing
Tests	Run test suite	2026-04-03T17:58:54.3796079Z           error: |-
Tests	Run test suite	2026-04-03T17:58:54.3796758Z             The input did not match the regular expression /SUPABASE_SERVICE_KEY/. Input:
Tests	Run test suite	2026-04-03T17:58:54.3798124Z             'Error: Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY'
Tests	Run test suite	2026-04-03T17:58:54.3810255Z           location: '/home/runner/work/storscale-agents/storscale-agents/storscale-agents/tests/unit/deployment-monitor.test.js:93:5'
Tests	Run test suite	2026-04-03T17:58:54.3839500Z         not ok 5 - should pass with all required environment variables
Tests	Run test suite	2026-04-03T17:58:54.3844157Z             Got unwanted exception.
Tests	Run test suite	2026-04-03T17:58:54.3845272Z             Actual message: "Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY"
Tests	Run test suite	2026-04-03T17:58:54.3842071Z           location: '/home/runner/work/storscale-agents/storscale-agents/storscale-agents/tests/unit/deployment-monitor.test.js:111:5'
`;

describe('env-var-mismatch pattern matcher', () => {
  it('should detect env var name mismatch from real CI output', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
    expect(result!.patternName).toBe('env-var-mismatch');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('should identify the old and new env var names', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result!.description).toContain('SUPABASE_SERVICE_KEY');
    expect(result!.description).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('should return null for logs without env var mismatches', () => {
    const cleanLog = 'ok 1 - all tests passed\n# tests 47\n# pass 47';
    expect(match(cleanLog, [])).toBeNull();
  });
});
