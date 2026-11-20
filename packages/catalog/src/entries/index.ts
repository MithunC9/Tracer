import { CatalogEntry } from '@tracer/schema';
import { AI_AND_BROWSER } from './ai-and-browser.js';
import { AUTOMATION_PLATFORMS } from './automation-platforms.js';
import { BUSINESS_APPS } from './business-apps.js';
import { COMMUNICATION } from './communication.js';
import { NATIVE_FEATURES } from './native-features.js';
import { SCRIPTS_AND_CODING } from './scripts-coding.js';

/**
 * The full catalog, validated against the strict `CatalogEntry` schema at import time.
 * A malformed entry fails loudly here rather than producing a quiet bad ranking later.
 */
export const CATALOG: readonly CatalogEntry[] = Object.freeze(
  [...AUTOMATION_PLATFORMS, ...NATIVE_FEATURES, ...SCRIPTS_AND_CODING, ...COMMUNICATION, ...BUSINESS_APPS, ...AI_AND_BROWSER].map(
    (e) => Object.freeze(CatalogEntry.parse(e)),
  ),
);

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((e) => [e.id, e]));
