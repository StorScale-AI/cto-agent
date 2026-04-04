import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn((key: string) => {
    if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
    if (key === 'STRIPE_WEBHOOK_ENDPOINT_ID') return 'we_123';
    return '';
  }),
}));

vi.mock('../../monitor/src/lib/logger.js', () => ({ log: vi.fn() }));

vi.mock('../../monitor/src/slack.js', () => ({
  alertPlatformIssue: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../monitor/src/health-api.js', () => ({
  recordHealth: vi.fn(),
}));

import { pollStripe } from '../../monitor/src/pollers/stripe.js';
import { recordHealth } from '../../monitor/src/health-api.js';
import { alertPlatformIssue } from '../../monitor/src/slack.js';
import { optionalEnv } from '../../monitor/src/lib/env.js';

describe('Stripe poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset optionalEnv to default behavior
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
      if (key === 'STRIPE_WEBHOOK_ENDPOINT_ID') return 'we_123';
      return '';
    });
  });

  it('records healthy when webhook is active and no recent disables', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // First call: webhook endpoint check
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'enabled' }),
      })
      // Second call: events check
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      }),
    );

    await pollStripe();

    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'healthy',
      webhook_status: 'enabled',
      recent_disables: 0,
    }));
  });

  it('alerts when webhook endpoint is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'disabled' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      }),
    );

    await pollStripe();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Stripe', expect.stringContaining('disabled'));
    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'degraded',
      webhook_status: 'disabled',
    }));
  });

  it('alerts on recent webhook disable events', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'enabled' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'evt_1' }, { id: 'evt_2' }] }),
      }),
    );

    await pollStripe();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Stripe', expect.stringContaining('2 webhook endpoint disable'));
    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'degraded',
      recent_disables: 2,
    }));
  });

  it('skips when STRIPE_SECRET_KEY is missing', async () => {
    vi.mocked(optionalEnv).mockReturnValue('');

    await pollStripe();

    expect(recordHealth).not.toHaveBeenCalled();
  });

  it('handles webhook endpoint API failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      }),
    );

    await pollStripe();

    // Should still record health with unknown webhook status
    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'healthy',
      webhook_status: 'unknown',
    }));
  });

  it('records error status on fetch exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await pollStripe();

    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'error',
      error: expect.stringContaining('Network error'),
    }));
  });

  it('works without STRIPE_WEBHOOK_ENDPOINT_ID', async () => {
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
      return '';
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    }));

    await pollStripe();

    // Should skip webhook endpoint check but still check events
    expect(recordHealth).toHaveBeenCalledWith('stripe', expect.objectContaining({
      status: 'healthy',
      webhook_status: 'unknown',
    }));
  });
});
