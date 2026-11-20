import { APP_BY_KEY, appKeyForBundleId, appKeyForHost } from '@tracer/schema';

/** Slug for `other:<slug>` AppKeys: lowercase, [a-z0-9._-], max 64 chars. */
export function otherSlug(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return slug || 'unknown';
}

export interface Resolved {
  appKey: string;
  /** Host only; null for native apps */
  urlHost: string | null;
  /** Display name for AppRef.name */
  name: string;
}

/**
 * On-device AppKey resolution as the agent does it:
 * - browsers: the site's AppKey from host + first path segment, else `other:<host>`;
 *   a browser with no URL stays `browser`.
 * - native apps: bundle id lookup, else `other:<app name slug>`.
 */
export function resolveApp(bundleId: string, appName: string, url: string | null): Resolved {
  const byBundle = appKeyForBundleId(bundleId);
  if (byBundle === 'browser') {
    if (url) {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const key = appKeyForHost(host, u.pathname) ?? `other:${otherSlug(host)}`;
      return { appKey: key, urlHost: host, name: APP_BY_KEY.get(key)?.name ?? host.replace(/^www\./, '') };
    }
    return { appKey: 'browser', urlHost: null, name: appName };
  }
  if (byBundle) return { appKey: byBundle, urlHost: null, name: appName };
  return { appKey: `other:${otherSlug(appName)}`, urlHost: null, name: appName };
}
