import { optionalEnv } from './env.js';
import { log } from './logger.js';

/**
 * Lightweight Sentry error reporting via the envelope API.
 * No SDK dependency — just sends error events over HTTP.
 */
export function initSentry(): void {
  const dsn = optionalEnv('SENTRY_DSN');
  if (!dsn) {
    log('debug', 'Sentry disabled — no SENTRY_DSN');
    return;
  }

  const parsedDsn = parseDsn(dsn);
  if (!parsedDsn) {
    log('warn', 'Invalid SENTRY_DSN format');
    return;
  }

  process.on('uncaughtException', (err) => {
    log('error', `Uncaught exception: ${err.message}`, { stack: err.stack });
    sendToSentry(parsedDsn, err).catch(() => {});
    // Re-throw after logging — process should still crash
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log('error', `Unhandled rejection: ${err.message}`, { stack: err.stack });
    sendToSentry(parsedDsn, err).catch(() => {});
  });

  log('info', 'Sentry error reporting initialized');
}

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace('/', '');
    if (!publicKey || !host || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

async function sendToSentry(dsn: ParsedDsn, error: Error): Promise<void> {
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    server_name: 'cto-agent-monitor',
    environment: process.env.NODE_ENV || 'production',
    exception: {
      values: [{
        type: error.name,
        value: error.message,
        stacktrace: error.stack ? {
          frames: error.stack.split('\n').slice(1).reverse().map(line => {
            const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
            if (match) {
              return {
                function: match[1],
                filename: match[2],
                lineno: parseInt(match[3]),
                colno: parseInt(match[4]),
              };
            }
            return { function: line.trim() };
          }),
        } : undefined,
      }],
    },
  };

  const envelope = [
    JSON.stringify({ event_id: event.event_id, dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}` }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  await fetch(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=cto-agent/1.0, sentry_key=${dsn.publicKey}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(5000),
  });
}
