import { optionalEnv } from './env.js';
import { log } from './logger.js';

const SUPABASE_URL = () => optionalEnv('SUPABASE_URL');
const SUPABASE_KEY = () => optionalEnv('SUPABASE_SERVICE_ROLE_KEY');

function isConfigured(): boolean {
  return !!(SUPABASE_URL() && SUPABASE_KEY());
}

async function supabaseInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const url = SUPABASE_URL();
  const key = SUPABASE_KEY();

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert to ${table} failed (${res.status}): ${body}`);
  }
}

/**
 * Persist a health snapshot to Supabase. No-op if credentials are missing.
 */
export async function insertHealthSnapshot(
  platform: string,
  status: string,
  details: Record<string, unknown>,
  checkedAt: string,
): Promise<void> {
  if (!isConfigured()) return;

  await supabaseInsert('cto_agent_health_snapshots', {
    platform,
    status,
    details,
    checked_at: checkedAt,
  });
}

/**
 * Update an incident's resolved_at timestamp. No-op if credentials are missing.
 */
export async function updateIncidentResolved(repo: string, runId: number): Promise<void> {
  if (!isConfigured()) return;
  const url = SUPABASE_URL();
  const key = SUPABASE_KEY();

  const res = await fetch(
    `${url}/rest/v1/cto_agent_incidents?repo=eq.${encodeURIComponent(repo)}&run_id=eq.${runId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ resolved_at: new Date().toISOString() }),
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase update failed (${res.status}): ${await res.text()}`);
  }
}

/**
 * Load a key-value state entry. Returns null if not found or not configured.
 */
export async function loadState(key: string): Promise<unknown | null> {
  if (!isConfigured()) return null;
  const url = SUPABASE_URL();
  const k = SUPABASE_KEY();

  try {
    const res = await fetch(
      `${url}/rest/v1/cto_agent_state?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: { apikey: k, Authorization: `Bearer ${k}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ value: unknown }>;
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

/**
 * Upsert a key-value state entry. No-op if not configured.
 */
export async function saveState(key: string, value: unknown): Promise<void> {
  if (!isConfigured()) return;
  const url = SUPABASE_URL();
  const k = SUPABASE_KEY();

  try {
    await fetch(`${url}/rest/v1/cto_agent_state`, {
      method: 'POST',
      headers: {
        apikey: k,
        Authorization: `Bearer ${k}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    log('warn', `Failed to save state ${key}: ${e}`);
  }
}

/**
 * Persist an incident record to Supabase. No-op if credentials are missing.
 */
export async function insertIncident(incident: {
  repo: string;
  run_id: number;
  failure_type: string;
  pattern_matched?: string;
  fix_applied?: boolean;
  fix_commit_sha?: string;
  diff_summary?: Record<string, unknown>;
  escalated?: boolean;
  escalation_reason?: string;
  detected_at: string;
  resolved_at?: string;
}): Promise<void> {
  if (!isConfigured()) return;

  await supabaseInsert('cto_agent_incidents', incident);
}
