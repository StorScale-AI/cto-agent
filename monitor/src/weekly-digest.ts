import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';
import { sendAlert } from './slack.js';

/**
 * Generate and send a weekly digest of CTO Agent activity.
 * Called on a weekly schedule from index.ts.
 */
export async function sendWeeklyDigest(): Promise<void> {
  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    log('debug', 'Weekly digest skipped — no Supabase credentials');
    return;
  }

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };

  try {
    // Fetch incidents from last week
    const incidentsRes = await fetch(
      `${url}/rest/v1/cto_agent_incidents?detected_at=gte.${oneWeekAgo}&order=detected_at.desc`,
      { headers }
    );

    const incidents = incidentsRes.ok
      ? (await incidentsRes.json() as Array<{
          repo: string;
          failure_type: string;
          pattern_matched: string | null;
          fix_applied: boolean;
          escalated: boolean;
          resolved_at: string | null;
        }>)
      : [];

    const totalIncidents = incidents.length;
    const fixApplied = incidents.filter(i => i.fix_applied).length;
    const escalated = incidents.filter(i => i.escalated).length;
    const resolved = incidents.filter(i => i.resolved_at).length;
    const patternMatched = incidents.filter(i => i.pattern_matched && i.pattern_matched !== 'claude-code').length;

    // Most common patterns
    const patternCounts = new Map<string, number>();
    for (const i of incidents) {
      const p = i.pattern_matched || 'unmatched';
      patternCounts.set(p, (patternCounts.get(p) || 0) + 1);
    }
    const topPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}: ${count}`)
      .join('\n');

    // Most affected repos
    const repoCounts = new Map<string, number>();
    for (const i of incidents) {
      repoCounts.set(i.repo, (repoCounts.get(i.repo) || 0) + 1);
    }
    const topRepos = [...repoCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}: ${count}`)
      .join('\n');

    const fixRate = totalIncidents > 0
      ? Math.round((fixApplied / totalIncidents) * 100)
      : 0;
    const resolveRate = totalIncidents > 0
      ? Math.round((resolved / totalIncidents) * 100)
      : 0;

    const message = [
      `*Weekly CTO Agent Digest*`,
      `_${oneWeekAgo.split('T')[0]} — ${new Date().toISOString().split('T')[0]}_`,
      ``,
      `*Summary*`,
      `• Total incidents: ${totalIncidents}`,
      `• Fixes applied: ${fixApplied} (${fixRate}%)`,
      `• Verified resolved: ${resolved} (${resolveRate}%)`,
      `• Escalated to human: ${escalated}`,
      `• Pattern-matched (fast path): ${patternMatched}`,
      ``,
      `*Top Patterns*`,
      topPatterns || '(none)',
      ``,
      `*Most Affected Repos*`,
      topRepos || '(none)',
    ].join('\n');

    await sendAlert({
      severity: totalIncidents === 0 ? 'success' : escalated > 3 ? 'warning' : 'success',
      title: 'CTO Agent: Weekly Digest',
      message,
    });

    log('info', 'Weekly digest sent', { totalIncidents, fixApplied, escalated, resolved });
  } catch (e) {
    log('error', `Weekly digest failed: ${e}`);
  }
}
