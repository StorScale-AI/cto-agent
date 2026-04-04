import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

export async function pollAirtable(): Promise<void> {
  const pat = optionalEnv('AIRTABLE_PAT');
  if (!pat) {
    log('debug', 'Airtable poller skipped — no AIRTABLE_PAT');
    return;
  }

  const baseId = optionalEnv('AIRTABLE_BASE_ID') || 'app3Yjzwew9y3HlHL';

  try {
    const start = Date.now();
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/Table%201?maxRecords=1&fields%5B%5D=Name`,
      {
        headers: { Authorization: `Bearer ${pat}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const latencyMs = Date.now() - start;

    if (res.ok) {
      recordHealth('airtable', {
        status: 'healthy',
        base_id: baseId,
        latency_ms: latencyMs,
        checked_at: new Date().toISOString(),
      });
    } else {
      const status = res.status === 401 || res.status === 403 ? 'error' : 'degraded';
      await alertPlatformIssue('Airtable', `API returned ${res.status} for base ${baseId}`);
      recordHealth('airtable', {
        status,
        base_id: baseId,
        http_status: res.status,
        checked_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    await alertPlatformIssue('Airtable', `API unreachable: ${e}`);
    recordHealth('airtable', {
      status: 'error',
      error: String(e),
      checked_at: new Date().toISOString(),
    });
  }
}
