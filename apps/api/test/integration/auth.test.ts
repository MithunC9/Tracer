import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Me, Session } from '@tracer/schema';
import { bearer, cookieValue, createHarness, signup, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ env: { LOGIN_MAX_FAILURES: '3', AUTH_RATE_PER_MIN: '1000' } });
});
afterAll(() => h.close());

const refresh = (cookies: { rt?: string; csrf?: string }, csrfHeader?: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    cookies: { ...(cookies.rt ? { tracer_rt: cookies.rt } : {}), ...(cookies.csrf ? { tracer_csrf: cookies.csrf } : {}) },
    headers: csrfHeader ? { 'x-csrf-token': csrfHeader } : {},
  });

describe('signup & login', () => {
  it('requires explicit consent to the self-observation rule', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'noconsent@example.com', password: 'long enough password', acceptSelfObservation: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates an account, sets hardened cookies and returns a Session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'Alice@Example.com', password: 'correct horse battery', acceptSelfObservation: true, displayName: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    const s = Session.parse(res.json());
    expect(s.user.email).toBe('alice@example.com');
    const rt = (res.cookies as { name: string; httpOnly?: boolean; sameSite?: string; path?: string }[]).find((c) => c.name === 'tracer_rt')!;
    expect(rt).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
    expect(cookieValue(res, 'tracer_csrf')).toBe(s.csrfToken);
    // stored hash is argon2id, never the password
    const row = await h.admin.query('select password_hash from users where id = $1', [s.user.id]);
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    // a wrapped DEK exists
    expect((await h.admin.query('select 1 from user_keys where user_id = $1', [s.user.id])).rowCount).toBe(1);
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'ALICE@example.com', password: 'another long password', acceptSelfObservation: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it('logs in and the access token authorizes /v1/me', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: 'correct horse battery' } });
    expect(res.statusCode).toBe(200);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(res.json().accessToken) });
    expect(me.statusCode).toBe(200);
    expect(Me.parse(me.json()).displayName).toBe('Alice');
  });

  it('rejects missing, malformed and forged access tokens', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer('garbage') })).statusCode).toBe(401);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(none) })).statusCode).toBe(401);
  });

  it('expires access tokens after 15 minutes', async () => {
    const u = await signup(h.app);
    h.clock.advance(16 * 60_000);
    try {
      expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(u.accessToken) })).statusCode).toBe(401);
    } finally {
      h.clock.advance(-16 * 60_000);
    }
  });

  it('throttles repeated failed logins per account, without revealing whether it exists', async () => {
    const u = await signup(h.app);
    for (let i = 0; i < 3; i++) {
      const r = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'wrong password!' } });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.message).toBe('Invalid email or password');
    }
    const locked = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    const unknown = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@example.com', password: 'whatever pw' } });
    expect(unknown.json().error.message).toBe('Invalid email or password');
  });
});

describe('refresh rotation & reuse detection', () => {
  it('requires the CSRF double-submit header', async () => {
    const u = await signup(h.app);
    expect((await refresh({ rt: u.refreshCookie, csrf: u.csrf })).statusCode).toBe(403);
    expect((await refresh({ rt: u.refreshCookie, csrf: u.csrf }, 'wrong')).json().error.code).toBe('csrf_failed');
    expect((await refresh({ rt: u.refreshCookie }, u.csrf)).statusCode).toBe(403);
  });

  it('rotates the refresh token and revokes the whole family on reuse', async () => {
    const u = await signup(h.app);
    const r1 = await refresh({ rt: u.refreshCookie, csrf: u.csrf }, u.csrf);
    expect(r1.statusCode).toBe(200);
    const rt2 = cookieValue(r1, 'tracer_rt')!;
    const csrf2 = r1.json().csrfToken;
    expect(rt2).not.toBe(u.refreshCookie);

    // Replaying the first (rotated) token is reuse: rejected...
    const replay = await refresh({ rt: u.refreshCookie, csrf: u.csrf }, u.csrf);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.message).toMatch(/reuse/);
    // ...and the legitimate successor is now dead too.
    expect((await refresh({ rt: rt2, csrf: csrf2 }, csrf2)).statusCode).toBe(401);
    const fam = await h.admin.query('select count(*)::int as n from refresh_tokens where user_id = $1 and revoked_at is null', [u.userId]);
    expect(fam.rows[0].n).toBe(0);
  });

  it('expires refresh tokens', async () => {
    const u = await signup(h.app);
    h.clock.advance(31 * 24 * 3600_000);
    try {
      expect((await refresh({ rt: u.refreshCookie, csrf: u.csrf }, u.csrf)).statusCode).toBe(401);
    } finally {
      h.clock.advance(-31 * 24 * 3600_000);
    }
  });

  it('logout revokes the family and clears cookies', async () => {
    const u = await signup(h.app);
    const out = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { tracer_rt: u.refreshCookie, tracer_csrf: u.csrf },
      headers: { 'x-csrf-token': u.csrf },
    });
    expect(out.statusCode).toBe(204);
    expect(cookieValue(out, 'tracer_rt')).toBe('');
    expect((await refresh({ rt: u.refreshCookie, csrf: u.csrf }, u.csrf)).statusCode).toBe(401);
  });

  it('stores only hashes of refresh tokens', async () => {
    const u = await signup(h.app);
    const rows = await h.admin.query('select token_hash from refresh_tokens where user_id = $1', [u.userId]);
    expect(rows.rows[0].token_hash.length).toBe(32);
    expect(rows.rows[0].token_hash.toString('base64url')).not.toBe(u.refreshCookie);
  });
});

describe('auth route rate limit', () => {
  it('limits auth routes per IP', async () => {
    const h2 = await createHarness({ env: { AUTH_RATE_PER_MIN: '2' } });
    try {
      const go = () => h2.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'x@example.com', password: 'y' } });
      await go();
      await go();
      const third = await go();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('rate_limited');
    } finally {
      await h2.close();
    }
  });
});
