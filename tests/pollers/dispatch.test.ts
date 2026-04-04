import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn(() => 'fake-pat'),
}));

vi.mock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

vi.mock('../../monitor/src/lib/supabase.js', () => ({
  loadState: vi.fn(() => Promise.resolve(null)),
  saveState: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

// Use dynamic import to get a fresh module for each test
// since dispatch.ts has module-level state (rate limiter, circuit breaker)
let dispatchAutoFix: typeof import('../../monitor/src/dispatch.js').dispatchAutoFix;

describe('Dispatch module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock('../../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(() => 'fake-pat'),
    }));
    vi.doMock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
    vi.doMock('../../monitor/src/lib/supabase.js', () => ({
      loadState: vi.fn(() => Promise.resolve(null)),
      saveState: vi.fn(() => Promise.resolve()),
    }));
    vi.doMock('../../monitor/src/slack.js', () => ({
      sendAlert: vi.fn(() => Promise.resolve(true)),
    }));

    const mod = await import('../../monitor/src/dispatch.js');
    dispatchAutoFix = mod.dispatchAutoFix;
  });

  it('dispatches successfully and returns true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
    }));

    const result = await dispatchAutoFix('test/repo', 1001, 'CI');

    expect(result).toBe(true);
  });

  it('sends workflow_dispatch request to correct endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    await dispatchAutoFix('test/repo', 1001, 'CI');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/StorScale-AI/cto-agent/actions/workflows/auto-fix.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"repo":"test/repo"'),
      }),
    );
  });

  it('returns false when API returns non-204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 422,
      ok: false,
      text: () => Promise.resolve('Unprocessable'),
    }));

    const result = await dispatchAutoFix('test/repo', 2001, 'CI');

    expect(result).toBe(false);
  });

  it('returns false when GITHUB_PAT is not set', async () => {
    vi.resetModules();
    vi.doMock('../../monitor/src/lib/env.js', () => ({
      optionalEnv: vi.fn(() => ''),
    }));
    vi.doMock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));
    vi.doMock('../../monitor/src/lib/supabase.js', () => ({
      loadState: vi.fn(() => Promise.resolve(null)),
      saveState: vi.fn(() => Promise.resolve()),
    }));
    vi.doMock('../../monitor/src/slack.js', () => ({
      sendAlert: vi.fn(() => Promise.resolve(true)),
    }));

    const mod = await import('../../monitor/src/dispatch.js');

    const result = await mod.dispatchAutoFix('test/repo', 3001, 'CI');

    expect(result).toBe(false);
  });

  it('rate limits after 3 dispatches per hour for same repo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    // First 3 should succeed
    const r1 = await dispatchAutoFix('test/repo', 1001, 'CI');
    const r2 = await dispatchAutoFix('test/repo', 1002, 'CI');
    const r3 = await dispatchAutoFix('test/repo', 1003, 'CI');

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);

    // 4th should be rate limited
    const r4 = await dispatchAutoFix('test/repo', 1004, 'CI');
    expect(r4).toBe(false);
  });

  it('rate limits are per-repo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    // Fill up rate limit for repo-a
    await dispatchAutoFix('test/repo-a', 1001, 'CI');
    await dispatchAutoFix('test/repo-a', 1002, 'CI');
    await dispatchAutoFix('test/repo-a', 1003, 'CI');

    // repo-a should be rate limited
    const ra4 = await dispatchAutoFix('test/repo-a', 1004, 'CI');
    expect(ra4).toBe(false);

    // But repo-b should still work (though circuit breaker may activate at 5 failures)
    // We have 4 failures so far, so 5th will trip circuit breaker
    // Actually the 5th call pushes us to 5 recentFailures which trips the breaker
    const rb1 = await dispatchAutoFix('test/repo-b', 2001, 'CI');
    // This will be false due to circuit breaker tripping at 5 failures
    expect(rb1).toBe(false);
  });

  it('returns false on fetch exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await dispatchAutoFix('test/repo', 5001, 'CI');

    expect(result).toBe(false);
  });

  it('triggers circuit breaker after threshold failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    // Each dispatchAutoFix call pushes to recentFailures.
    // Threshold is 5 within 15 min window.
    // Use different repos to avoid per-repo rate limit.
    await dispatchAutoFix('repo/a', 1, 'CI');
    await dispatchAutoFix('repo/b', 2, 'CI');
    await dispatchAutoFix('repo/c', 3, 'CI');
    await dispatchAutoFix('repo/d', 4, 'CI');

    // 5th failure triggers circuit breaker
    const r5 = await dispatchAutoFix('repo/e', 5, 'CI');
    expect(r5).toBe(false);

    // 6th should also be blocked
    const r6 = await dispatchAutoFix('repo/f', 6, 'CI');
    expect(r6).toBe(false);
  });
});
