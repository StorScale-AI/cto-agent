import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';
import { sendAlert } from './slack.js';

interface FixSignature {
  workflowName: string;
  errorSignature: string; // first 200 chars of error
  count: number;
  repos: string[];
  lastSeen: string;
}

const fixSignatures = new Map<string, FixSignature>();
const GRADUATION_THRESHOLD = 3;

/**
 * Record a Claude Code fix. If the same error signature appears 3+ times,
 * alert about pattern graduation candidate.
 */
export function recordFixSignature(
  repo: string,
  workflowName: string,
  errorText: string,
): void {
  const errorSignature = errorText.substring(0, 200).replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const key = `${workflowName}::${errorSignature.substring(0, 100)}`;

  const existing = fixSignatures.get(key);
  if (existing) {
    existing.count++;
    if (!existing.repos.includes(repo)) existing.repos.push(repo);
    existing.lastSeen = new Date().toISOString();

    if (existing.count === GRADUATION_THRESHOLD) {
      log('info', `Pattern graduation candidate: "${key}" (${existing.count} occurrences)`);

      // Persist to Supabase
      persistPatternCandidate(existing).catch(err =>
        log('warn', `Failed to persist pattern candidate: ${err}`)
      );

      // Alert
      sendAlert({
        severity: 'warning',
        title: 'CTO Agent: Pattern Graduation Candidate',
        message: `Error signature seen ${existing.count}+ times across ${existing.repos.length} repo(s):\n\`${errorSignature.substring(0, 100)}\`\n\nConsider creating a dedicated pattern matcher.`,
        fields: [
          { title: 'Workflow', value: workflowName },
          { title: 'Repos', value: existing.repos.join(', ') },
        ],
      });
    }
  } else {
    fixSignatures.set(key, {
      workflowName,
      errorSignature,
      count: 1,
      repos: [repo],
      lastSeen: new Date().toISOString(),
    });
  }
}

async function persistPatternCandidate(sig: FixSignature): Promise<void> {
  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;

  await fetch(`${url}/rest/v1/cto_agent_pattern_candidates`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      workflow_name: sig.workflowName,
      error_signature: sig.errorSignature,
      occurrence_count: sig.count,
      repos: sig.repos,
      last_seen: sig.lastSeen,
      status: 'candidate',
    }),
  });
}
