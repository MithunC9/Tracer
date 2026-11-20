import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/** One registry per container (no global state, so tests can build many apps). */
export function createMetrics(opts: { defaultMetrics?: boolean } = {}) {
  const registry = new Registry();
  if (opts.defaultMetrics !== false) collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    ingestEvents: new Counter({
      name: 'ingest_events_total',
      help: 'Events received by ingest, by outcome',
      labelNames: ['outcome'] as const, // accepted | duplicate | rejected
      registers: [registry],
    }),
    ingestBatches: new Counter({
      name: 'ingest_batches_total',
      help: 'Ingest batches, by outcome',
      labelNames: ['outcome'] as const, // stored | replayed | rate_limited | quota_exceeded
      registers: [registry],
    }),
    stageDuration: new Histogram({
      name: 'pipeline_stage_duration_seconds',
      help: 'Pipeline stage execution time',
      labelNames: ['stage', 'outcome'] as const, // succeeded | cached | failed
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
      registers: [registry],
    }),
    stageFailures: new Counter({
      name: 'pipeline_stage_failures_total',
      help: 'Pipeline stage attempt failures (dead = retries exhausted)',
      labelNames: ['stage', 'kind'] as const, // attempt | dead
      registers: [registry],
    }),
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
