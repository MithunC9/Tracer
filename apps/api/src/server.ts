import type { Config } from './config/config.js';
import { describeConfig } from './config/config.js';
import { createContainer } from './container.js';
import { buildApp } from './http/app.js';
import { createLogger } from './observability/logger.js';

/** Boots container + HTTP server + job workers, with graceful shutdown. */
export async function startServer(config: Config, onShutdown: Array<() => Promise<unknown>> = []) {
  const log = createLogger(config.LOG_LEVEL);
  log.info({ config: describeConfig(config) }, 'starting tracer-api');
  const container = createContainer(config, log);
  await container.startJobs();
  const app = await buildApp(container);
  await app.listen({ host: config.API_HOST, port: config.API_PORT });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 20_000).unref();
    try {
      await app.close();
      await container.close();
      for (const fn of onShutdown) await fn();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  return { app, container };
}
