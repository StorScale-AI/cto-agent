import { Hono } from 'hono';
import { insertHealthSnapshot } from './lib/supabase.js';
import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';

type HealthStatus = 'healthy' | 'degraded' | 'warning' | 'error' | 'unknown';

interface HealthRecord {
  platform: string;
  status: HealthStatus;
  details: Record<string, unknown>;
  checked_at: string;
}

// In-memory health state (most recent snapshot per platform)
const healthState = new Map<string, HealthRecord>();

/**
 * Record a health check result. Called by each poller.
 */
export function recordHealth(platform: string, data: Record<string, unknown>) {
  const status = (data.status as HealthStatus) || 'unknown';
  const checkedAt = (data.checked_at as string) || new Date().toISOString();

  healthState.set(platform, {
    platform,
    status,
    details: data,
    checked_at: checkedAt,
  });

  // Fire-and-forget persistence to Supabase
  insertHealthSnapshot(platform, status, data, checkedAt).catch((err) =>
    log('warn', `Supabase health snapshot insert failed: ${err}`)
  );
}

/**
 * Get current health state for a platform.
 */
export function getHealth(platform: string): HealthRecord | undefined {
  return healthState.get(platform);
}

/**
 * Get all health records.
 */
export function getAllHealth(): HealthRecord[] {
  return Array.from(healthState.values());
}

// REST API routes (mounted at /api)
export const healthRoutes = new Hono();

// Bearer token auth middleware — protects all /api/* routes
healthRoutes.use('*', async (c, next) => {
  const expectedToken = optionalEnv('CTO_API_KEY');

  // If CTO_API_KEY is not set, skip auth (open access for development)
  if (!expectedToken) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

// GET /api/health/summary — all platforms at a glance
healthRoutes.get('/health/summary', (c) => {
  const records = getAllHealth();
  const overallStatus = records.some(r => r.status === 'error')
    ? 'error'
    : records.some(r => r.status === 'degraded')
      ? 'degraded'
      : records.some(r => r.status === 'warning')
        ? 'warning'
        : 'healthy';

  return c.json({
    status: overallStatus,
    platforms: records.map(r => ({
      platform: r.platform,
      status: r.status,
      checked_at: r.checked_at,
    })),
    checked_at: new Date().toISOString(),
  });
});

// GET /api/health/:platform — detailed health for one platform
healthRoutes.get('/health/:platform', (c) => {
  const platform = c.req.param('platform');
  const record = getHealth(platform);
  if (!record) {
    return c.json({ error: `No health data for platform: ${platform}` }, 404);
  }
  return c.json(record);
});

// GET /api/health/platforms — list all monitored platforms
healthRoutes.get('/health/platforms', (c) => {
  return c.json({
    platforms: [
      'github', 'render', 'stripe', 'supabase',
      'vercel', 'cloudflare', 'agents', 'domains', 'cto-self',
      'airtable', 'attio', 'liveness',
    ],
  });
});

// GET /api/health/history/:platform?hours=24 — historical snapshots for sparklines
healthRoutes.get('/health/history/:platform', async (c) => {
  const platform = c.req.param('platform');
  const hours = parseInt(c.req.query('hours') || '24', 10);
  const { optionalEnv } = await import('./lib/env.js');

  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return c.json({ error: 'Supabase not configured' }, 503);
  }

  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const res = await fetch(
    `${url}/rest/v1/cto_agent_health_snapshots?platform=eq.${platform}&checked_at=gte.${since}&order=checked_at.asc&select=status,checked_at`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  );

  if (!res.ok) {
    return c.json({ error: `Query failed: ${res.status}` }, 500);
  }

  const snapshots = await res.json() as Array<{ status: string; checked_at: string }>;

  // Map status to numeric for sparkline: healthy=1, warning=0.5, degraded=0.25, error=0
  const statusValue: Record<string, number> = { healthy: 1, warning: 0.5, degraded: 0.25, error: 0 };
  const points = snapshots.map(s => ({
    time: s.checked_at,
    value: statusValue[s.status] ?? 0,
    status: s.status,
  }));

  return c.json({ platform, hours, points });
});

// GET /api/health/agent30-compat — returns data in Agent 30's expected format
healthRoutes.get('/health/agent30-compat', (c) => {
  const github = getHealth('github');
  const render = getHealth('render');
  const vercel = getHealth('vercel');
  const cloudflare = getHealth('cloudflare');

  return c.json({
    github: { status: github?.status || 'unknown', details: github?.details || {} },
    render: { status: render?.status || 'unknown', details: render?.details || {} },
    vercel: { status: vercel?.status || 'unknown', details: vercel?.details || {} },
    cloudflare: { status: cloudflare?.status || 'unknown', details: cloudflare?.details || {} },
    source: 'cto-agent-monitor',
    checked_at: new Date().toISOString(),
  });
});
