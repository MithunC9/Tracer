import { z } from 'zod';
import { APPS } from './apps.js';

/**
 * User-editable exclude list. Applied ON DEVICE before anything is stored locally,
 * and mirrored server-side as a second line of defence (server drops matching events).
 */
export const Exclusions = z
  .object({
    /** AppKeys or raw bundle ids */
    apps: z.array(z.string().min(1).max(200)).max(500),
    /** Hosts; a host also excludes its subdomains */
    domains: z.array(z.string().min(1).max(253)).max(500),
    /** Case-insensitive substrings matched against window titles */
    titleKeywords: z.array(z.string().min(2).max(80)).max(200),
    /** Private/incognito browser windows. Always true; present so the UI can show it. */
    privateBrowsing: z.literal(true),
  })
  .meta({ id: 'Exclusions' });
export type Exclusions = z.infer<typeof Exclusions>;

export const DEFAULT_EXCLUSIONS: Exclusions = {
  apps: APPS.filter((a) => a.excludedByDefault).map((a) => a.key),
  domains: APPS.filter((a) => a.excludedByDefault).flatMap((a) => a.hosts),
  titleKeywords: ['incognito', 'private browsing', 'inprivate', 'password', 'bank', 'medical', 'therapy'],
  privateBrowsing: true,
};

export interface ExclusionTarget {
  appKey: string;
  bundleId?: string | null;
  urlHost?: string | null;
  windowTitle?: string | null;
  isPrivateWindow?: boolean;
}

/** Pure predicate shared by agent (via port), API and tests. */
export function isExcluded(ex: Exclusions, t: ExclusionTarget): boolean {
  if (t.isPrivateWindow) return true;
  const apps = new Set(ex.apps.map((s) => s.toLowerCase()));
  if (apps.has(t.appKey.toLowerCase())) return true;
  if (t.bundleId && apps.has(t.bundleId.toLowerCase())) return true;
  if (t.urlHost) {
    const h = t.urlHost.toLowerCase();
    if (ex.domains.some((d) => h === d.toLowerCase() || h.endsWith('.' + d.toLowerCase()))) return true;
  }
  if (t.windowTitle) {
    const title = t.windowTitle.toLowerCase();
    if (ex.titleKeywords.some((k) => title.includes(k.toLowerCase()))) return true;
  }
  return false;
}
