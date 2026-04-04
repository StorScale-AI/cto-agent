import { requireEnv, optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { insertIncident, updateIncidentResolved, loadState, saveState } from '../lib/supabase.js';
import { dispatchAutoFix } from '../dispatch.js';
import { alertEscalation, sendAlert } from '../slack.js';
import { recordHealth } from '../health-api.js';

// Track which run IDs we've already seen to avoid duplicate dispatches
const seenRuns = new Set<number>();
const MAX_SEEN = 1000;
const PERSIST_SEEN_MAX = 500;

function pruneSeenRuns() {
  if (seenRuns.size > MAX_SEEN) {
    const arr = Array.from(seenRuns);
    arr.slice(0, arr.length - MAX_SEEN / 2).forEach(id => seenRuns.delete(id));
  }
}

// Pending fix verifications: repo -> { runId, dispatchedAt }
const pendingVerifications = new Map<string, { runId: number; dispatchedAt: number }>();
const VERIFICATION_WINDOW = 30 * 60 * 1000; // 30 min to verify fix

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  head_branch: string;
  head_commit: { message: string; author: { name: string } };
  html_url: string;
  created_at: string;
}

/**
 * Load seenRuns from Supabase on startup. Gracefully no-ops if unavailable.
 */
export async function loadSeenRuns(): Promise<void> {
  try {
    const data = await loadState('seen_runs');
    if (Array.isArray(data)) {
      for (const id of data) {
        if (typeof id === 'number') seenRuns.add(id);
      }
      log('info', `Loaded ${seenRuns.size} seen runs from Supabase`);
    }
  } catch (e) {
    log('warn', `Failed to load seen runs: ${e}`);
  }
}

/**
 * Persist seenRuns to Supabase. Keeps the most recent entries.
 */
async function persistSeenRuns(): Promise<void> {
  try {
    const arr = Array.from(seenRuns);
    const toSave = arr.slice(Math.max(0, arr.length - PERSIST_SEEN_MAX));
    await saveState('seen_runs', toSave);
  } catch (e) {
    log('warn', `Failed to persist seen runs: ${e}`);
  }
}

/**
 * Attempt to revert the last CTO-fix commit by creating a revert via GitHub API.
 */
async function revertLastFix(repo: string, commitMessage: string | undefined): Promise<void> {
  const token = optionalEnv('GITHUB_PAT');
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // Get the latest commit on main
    const refRes = await fetch(
      `https://api.github.com/repos/${repo}/git/ref/heads/main`,
      { headers }
    );
    if (!refRes.ok) {
      log('error', `Failed to get main ref for revert in ${repo}: ${refRes.status}`);
      return;
    }
    const refData = await refRes.json() as { object: { sha: string } };
    const headSha = refData.object.sha;

    // Get the commit to find its parent
    const commitRes = await fetch(
      `https://api.github.com/repos/${repo}/git/commits/${headSha}`,
      { headers }
    );
    if (!commitRes.ok) {
      log('error', `Failed to get commit for revert in ${repo}: ${commitRes.status}`);
      return;
    }
    const commitData = await commitRes.json() as { parents: Array<{ sha: string }>; tree: { sha: string } };
    if (!commitData.parents || commitData.parents.length === 0) {
      log('error', `No parent commit found for revert in ${repo}`);
      return;
    }

    const parentSha = commitData.parents[0].sha;

    // Get the parent's tree
    const parentCommitRes = await fetch(
      `https://api.github.com/repos/${repo}/git/commits/${parentSha}`,
      { headers }
    );
    if (!parentCommitRes.ok) return;
    const parentCommitData = await parentCommitRes.json() as { tree: { sha: string } };

    // Create a new commit that reverts to the parent's tree
    const newCommitRes = await fetch(
      `https://api.github.com/repos/${repo}/git/commits`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[cto-revert] Revert failed auto-fix\n\nReverts: ${headSha.slice(0, 7)}\nOriginal: ${commitMessage || 'unknown'}`,
          tree: parentCommitData.tree.sha,
          parents: [headSha],
        }),
      }
    );
    if (!newCommitRes.ok) {
      log('error', `Failed to create revert commit in ${repo}: ${newCommitRes.status}`);
      return;
    }
    const newCommit = await newCommitRes.json() as { sha: string };

    // Update main to point to the revert commit
    const updateRes = await fetch(
      `https://api.github.com/repos/${repo}/git/refs/heads/main`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha }),
      }
    );
    if (updateRes.ok) {
      log('info', `Reverted failed fix in ${repo}: ${newCommit.sha.slice(0, 7)}`);
      await sendAlert({
        severity: 'danger',
        title: 'CTO Agent: Auto-Fix Reverted',
        message: `Auto-fix for *${repo}* failed CI — commit has been reverted.\nManual intervention required.`,
      });
    } else {
      log('error', `Failed to update ref for revert in ${repo}: ${updateRes.status}`);
    }
  } catch (e) {
    log('error', `Revert failed for ${repo}: ${e}`);
    await alertEscalation(repo, `Auto-revert failed: ${e}`);
  }
}

/**
 * Check pending fix verifications — did the CI go green after our fix?
 */
async function checkVerifications(headers: Record<string, string>): Promise<void> {
  for (const [repo, pending] of pendingVerifications) {
    // Expire old verifications
    if (Date.now() - pending.dispatchedAt > VERIFICATION_WINDOW) {
      log('warn', `Verification window expired for ${repo} — no conclusive result`);
      pendingVerifications.delete(repo);
      continue;
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=3&status=completed`,
        { headers }
      );
      if (!res.ok) continue;

      const data = await res.json() as { workflow_runs: WorkflowRun[] };
      const latestRun = data.workflow_runs?.[0];
      if (!latestRun || latestRun.id === pending.runId) continue;

      if (latestRun.conclusion === 'success') {
        log('info', `Fix verified for ${repo} — CI is green`);
        pendingVerifications.delete(repo);
        updateIncidentResolved(repo, pending.runId).catch(err =>
          log('warn', `Failed to update resolved_at: ${err}`)
        );
      } else if (
        latestRun.conclusion === 'failure' &&
        latestRun.head_commit?.message?.includes('[cto-fix]')
      ) {
        // T3.20: Fix itself failed — revert and escalate
        log('warn', `Fix failed for ${repo} — reverting`);
        pendingVerifications.delete(repo);
        await revertLastFix(repo, latestRun.head_commit?.message);
      }
    } catch (e) {
      log('warn', `Verification check failed for ${repo}: ${e}`);
    }
  }
}

/**
 * Poll GitHub CI status across all discovered repos.
 * For each repo, check the latest workflow runs on main.
 * If a failure is found that hasn't been seen, dispatch auto-fix.
 */
export async function pollGitHub(repos: string[]): Promise<void> {
  const token = requireEnv('GITHUB_PAT');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Check pending fix verifications before main loop
  await checkVerifications(headers);

  let healthyCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  for (const repo of repos) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=3&status=completed`,
        { headers }
      );

      if (!res.ok) {
        if (res.status === 404) continue; // Repo has no workflows
        log('warn', `GitHub API error for ${repo}: ${res.status}`);
        continue;
      }

      const data: { workflow_runs: WorkflowRun[] } = await res.json() as { workflow_runs: WorkflowRun[] };
      const runs = data.workflow_runs || [];

      if (runs.length === 0) continue;

      const latestRun = runs[0];

      if (latestRun.conclusion === 'failure' && !seenRuns.has(latestRun.id)) {
        seenRuns.add(latestRun.id);
        failedCount++;
        failures.push(repo);

        const detectedAt = new Date().toISOString();

        // Skip if it's a CTO agent fix attempt
        if (latestRun.head_commit?.message?.includes('[cto-fix]')) {
          log('warn', `Skipping ${repo} — last commit was a CTO fix attempt`);
          await alertEscalation(repo, 'CTO auto-fix failed — manual intervention needed', latestRun.html_url);

          // Fire-and-forget incident persistence
          insertIncident({
            repo,
            run_id: latestRun.id,
            failure_type: 'ci_failure',
            pattern_matched: 'cto-fix-retry',
            fix_applied: false,
            escalated: true,
            escalation_reason: 'CTO auto-fix failed — manual intervention needed',
            detected_at: detectedAt,
          }).catch((err) => log('warn', `Supabase incident insert failed: ${err}`));

          continue;
        }

        log('info', `CI failure detected: ${repo} run ${latestRun.id}`);
        const dispatched = await dispatchAutoFix(repo, latestRun.id, latestRun.name);
        if (!dispatched) {
          await alertEscalation(repo, 'Could not dispatch auto-fix (rate limited or API error)', latestRun.html_url);
        } else {
          // Track for verification on next poll cycle
          pendingVerifications.set(repo, { runId: latestRun.id, dispatchedAt: Date.now() });
        }

        // Fire-and-forget incident persistence
        insertIncident({
          repo,
          run_id: latestRun.id,
          failure_type: 'ci_failure',
          fix_applied: dispatched ?? false,
          escalated: !dispatched,
          escalation_reason: dispatched ? undefined : 'Could not dispatch auto-fix',
          detected_at: detectedAt,
        }).catch((err) => log('warn', `Supabase incident insert failed: ${err}`));
      } else if (latestRun.conclusion === 'success') {
        healthyCount++;
      }
    } catch (e) {
      log('error', `Error polling ${repo}: ${e}`);
    }
  }

  pruneSeenRuns();

  // Persist seenRuns to Supabase (fire-and-forget)
  persistSeenRuns().catch(e => log('warn', `Failed to persist seen runs: ${e}`));

  recordHealth('github', {
    status: failedCount === 0 ? 'healthy' : 'degraded',
    repos_checked: repos.length,
    healthy: healthyCount,
    failed: failedCount,
    failures,
    pending_verifications: pendingVerifications.size,
    checked_at: new Date().toISOString(),
  });
}
