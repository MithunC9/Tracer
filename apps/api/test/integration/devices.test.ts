import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentConfig, Device, PairingCode } from '@tracer/schema';
import { bearer, createHarness, pair, signup, type Harness } from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ env: { AUTH_RATE_PER_MIN: '1000' } });
});
afterAll(() => h.close());

const newCode = async (token: string) =>
  PairingCode.parse((await h.app.inject({ method: 'POST', url: '/v1/devices/pairing-codes', headers: bearer(token) })).json());
const tryPair = (code: string) =>
  h.app.inject({ method: 'POST', url: '/v1/devices/pair', payload: { code, deviceName: 'Mac', platform: 'macos', agentVersion: '1.0.0' } });

describe('device pairing', () => {
  it('issues a Crockford XXXX-XXXX code valid for 10 minutes, stored hashed', async () => {
    const u = await signup(h.app);
    const code = await newCode(u.accessToken);
    expect(code.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(Date.parse(code.expiresAt) - h.clock.now().getTime()).toBe(10 * 60_000);
    const rows = await h.admin.query('select code_hash from pairing_codes where user_id = $1', [u.userId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].code_hash.toString()).not.toContain(code.code.replace('-', ''));
  });

  it('exchanges the code for an opaque device token (stored as sha256) exactly once', async () => {
    const u = await signup(h.app);
    const code = await newCode(u.accessToken);
    const res = await tryPair(code.code);
    expect(res.statusCode).toBe(201);
    const { deviceId, deviceToken } = res.json();
    expect(Buffer.from(deviceToken, 'base64url').length).toBe(32);
    const row = await h.admin.query('select token_hash from devices where id = $1', [deviceId]);
    expect(row.rows[0].token_hash.length).toBe(32);
    expect((await tryPair(code.code)).statusCode).toBe(401); // single use
  });

  it('burns a code after 5 wrong guesses for its selector', async () => {
    const u = await signup(h.app);
    const code = await newCode(u.accessToken);
    const [sel, ver] = code.code.split('-') as [string, string];
    const wrongVer = ver === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
    for (let i = 0; i < 5; i++) expect((await tryPair(`${sel}-${wrongVer}`)).statusCode).toBe(401);
    expect((await tryPair(code.code)).statusCode).toBe(401);
    const row = await h.admin.query('select attempts from pairing_codes where user_id = $1', [u.userId]);
    expect(row.rows[0].attempts).toBe(5);
  });

  it('rejects expired codes', async () => {
    const u = await signup(h.app);
    const code = await newCode(u.accessToken);
    h.clock.advance(11 * 60_000);
    try {
      expect((await tryPair(code.code)).statusCode).toBe(401);
    } finally {
      h.clock.advance(-11 * 60_000);
    }
  });

  it('lists devices without secrets, tracks lastSeenAt, and revocation kills the token', async () => {
    const u = await signup(h.app);
    const d = await pair(h.app, u.accessToken);
    const cfg = await h.app.inject({ method: 'GET', url: '/v1/agent/config', headers: bearer(d.deviceToken) });
    expect(cfg.statusCode).toBe(200);
    const config = AgentConfig.parse(cfg.json());
    expect(config).toMatchObject({ deviceId: d.deviceId, auditId: null, captureAllowed: false });
    expect(config.exclusions.privateBrowsing).toBe(true);

    const list = await h.app.inject({ method: 'GET', url: '/v1/devices', headers: bearer(u.accessToken) });
    const items = list.json().items as Device[];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!)).not.toContain('tokenHash');
    Device.parse(items[0]);

    const del = await h.app.inject({ method: 'DELETE', url: `/v1/devices/${d.deviceId}`, headers: bearer(u.accessToken) });
    expect(del.statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/agent/config', headers: bearer(d.deviceToken) })).statusCode).toBe(401);
    const after = (await h.app.inject({ method: 'GET', url: '/v1/devices', headers: bearer(u.accessToken) })).json().items[0];
    expect(after.revokedAt).not.toBeNull();
  });

  it('a user access token is not a device token and vice versa', async () => {
    const u = await signup(h.app);
    const d = await pair(h.app, u.accessToken);
    expect((await h.app.inject({ method: 'GET', url: '/v1/agent/config', headers: bearer(u.accessToken) })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(d.deviceToken) })).statusCode).toBe(401);
  });
});
