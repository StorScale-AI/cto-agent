import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../monitor/src/lib/env.js', () => ({
  optionalEnv: vi.fn((key: string) => {
    if (key === 'RENDER_API_KEY') return 'fake-key';
    if (key === 'RENDER_SERVICE_IDS') return 'agent-api:srv-123,scheduler:srv-456';
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

import { pollRender } from '../../monitor/src/pollers/render.js';
import { recordHealth } from '../../monitor/src/health-api.js';
import { alertPlatformIssue } from '../../monitor/src/slack.js';
import { optionalEnv } from '../../monitor/src/lib/env.js';

describe('Render poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default env mock (tests that override must come last or restore)
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'RENDER_API_KEY') return 'fake-key';
      if (key === 'RENDER_SERVICE_IDS') return 'agent-api:srv-123,scheduler:srv-456';
      return '';
    });
  });

  it('records healthy when deploys succeed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        id: 'dep-123',
        status: 'live',
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        commit: { message: 'deploy' },
      }]),
    }));

    await pollRender();

    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      status: 'healthy',
    }));
  });

  it('includes service details in health record', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        id: 'dep-789',
        status: 'live',
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        commit: { message: 'ok' },
      }]),
    }));

    await pollRender();

    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      services: expect.arrayContaining([
        expect.objectContaining({ name: 'agent-api', status: 'live' }),
        expect.objectContaining({ name: 'scheduler', status: 'live' }),
      ]),
    }));
  });

  it('alerts on build failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        id: 'dep-456',
        status: 'build_failed',
        createdAt: new Date().toISOString(),
        finishedAt: null,
        commit: null,
      }]),
    }));

    await pollRender();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Render', expect.stringContaining('build_failed'));
    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      status: 'degraded',
    }));
  });

  it('alerts on update failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        id: 'dep-789',
        status: 'update_failed',
        createdAt: new Date().toISOString(),
        finishedAt: null,
        commit: null,
      }]),
    }));

    await pollRender();

    expect(alertPlatformIssue).toHaveBeenCalledWith('Render', expect.stringContaining('update_failed'));
    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      status: 'degraded',
    }));
  });

  it('skips when RENDER_API_KEY is missing', async () => {
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'RENDER_API_KEY') return '';
      if (key === 'RENDER_SERVICE_IDS') return 'agent-api:srv-123';
      return '';
    });

    await pollRender();

    expect(recordHealth).not.toHaveBeenCalled();
  });

  it('skips when RENDER_SERVICE_IDS is missing', async () => {
    vi.mocked(optionalEnv).mockImplementation((key: string) => {
      if (key === 'RENDER_API_KEY') return 'fake-key';
      if (key === 'RENDER_SERVICE_IDS') return '';
      return '';
    });

    await pollRender();

    expect(recordHealth).not.toHaveBeenCalled();
  });

  it('handles API error for individual service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    await pollRender();

    // Should still record health even on API errors
    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      services: expect.arrayContaining([
        expect.objectContaining({ name: 'agent-api', status: 'unknown' }),
      ]),
    }));
  });

  it('handles fetch exception gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    // Should not throw
    await pollRender();

    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      services: expect.arrayContaining([
        expect.objectContaining({ status: 'error' }),
      ]),
    }));
  });

  it('handles empty deploys array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    await pollRender();

    expect(recordHealth).toHaveBeenCalledWith('render', expect.objectContaining({
      status: 'healthy',
      services: expect.arrayContaining([
        expect.objectContaining({ status: 'no_deploys' }),
      ]),
    }));
  });
});
