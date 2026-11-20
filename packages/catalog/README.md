# @tracer/catalog

The tool catalog, the fit-only ranking engine, the (separate) affiliate registry, and the
DIY recipe templates used by the `recommend` pipeline stage.

```ts
import { recommendTools, rankTools, attachAffiliates, recipeFor, CATALOG } from '@tracer/catalog';

const tools = recommendTools(cluster.requirements, userConstraints, { limit: 5 }); // RankedTool[]
const recipe = recipeFor({ label, canonicalPath, requirements, riskFlags });   // Recipe
```

| Export | Signature |
|---|---|
| `CATALOG` | `readonly CatalogEntry[]` (validated at import) |
| `rankTools` | `(req: ClusterRequirements, entries: readonly CatalogEntry[], constraints: UserConstraints, opts?: { limit?: number }) => Omit<RankedTool, 'affiliate'>[]` |
| `attachAffiliates` | `(ranked: readonly Omit<RankedTool, 'affiliate'>[], affiliates: readonly AffiliateRecord[]) => RankedTool[]` |
| `recommendTools` | `(req, constraints, opts?: { limit?, entries?, affiliates? }) => RankedTool[]`: rank, then attach |
| `recipeFor` | `(input: { label; canonicalPath: PathStep[]; requirements: ClusterRequirements; riskFlags: RiskTag[] }) => Recipe` |

The report adds the DIY option (the recipe) separately; it is not a catalog entry.

## Adding a catalog entry

1. Pick the file in `src/entries/` that matches the tool's category (or the closest one).
2. Add an object that satisfies `CatalogEntry` from `@tracer/schema`. The schema is strict:
   unknown fields fail, and there is no place for commission data on purpose.
   - `id`: lowercase, digits and hyphens. Unique across the catalog.
   - `category`: one of the `ToolCategory` values.
   - `capabilities`: the `CapabilityTag`s the tool really does without extra tools. Ranking
     is mostly capability coverage, so do not pad this list.
   - `integrations`: `AppKey`s from `packages/schema/src/apps.ts` the tool connects to
     natively. Use `*` only for tools that drive any app through the screen, browser or
     keyboard (text expanders, macro tools, browser automation). For a `native_feature`,
     put the **host app first**: it is only suggested when the workflow uses that app.
   - `platforms`: where it runs. A tool with `web` is available to everyone.
   - `pricingTier` + `priceNote`: be conservative. Use "Free tier; paid from ~$20/mo" style
     notes. Do not quote exact prices you have not checked; prices change.
   - `setupEffort`, `skillLevel`: for a non-engineer doing it for the first time.
   - `reliabilityNotes`: one or two plain sentences on how it fails in practice.
   - `openSource`: true for open-source or source-available self-hostable tools.
3. Write like the rest of the catalog: plain, specific, a little dry. No "supercharge",
   "unlock", "leverage" or "seamless" (a test checks).
4. Run `pnpm --filter @tracer/catalog test`. The catalog tests validate every entry, check
   ids are unique and integrations are known AppKeys, and re-run the commission fuzz test.

Affiliate links go in `src/affiliates.ts` only, never on the entry. Adding or removing one
cannot change any ranking; the tests prove that on every run.

## How ranking works

`rankTools` is a pure, deterministic function of the workflow's requirements, the entries
and the user's constraints. It has exactly three required parameters (`rankTools.length === 3`)
and never sees affiliate data. Affiliate links are attached afterwards by `attachAffiliates`,
which copies the list in order and only adds `{ url, disclosure }`.

**Hard filters** (the tool is left out):

| Filter | Rule |
|---|---|
| platform | No build for the user's OS and no web version (Apple Shortcuts never reaches a Windows user). |
| budget | `free_only` budget excludes `paid` tools. |
| host app | A `native_feature` whose host app (`integrations[0]`) is not in the workflow. |
| CRM | CRM products only when the workflow needs `crm_sync`. |
| relevance | Covers none of the needed capabilities. |

**Fit score** (0-100). Each part becomes a `FitReason` with its signed `delta`, so the UI
can show exactly why a tool ranks where it does. The deltas add up to the score.

| Factor | Points | How |
|---|---|---|
| capability | up to 50 | Share of needed capabilities covered. Trigger capabilities count half. |
| integration | up to 25 | Share of the workflow's apps the tool connects to. Generic `*` access counts 0.6. No apps named: 12.5. |
| budget | up to 10 | Free / included 10. Freemium 6-9 and paid 2-7, depending on the user's budget. |
| platform | 5 or 3 | Native app for the user's OS 5, web 3. |
| skill | +5 / -5 / -12 | Within the user's level, one level above, two levels above. |
| effort | -2 to +5 | Minutes 5, hour 3, afternoon 1, days -2. |
| open source | 0 / -8 | Only when the user prefers open source: closed tools lose 8. |
| unneeded AI | -10 | AI assistant, workflow needs no judgement, and a rule-based tool covers every capability. Recorded under `capability`. |

Ties break on entry id, ascending, so the same input always gives the same order.
Weights live in `RANK_WEIGHTS` in `src/rank.ts`.

## Recipes

`recipeFor` scores every template in `src/recipes/templates.ts` against the workflow's
capabilities, path actions (export, copy, paste, reconcile...) and app categories, and uses
the best match (ties go to the earlier template), or a generic fallback. Templates write
numbered steps with app display names. `keepHumanFor` always includes a checkpoint for each
risk flag (money, pii, irreversible, credentials, health), plus template-specific ones
such as "Approve each invoice before it is sent".

To add a template: write a `RecipeTemplate` with `match` (return 0 when it does not apply)
and `build`, add it to `TEMPLATES`, and add a matching case in `test/recipes.test.ts`.
