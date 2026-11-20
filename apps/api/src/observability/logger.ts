import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Paths never written to logs. Covers credentials in headers/cookies and every secret-bearing
 * field name used by the API contract.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.deviceToken',
  '*.csrfToken',
  '*.token',
  '*.JWT_SECRET',
  '*.MASTER_KEY',
  '*.METRICS_TOKEN',
  'password',
  'deviceToken',
  'refreshToken',
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'tracer-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(level: string): Logger {
  return pino(loggerOptions(level));
}
