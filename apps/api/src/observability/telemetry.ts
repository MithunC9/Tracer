import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry tracing (HTTP server + pg). Must start before `http`/`pg` are loaded, which is
 * why main.ts imports the server dynamically after calling this. Off by default (OTEL_ENABLED);
 * exporter `console` for local debugging or `otlp` (OTEL_EXPORTER_OTLP_ENDPOINT, standard env).
 */
export function startTelemetry(opts: { enabled: boolean; exporter: 'console' | 'otlp'; serviceName: string }): NodeSDK | null {
  if (!opts.enabled) return null;
  const exporter: SpanExporter = opts.exporter === 'console' ? new ConsoleSpanExporter() : new OTLPTraceExporter();
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: opts.serviceName }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/healthz' || req.url === '/metrics' }),
      // Statement text only, never parameter values (they can hold user data).
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  sdk.start();
  return sdk;
}
