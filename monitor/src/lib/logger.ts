import { randomUUID } from 'node:crypto';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

let _correlationId: string | undefined;

/** Set a correlation ID for the current polling cycle */
export function setCorrelationId(id?: string): string {
  _correlationId = id || randomUUID().split('-')[0];
  return _correlationId;
}

/** Get current correlation ID */
export function getCorrelationId(): string | undefined {
  return _correlationId;
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const entry: Record<string, unknown> = {
    timestamp,
    level,
    service: 'cto-agent-monitor',
    ...((_correlationId) ? { correlation_id: _correlationId } : {}),
    message,
    ...data,
  };
  const line = JSON.stringify(entry);

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}
