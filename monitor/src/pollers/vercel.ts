import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

export async function pollVercel(): Promise<void> {
  const token = optionalEnv('VERCEL_API_TOKEN');
  if (!token) {
    log('debug', 'Vercel poller skipped — no VERCEL_API_TOKEN');
    return;
  }

  const teamId = optionalEnv('VERCEL_TEAM_ID');

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  try {
    // List recent deployments — no state filter (comma-separated not supported by Vercel API)
    const url = new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('limit', '5');
    if (teamId) {
      url.searchParams.set('teamId', teamId);
    }

    const res = await fetch(url.toString(), { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log('warn', `Vercel API error: ${res.status} ${body.substring(0, 100)}. Note: vcp_ project tokens cannot list all deployments — use a personal token from vercel.com/account/tokens`);
      recordHealth('vercel', { status: 'error', error: `API ${res.status}`, checked_at: new Date().toISOString() });
      return;
    }

    const data = await res.json() as { deployments?: Array<{ state: string; name?: string; url?: string }> };
    const deployments = data.deployments || [];

    const errors = deployments.filter((d: { state: string }) => d.state === 'ERROR');
    const ready = deployments.filter((d: { state: string }) => d.state === 'READY');

    if (errors.length > 0) {
      const latest = errors[0];
      await alertPlatformIssue('Vercel',
        `Deploy error: *${latest.name || 'unknown'}* (${latest.url || 'no URL'})`
      );
    }

    recordHealth('vercel', {
      status: errors.length > 0 ? 'degraded' : 'healthy',
      recent_deploys: deployments.length,
      errors: errors.length,
      ready: ready.length,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    log('error', `Vercel poller error: ${e}`);
    recordHealth('vercel', { status: 'error', error: String(e), checked_at: new Date().toISOString() });
  }
}
