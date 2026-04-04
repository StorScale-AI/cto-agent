import { log } from './logger.js';

interface MetricEntry {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

class MetricsCollector {
  private metrics: MetricEntry[] = [];
  private readonly maxEntries = 10000;

  record(name: string, value: number, tags?: Record<string, string>): void {
    this.metrics.push({ name, value, timestamp: Date.now(), tags });
    if (this.metrics.length > this.maxEntries) {
      this.metrics = this.metrics.slice(-this.maxEntries / 2);
    }
  }

  /** Time an async operation */
  async time<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.record(`${name}.duration_ms`, Date.now() - start, { ...tags, status: 'success' });
      this.record(`${name}.success`, 1, tags);
      return result;
    } catch (e) {
      this.record(`${name}.duration_ms`, Date.now() - start, { ...tags, status: 'error' });
      this.record(`${name}.error`, 1, tags);
      throw e;
    }
  }

  increment(name: string, tags?: Record<string, string>): void {
    this.record(name, 1, tags);
  }

  /** Get summary stats for a metric over a time window */
  summary(name: string, windowMs = 3600000): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  } {
    const cutoff = Date.now() - windowMs;
    const entries = this.metrics.filter(m => m.name === name && m.timestamp > cutoff);
    if (entries.length === 0) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };

    const values = entries.map(e => e.value);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /** Dump all metrics for debugging */
  dump(): MetricEntry[] {
    return [...this.metrics];
  }
}

export const metrics = new MetricsCollector();
