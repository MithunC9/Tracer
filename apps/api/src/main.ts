import { ConfigError, loadConfig } from './config/config.js';
import { startTelemetry } from './observability/telemetry.js';

// Fail fast on bad configuration, before anything else starts.
let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

// Tracing must be installed before http/pg are loaded, hence the dynamic import below.
const sdk = startTelemetry({ enabled: config.OTEL_ENABLED, exporter: config.OTEL_EXPORTER, serviceName: config.OTEL_SERVICE_NAME });
const { startServer } = await import('./server.js');
await startServer(config, sdk ? [() => sdk.shutdown()] : []);
