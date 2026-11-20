import { AFFILIATE_DISCLOSURE } from '@tracer/schema';
import type { AffiliateRecord, RankedTool } from '@tracer/schema';
import type { UnlinkedRankedTool } from './rank.js';

/**
 * Attach affiliate links to an already-ranked list. Runs strictly AFTER ranking and only
 * adds a field: order, rank and fitScore are copied through untouched. Only the URL and
 * the fixed disclosure are exposed; the commission rate never leaves this function.
 *
 * If several records exist for one entry, the first one in registry order wins.
 */
export function attachAffiliates(ranked: readonly UnlinkedRankedTool[], affiliates: readonly AffiliateRecord[]): RankedTool[] {
  const byEntry = new Map<string, AffiliateRecord>();
  for (const a of affiliates) if (!byEntry.has(a.entryId)) byEntry.set(a.entryId, a);
  return ranked.map((t) => {
    const a = byEntry.get(t.entryId);
    return { ...t, affiliate: a ? { url: a.url, disclosure: AFFILIATE_DISCLOSURE } : null };
  });
}
