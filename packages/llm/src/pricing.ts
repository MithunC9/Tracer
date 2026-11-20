import type { LlmUsage } from './types.js';

/** USD per million tokens. cacheWrite is the 5-minute TTL rate (1.25x input). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * First-party Anthropic API list prices (claude-api skill, cached 2026-11-03).
 * Cache reads are 0.1x input unless the model has its own published rate.
 */
export const PRICING: Record<string, ModelPrice> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'mock-1': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/**
 * Resolve a price entry: exact id, else the longest table id that prefixes the
 * model (handles dated suffixes and an `anthropic.` platform prefix).
 */
export function priceFor(model: string, table: Record<string, ModelPrice> = PRICING): ModelPrice | undefined {
  const m = model.replace(/^anthropic\./, '');
  if (table[m]) return table[m];
  let best: string | undefined;
  for (const id of Object.keys(table)) {
    if (m.startsWith(`${id}-`) || m.startsWith(`${id}@`)) {
      if (!best || id.length > best.length) best = id;
    }
  }
  return best ? table[best] : undefined;
}

/** Cost of one call in USD; `known: false` when the model is not in the table (cost 0). */
export function costOf(
  model: string,
  usage: LlmUsage,
  table: Record<string, ModelPrice> = PRICING,
): { costUsd: number; known: boolean } {
  const p = priceFor(model, table);
  if (!p) return { costUsd: 0, known: false };
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      (usage.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000;
  return { costUsd: usd, known: true };
}
