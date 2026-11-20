import { routes, type RouteInput, type RouteName, type RouteResponse } from './routes.js';

/**
 * Typed API client derived from the route contract. Used by the web app and tests.
 * Optional-field ergonomics: pass only the parts the route declares.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Defined<T> = { [K in keyof T as T[K] extends undefined ? never : K]: T[K] };
export type CallArgs<N extends RouteName> = Defined<RouteInput<N>>;

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  getCsrfToken?: () => string | null | undefined;
  fetch?: typeof fetch;
  /** Called once on 401 for user routes; return true if a retry should happen. */
  onUnauthorized?: () => Promise<boolean>;
}

export function buildPath(template: string, params?: Record<string, unknown>): string {
  return template.replace(/:([a-zA-Z_]+)/g, (_, k: string) => {
    const v = params?.[k];
    if (v === undefined) throw new Error(`missing path param ${k}`);
    return encodeURIComponent(String(v));
  });
}

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  async function call<N extends RouteName>(
    name: N,
    ...args: keyof CallArgs<N> extends never ? [] | [CallArgs<N>] : [CallArgs<N>]
  ): Promise<RouteResponse<N>> {
    const def = routes[name];
    const a = (args[0] ?? {}) as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
    let url = opts.baseUrl.replace(/\/$/, '') + buildPath(def.path, a.params);
    if (a.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(a.query)) if (v !== undefined && v !== null) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += '?' + s;
    }
    const doFetch = () => {
      const headers: Record<string, string> = { accept: 'application/json' };
      const token = opts.getAccessToken?.();
      if (token && def.auth === 'user') headers.authorization = `Bearer ${token}`;
      if (def.auth === 'refresh') {
        const csrf = opts.getCsrfToken?.();
        if (csrf) headers['x-csrf-token'] = csrf;
      }
      let body: string | undefined;
      if (a.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(a.body);
      }
      return f(url, { method: def.method, headers, body, credentials: 'include' });
    };
    let res = await doFetch();
    if (res.status === 401 && def.auth === 'user' && opts.onUnauthorized && (await opts.onUnauthorized())) {
      res = await doFetch();
    }
    if (!res.ok) {
      let payload: { error?: { code?: string; message?: string; requestId?: string; details?: unknown } } = {};
      try {
        payload = (await res.json()) as typeof payload;
      } catch {
        /* non-JSON error */
      }
      throw new ApiClientError(
        res.status,
        payload.error?.code ?? 'http_error',
        payload.error?.message ?? res.statusText,
        payload.error?.requestId ?? res.headers.get('x-request-id'),
        payload.error?.details,
      );
    }
    if (def.response === null || res.status === 204) return undefined as RouteResponse<N>;
    if (def.response === 'binary') return (await res.blob()) as RouteResponse<N>;
    return (await res.json()) as RouteResponse<N>;
  }
  return { call };
}
export type ApiClient = ReturnType<typeof createClient>;
