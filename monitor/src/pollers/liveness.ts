import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

const DEFAULT_ENDPOINTS = [
  { name: 'agent-api', url: 'https://storscale-agents-api.onrender.com/health' },
  { name: 'dashboard-api', url: 'https://storops-dashboard-api.storscale.workers.dev/health' },
];

function getEndpoints(): Array<{ name: string; url: string }> {
  const custom = optionalEnv('LIVENESS_ENDPOINTS');
  if (custom) {
    return custom.split(',').map(pair => {
      const [name, ...urlParts] = pair.split(':');
      return { name: name.trim(), url: urlParts.join(':').trim() };
    }).filter(e => e.name && e.url);
  }
  return DEFAULT_ENDPOINTS;
}

export async function pollLiveness(): Promise<void> {
  const endpoints = getEndpoints();
  if (endpoints.length === 0) {
    log('debug', 'Liveness poller skipped — no endpoints configured');
    return;
  }

  const results: Array<{ name: string; status: string; latencyMs?: number; error?: string }> = [];

  const checks = endpoints.map(async (ep) => {
    try {
      const start = Date.now();
      const res = await fetch(ep.url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'CTO-Agent-Monitor/1.0' },
      });
      const latencyMs = Date.now() - start;

      if (res.ok) {
        results.push({ name: ep.name, status: 'healthy', latencyMs });
      } else {
        results.push({ name: ep.name, status: `http_${res.status}` });
        await alertPlatformIssue('Liveness', `*${ep.name}* returned ${res.status}`);
      }
    } catch (e) {
      results.push({ name: ep.name, status: 'unreachable', error: String(e) });
      await alertPlatformIssue('Liveness', `*${ep.name}* is unreachable: ${e}`);
    }
  });

  await Promise.allSettled(checks);

  const unhealthy = results.filter(r => r.status !== 'healthy');

  recordHealth('liveness', {
    status: unhealthy.length === 0 ? 'healthy' : unhealthy.length === results.length ? 'error' : 'degraded',
    endpoints: results,
    checked_at: new Date().toISOString(),
  });
}
