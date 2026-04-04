import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn(() => ''),
}));

vi.mock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

vi.mock('../../monitor/src/slack.js', () => ({
  alertPlatformIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../monitor/src/health-api.js', () => ({
  recordHealth: vi.fn(),
}));

import { pollCloudflare } from '../../monitor/src/pollers/cloudflare.js';
import { recordHealth } from '../../monitor/src/health-api.js';
import { alertPlatformIssue } from '../../monitor/src/slack.js';
import { optionalEnv } from '../../monitor/src/lib/env.js';

describe('Cloudflare poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(optionalEnv).mockReturnValue('');
  });

  it('records healthy when all workers respond 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }));

    await pollCloudflare();

    expect(recordHealth).toHaveBeenCalledWith('cloudflare', expect.objectContaining({
      status: 'healthy',
      workers: expect.arrayContaining([
        expect.objectContaining({
          name: 'storops-dashboard-api',
          status: 'healthy',
          latencyMs: expect.any(Number),
        }),
      ]),
    }));
  });

  it('records degraded when a worker returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    await pollCloudflare();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Cloudflare', expect.stringContaining('503'));
    expect(recordHealth).toHaveBeenCalledWith('cloudflare', expect.objectContaining({
      status: 'degraded',
      workers: expect.arrayContaining([
        expect.objectContaining({
          name: 'storops-dashboard-api',
          status: 'http_503',
        }),
      ]),
    }));
  });

  it('records degraded when a worker is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await pollCloudflare();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Cloudflare', expect.stringContaining('unreachable'));
    expect(recordHealth).toHaveBeenCalledWith('cloudflare', expect.objectContaining({
      status: 'degraded',
      workers: expect.arrayContaining([
        expect.objectContaining({
          name: 'storops-dashboard-api',
          status: 'unreachable',
        }),
      ]),
    }));
  });

  it('verifies API token when CLOUDFLARE_API_TOKEN is set', async () => {
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'CLOUDFLARE_API_TOKEN') return 'cf-fake-token';
      return '';
    });

    const mockFetch = vi.fn()
      // Worker health check
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // Token verify
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    vi.stubGlobal('fetch', mockFetch);

    await pollCloudflare();

    // Should have called fetch for both worker health and token verify
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cf-fake-token',
        }),
      }),
    );
  });

  it('does not call token verify when no CLOUDFLARE_API_TOKEN', async () => {
    vi.mocked(optionalEnv).mockReturnValue('');

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await pollCloudflare();

    // Only worker health check, no token verify
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
