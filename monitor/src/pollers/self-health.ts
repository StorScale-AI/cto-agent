import { optionalEnv } from '../lib/env.js';
import { log } from '../lib/logger.js';
import { alertPlatformIssue } from '../slack.js';
import { recordHealth } from '../health-api.js';

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  html_url: string;
  created_at: string;
  repository: { full_name: string };
}

interface CallerFile {
  content: string;
  sha: string;
}

/**
 * Self-monitoring poller: the CTO agent watches itself.
 *
 * 1. Checks auto-fix workflow success/failure rates across all repos
 * 2. Detects startup_failure (stale caller template, missing secrets)
 * 3. Compares deployed callers against current template for drift
 * 4. Alerts on repeated failures that indicate systemic issues
 */
export async function pollSelfHealth(repos: string[]): Promise<void> {
  const token = optionalEnv('GITHUB_PAT');
  if (!token) {
    log('debug', 'Self-health poller skipped — no GITHUB_PAT');
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const issues: string[] = [];
  const repoStatus: Record<string, { status: string; lastRun?: string; issue?: string }> = {};
  let totalRuns = 0;
  let successRuns = 0;
  let failedRuns = 0;
  let startupFailures = 0;

  // 1. Check CTO Auto-Fix runs across all repos
  for (const repo of repos) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/cto-auto-fix.yml/runs?per_page=5&status=completed`,
        { headers }
      );

      if (!res.ok) {
        // No auto-fix workflow in this repo — that's fine
        repoStatus[repo] = { status: 'no_caller' };
        continue;
      }

      const data = await res.json() as { workflow_runs: WorkflowRun[] };
      const runs = data.workflow_runs || [];

      if (runs.length === 0) {
        repoStatus[repo] = { status: 'no_runs' };
        continue;
      }

      totalRuns += runs.length;

      // Check the latest run
      const latest = runs[0];

      if (latest.conclusion === 'success') {
        successRuns++;
        repoStatus[repo] = { status: 'healthy', lastRun: latest.created_at };
      } else if (latest.conclusion === 'startup_failure') {
        startupFailures++;
        repoStatus[repo] = {
          status: 'startup_failure',
          lastRun: latest.created_at,
          issue: 'Caller workflow failed to start — likely stale template or missing secrets',
        };
        issues.push(`${repo}: startup_failure — caller template may be stale or missing permissions/secrets`);
      } else if (latest.conclusion === 'failure') {
        failedRuns++;
        repoStatus[repo] = {
          status: 'fix_failed',
          lastRun: latest.created_at,
          issue: 'Auto-fix attempted but failed',
        };

        // Check if multiple consecutive failures — systemic issue
        const consecutiveFailures = runs.filter(r => r.conclusion !== 'success').length;
        if (consecutiveFailures >= 3) {
          issues.push(`${repo}: ${consecutiveFailures} consecutive auto-fix failures — needs manual investigation`);
        }
      }
    } catch (e) {
      log('warn', `Self-health check failed for ${repo}: ${e}`);
    }
  }

  // 2. Check caller template drift
  let templateDrift: string[] = [];
  try {
    // Get current template from cto-agent repo
    const templateRes = await fetch(
      'https://api.github.com/repos/StorScale-AI/cto-agent/contents/caller-template/cto-auto-fix.yml',
      { headers }
    );
    if (templateRes.ok) {
      const templateFile = await templateRes.json() as CallerFile;
      const templateContent = atob(templateFile.content.replace(/\n/g, ''));

      // Check each repo's deployed caller against the template
      for (const repo of repos) {
        try {
          const callerRes = await fetch(
            `https://api.github.com/repos/${repo}/contents/.github/workflows/cto-auto-fix.yml`,
            { headers }
          );
          if (!callerRes.ok) continue;

          const callerFile = await callerRes.json() as CallerFile;
          const callerContent = atob(callerFile.content.replace(/\n/g, ''));

          if (callerContent !== templateContent) {
            templateDrift.push(repo);
          }
        } catch {
          // skip
        }
      }
    }
  } catch (e) {
    log('warn', `Template drift check failed: ${e}`);
  }

  if (templateDrift.length > 0) {
    issues.push(`Template drift detected in ${templateDrift.length} repo(s): ${templateDrift.join(', ')}`);
  }

  // 3. Alert on issues
  if (issues.length > 0) {
    await alertPlatformIssue('CTO Self-Health',
      `${issues.length} issue(s) detected:\n${issues.map(i => `• ${i}`).join('\n')}`
    );
  }

  // 4. Record health
  const overallStatus = startupFailures > 0 || issues.length > 0
    ? 'degraded'
    : failedRuns > 0
      ? 'warning'
      : 'healthy';

  recordHealth('cto-self', {
    status: overallStatus,
    total_runs_checked: totalRuns,
    success: successRuns,
    failed: failedRuns,
    startup_failures: startupFailures,
    template_drift: templateDrift,
    issues,
    repos: repoStatus,
    checked_at: new Date().toISOString(),
  });
}
