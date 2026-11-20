/** Cookie names. `tracer_rt` matches the `refreshCookie` security scheme in the OpenAPI contract. */
export const COOKIE = {
  refresh: 'tracer_rt',
  csrf: 'tracer_csrf',
  /** Both cookies are only sent to the auth endpoints that need them. */
  path: '/v1/auth',
} as const;

export const CSRF_HEADER = 'x-csrf-token';
