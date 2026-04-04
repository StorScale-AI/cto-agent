import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

export async function pollAttio(): Promise<void> {
  const apiKey = optionalEnv('ATTIO_API_KEY');
  if (!apiKey) {
    log('debug', 'Attio poller skipped — no ATTIO_API_KEY');
    return;
  }

  try {
    const start = Date.now();
    const res = await fetch('https://api.attio.com/v2/self', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      const data = await res.json() as { workspace?: { name?: string } };
      recordHealth('attio', {
        status: 'healthy',
        workspace: data.workspace?.name || 'unknown',
        latency_ms: latencyMs,
        checked_at: new Date().toISOString(),
      });
    } else {
      const status = res.status === 401 || res.status === 403 ? 'error' : 'degraded';
      await alertPlatformIssue('Attio', `API returned ${res.status}`);
      recordHealth('attio', {
        status,
        http_status: res.status,
        checked_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    await alertPlatformIssue('Attio', `API unreachable: ${e}`);
    recordHealth('attio', {
      status: 'error',
      error: String(e),
      checked_at: new Date().toISOString(),
    });
  }
}
