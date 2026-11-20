import type { AffiliateRecord, CatalogEntry, ClusterRequirements, RankedTool, UserConstraints } from '@tracer/schema';
import { AFFILIATES } from './affiliates.js';
import { attachAffiliates } from './disclose.js';
import { CATALOG } from './entries/index.js';
import { rankTools, type RankOptions } from './rank.js';

export { CATALOG, CATALOG_BY_ID } from './entries/index.js';
export { AFFILIATES } from './affiliates.js';
export { attachAffiliates } from './disclose.js';
export {
  rankTools,
  capabilityCoverage,
  exclusionReason,
  isLlmTool,
  DEFAULT_RANK_LIMIT,
  RANK_WEIGHTS,
  type RankOptions,
  type UnlinkedRankedTool,
} from './rank.js';
export { recipeFor, selectTemplate, RISK_CHECKPOINTS, TEMPLATES, GENERIC_TEMPLATE, type RecipeInput, type RecipeTemplate } from './recipes/index.js';

export interface RecommendOptions extends RankOptions {
  /** Defaults to CATALOG. */
  entries?: readonly CatalogEntry[];
  /** Defaults to the AFFILIATES registry. Joined after ranking; cannot change order. */
  affiliates?: readonly AffiliateRecord[];
}

/**
 * The only place ranking and affiliate links meet: rank by fit first, then attach links
 * to the finished list. The ranked order is identical with or without affiliates.
 */
export function recommendTools(req: ClusterRequirements, constraints: UserConstraints, opts: RecommendOptions = {}): RankedTool[] {
  const rankOpts: RankOptions = opts.limit === undefined ? {} : { limit: opts.limit };
  const ranked = rankTools(req, opts.entries ?? CATALOG, constraints, rankOpts);
  return attachAffiliates(ranked, opts.affiliates ?? AFFILIATES);
}
