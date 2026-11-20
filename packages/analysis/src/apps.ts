import { APP_BY_KEY, appKeyForHost, type AppCategory, type AppDef } from '@tracer/schema';

/**
 * A focus on the generic `browser` container is resolved to the site's AppKey when the
 * host is known, else to `other:<host>` so distinct sites stay distinct.
 */
export function resolveAppKey(key: string, urlHost: string | null | undefined): string {
  if (key !== 'browser' || !urlHost) return key;
  const known = appKeyForHost(urlHost);
  if (known) return known;
  const h = urlHost
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64);
  return h ? `other:${h}` : key;
}

export const appDef = (key: string): AppDef | undefined => APP_BY_KEY.get(key);

export function appCategory(key: string): AppCategory {
  return appDef(key)?.category ?? (key.startsWith('other:') ? 'other' : 'other');
}

/** Display name for labels: "Google Sheets", or "Example.com" for `other:example.com`. */
export function appName(key: string): string {
  const def = appDef(key);
  if (def) return def.name;
  const slug = key.startsWith('other:') ? key.slice(6) : key;
  const base = slug.replace(/^(app|my|www)\./, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * 0..1 automation reachability of one app, from its automation surfaces.
 * api 0.4 + no-code connectors 0.3 + file import/export 0.1 + desktop scripting 0.1 + native rules 0.1.
 * Unknown apps get 0.2: browser automation is usually possible but brittle.
 */
export function appAutomationScore(key: string): number {
  const def = appDef(key);
  if (!def || def.key === 'browser') return 0.2;
  const a = def.automation;
  return (a.api ? 0.4 : 0) + (a.noCode ? 0.3 : 0) + (a.fileIo ? 0.1 : 0) + (a.desktopScript ? 0.1 : 0) + (a.nativeRules ? 0.1 : 0);
}
