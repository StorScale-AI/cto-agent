import { optionalEnv } from './lib/env.js';
import { log } from './lib/logger.js';
import { loadState, saveState } from './lib/supabase.js';
import { sendAlert } from './slack.js';

// Rate limiting: max dispatches per repo per hour
const dispatchLog = new Map<string, number[]>();
const MAX_DISPATCHES_PER_HOUR = 3;

// ---------- Circuit Breaker ----------
let circuitOpen = false;
let circuitOpenedAt = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5; // failures within window
const CIRCUIT_BREAKER_WINDOW = 15 * 60 * 1000; // 15 min
const CIRCUIT_BREAKER_COOLDOWN = 30 * 60 * 1000; // 30 min cooldown
const recentFailures: number[] = []; // timestamps of dispatch triggers

function checkCircuitBreaker(): boolean {
  const now = Date.now();

  // Auto-reset after cooldown
  if (circuitOpen && now - circuitOpenedAt > CIRCUIT_BREAKER_COOLDOWN) {
    circuitOpen = false;
    log('info', 'Circuit breaker reset — resuming dispatches');
    return false;
  }

  if (circuitOpen) return true;

  // Clean old entries outside the window
  while (recentFailures.length > 0 && recentFailures[0] < now - CIRCUIT_BREAKER_WINDOW) {
    recentFailures.shift();
  }

  if (recentFailures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpen = true;
    circuitOpenedAt = now;
    log('error', `Circuit breaker OPEN — ${recentFailures.length} failures in ${CIRCUIT_BREAKER_WINDOW / 60000}min`);
    sendAlert({
      severity: 'danger',
      title: 'CTO Agent: Circuit Breaker OPEN',
      message: `${recentFailures.length} repos failed CI in ${CIRCUIT_BREAKER_WINDOW / 60000} minutes. All auto-fix dispatches halted for ${CIRCUIT_BREAKER_COOLDOWN / 60000} minutes.\n\nThis may indicate a systemic issue (dependency update, shared config change). Manual investigation required.`,
    }).catch(() => {});
    return true;
  }

  return false;
}

// ---------- Cross-Repo Failure Correlation ----------
const recentDispatchRepos: Array<{ repo: string; time: number }> = [];
const CORRELATION_WINDOW = 10 * 60 * 1000; // 10 min

function checkCorrelation(repo: string): string | null {
  const now = Date.now();
  const cutoff = now - CORRELATION_WINDOW;

  // Prune old entries
  while (recentDispatchRepos.length > 0 && recentDispatchRepos[0].time < cutoff) {
    recentDispatchRepos.shift();
  }

  recentDispatchRepos.push({ repo, time: now });

  const uniqueRepos = [...new Set(recentDispatchRepos.map(r => r.repo))];
  if (uniqueRepos.length >= 2) {
    return `Correlated failures detected: ${uniqueRepos.join(', ')} failed within 10 min`;
  }
  return null;
}

// ---------- Rate Limiting ----------
function isRateLimited(repo: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const repoLog = (dispatchLog.get(repo) || []).filter(t => t > oneHourAgo);
  dispatchLog.set(repo, repoLog);
  return repoLog.length >= MAX_DISPATCHES_PER_HOUR;
}

function recordDispatch(repo: string) {
  const repoLog = dispatchLog.get(repo) || [];
  repoLog.push(Date.now());
  dispatchLog.set(repo, repoLog);
}

// ---------- Persistence ----------

/**
 * Persist dispatch rate-limit log to Supabase.
 */
async function persistDispatchLog(): Promise<void> {
  try {
    const entries: Record<string, number[]> = {};
    for (const [repo, timestamps] of dispatchLog) {
      entries[repo] = timestamps;
    }
    await saveState('dispatch_log', entries);
  } catch (e) {
    log('warn', `Failed to persist dispatch log: ${e}`);
  }
}

/**
 * Load dispatch state from Supabase on startup.
 */
export async function loadDispatchState(): Promise<void> {
  try {
    const data = await loadState('dispatch_log');
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      for (const [repo, timestamps] of Object.entries(data as Record<string, number[]>)) {
        if (!Array.isArray(timestamps)) continue;
        const recent = timestamps.filter(t => typeof t === 'number' && t > oneHourAgo);
        if (recent.length > 0) dispatchLog.set(repo, recent);
      }
      log('info', `Loaded dispatch state: ${dispatchLog.size} repos`);
    }
  } catch (e) {
    log('warn', `Failed to load dispatch state: ${e}`);
  }
}

// ---------- Dispatch ----------

/**
 * Trigger the CTO auto-fix workflow via GitHub API workflow_dispatch.
 */
export async function dispatchAutoFix(repo: string, runId: number, workflowName: string): Promise<boolean> {
  // Track failure for circuit breaker
  recentFailures.push(Date.now());

  // Check circuit breaker
  if (checkCircuitBreaker()) {
    log('warn', `Circuit breaker open — dispatch blocked for ${repo}`);
    return false;
  }

  // Check cross-repo correlation
  const correlation = checkCorrelation(repo);
  if (correlation) {
    log('warn', correlation);
    sendAlert({
      severity: 'warning',
      title: 'CTO Agent: Correlated Failures',
      message: correlation + '\n\nThis may indicate a shared dependency or infrastructure issue.',
    }).catch(() => {});
  }

  if (isRateLimited(repo)) {
    log('warn', `Rate limited: ${repo} has reached ${MAX_DISPATCHES_PER_HOUR} dispatches/hour`);
    return false;
  }

  const token = optionalEnv('GITHUB_PAT');
  if (!token) {
    log('warn', 'GITHUB_PAT not set — cannot dispatch auto-fix');
    return false;
  }

  try {
    const res = await fetch(
      'https://api.github.com/repos/StorScale-AI/cto-agent/actions/workflows/auto-fix.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            repo,
            run_id: String(runId),
            workflow_name: workflowName,
          },
        }),
      }
    );

    if (res.status === 204) {
      recordDispatch(repo);
      // Persist dispatch log to Supabase (fire-and-forget)
      persistDispatchLog().catch(e => log('warn', `Failed to persist dispatch log: ${e}`));
      log('info', `Dispatched auto-fix for ${repo} run ${runId}`);
      return true;
    }

    log('error', `Failed to dispatch auto-fix: ${res.status} ${await res.text()}`);
    return false;
  } catch (e) {
    log('error', `Dispatch error for ${repo}: ${e}`);
    return false;
  }
}
