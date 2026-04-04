import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing
vi.mock('../../monitor/src/lib/env.js', () => ({
  requireEnv: vi.fn(() => 'fake-token'),
  optionalEnv: vi.fn(() => 'fake-token'),
}));

vi.mock('../../monitor/src/lib/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../monitor/src/lib/supabase.js', () => ({
  insertIncident: vi.fn(() => Promise.resolve()),
  updateIncidentResolved: vi.fn(() => Promise.resolve()),
  loadState: vi.fn(() => Promise.resolve(null)),
  saveState: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../monitor/src/slack.js', () => ({
  alertEscalation: vi.fn(() => Promise.resolve(true)),
  alertPlatformIssue: vi.fn(() => Promise.resolve(true)),
  sendAlert: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../monitor/src/health-api.js', () => ({
  recordHealth: vi.fn(),
}));

vi.mock('../../monitor/src/dispatch.js', () => ({
  dispatchAutoFix: vi.fn(() => Promise.resolve(true)),
}));

import { pollGitHub } from '../../monitor/src/pollers/github.js';
import { recordHealth } from '../../monitor/src/health-api.js';
import { dispatchAutoFix } from '../../monitor/src/dispatch.js';
import { alertEscalation } from '../../monitor/src/slack.js';
import { insertIncident } from '../../monitor/src/lib/supabase.js';

describe('GitHub poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('records healthy when all repos pass CI', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 1001,
          name: 'CI',
          conclusion: 'success',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: 'test', author: { name: 'dev' } },
          html_url: 'https://github.com/test/repo/actions/runs/1001',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(recordHealth).toHaveBeenCalledWith('github', expect.objectContaining({
      status: 'healthy',
      repos_checked: 1,
      healthy: 1,
      failed: 0,
    }));
  });

  it('dispatches auto-fix on CI failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 2001,
          name: 'CI',
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: 'broke something', author: { name: 'dev' } },
          html_url: 'https://github.com/test/repo/actions/runs/2001',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(dispatchAutoFix).toHaveBeenCalledWith('test/repo', 2001, 'CI');
  });

  it('persists incident to Supabase on failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 2002,
          name: 'CI',
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: 'oops', author: { name: 'dev' } },
          html_url: 'https://github.com/test/repo/actions/runs/2002',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(insertIncident).toHaveBeenCalledWith(expect.objectContaining({
      repo: 'test/repo',
      run_id: 2002,
      failure_type: 'ci_failure',
      fix_applied: true,
    }));
  });

  it('skips CTO fix attempts to prevent loops', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 3001,
          name: 'CI',
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: '[cto-fix] Auto-fix CI', author: { name: 'CTO Agent' } },
          html_url: 'https://github.com/test/repo/actions/runs/3001',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(dispatchAutoFix).not.toHaveBeenCalled();
    expect(alertEscalation).toHaveBeenCalledWith(
      'test/repo',
      'CTO auto-fix failed — manual intervention needed',
      expect.any(String),
    );
  });

  it('records escalated incident when CTO fix fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 3002,
          name: 'CI',
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: '[cto-fix] retry', author: { name: 'CTO Agent' } },
          html_url: 'https://github.com/test/repo/actions/runs/3002',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(insertIncident).toHaveBeenCalledWith(expect.objectContaining({
      repo: 'test/repo',
      run_id: 3002,
      escalated: true,
      pattern_matched: 'cto-fix-retry',
    }));
  });

  it('handles 404 repos gracefully (no workflows)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/no-workflows']);

    expect(recordHealth).toHaveBeenCalledWith('github', expect.objectContaining({
      status: 'healthy',
      failed: 0,
    }));
  });

  it('handles empty workflow runs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workflow_runs: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/empty']);

    expect(recordHealth).toHaveBeenCalledWith('github', expect.objectContaining({
      status: 'healthy',
      repos_checked: 1,
      healthy: 0,
      failed: 0,
    }));
  });

  it('handles fetch exceptions gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
    vi.stubGlobal('fetch', mockFetch);

    // Should not throw
    await pollGitHub(['test/repo']);

    expect(recordHealth).toHaveBeenCalledWith('github', expect.objectContaining({
      status: 'healthy',
      failed: 0,
    }));
  });

  it('deduplicates seen run IDs across calls', async () => {
    const run = {
      id: 4001,
      name: 'CI',
      conclusion: 'failure',
      status: 'completed',
      head_branch: 'main',
      head_commit: { message: 'fail', author: { name: 'dev' } },
      html_url: 'https://github.com/test/repo/actions/runs/4001',
      created_at: new Date().toISOString(),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workflow_runs: [run] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);

    // Second poll with same run ID should not dispatch again
    await pollGitHub(['test/repo']);

    expect(dispatchAutoFix).not.toHaveBeenCalled();
  });

  it('reports failures array in health data', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflow_runs: [{
          id: 5001,
          name: 'CI',
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'main',
          head_commit: { message: 'fail', author: { name: 'dev' } },
          html_url: 'https://github.com/test/repo/actions/runs/5001',
          created_at: new Date().toISOString(),
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await pollGitHub(['test/repo']);

    expect(recordHealth).toHaveBeenCalledWith('github', expect.objectContaining({
      status: 'degraded',
      failures: ['test/repo'],
    }));
  });
});
