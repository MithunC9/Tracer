import { LIMITS, type Device, type PairDeviceRequest, type PairDeviceResponse, type PairingCode } from '@tracer/schema';
import type { Clock } from '../lib/clock.js';
import { AppError, errors, isUniqueViolation } from '../lib/errors.js';
import { generatePairingCode, normalizePairingCode, randomToken, safeEqual, sha256 } from '../lib/tokens.js';
import type { AuthLookups, UnitOfWork } from '../repositories/index.js';
import type { DeviceRow } from '../repositories/identity.js';
import type { Actor } from './context.js';

export const MAX_PAIRING_ATTEMPTS = 5;

/**
 * Pairing code = selector (first 4 chars) + verifier (last 4 chars), both Crockford base32.
 * The selector locates the row; the full code is compared in constant time against its hash.
 * Wrong guesses for a live selector count against that code and burn it after
 * MAX_PAIRING_ATTEMPTS; the route is also IP rate-limited.
 */
const selectorOf = (code8: string) => sha256(`pairing-selector:${code8.slice(0, 4)}`);
const hashOf = (code8: string) => sha256(`pairing-code:${code8}`);

export const toDeviceDto = (d: DeviceRow): Device => ({
  id: d.id,
  name: d.name,
  platform: d.platform as Device['platform'],
  agentVersion: d.agentVersion,
  createdAt: d.createdAt.toISOString(),
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  revokedAt: d.revokedAt?.toISOString() ?? null,
});

const invalidCode = () => new AppError('unauthorized', 401, 'Invalid or expired pairing code');

export class DevicesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly lookups: AuthLookups,
    private readonly clock: Clock,
  ) {}

  async createPairingCode(actor: Actor): Promise<PairingCode> {
    const expiresAt = new Date(this.clock.now().getTime() + LIMITS.pairingCodeTtlSeconds * 1000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generatePairingCode();
      const code8 = code.replace('-', '');
      try {
        await this.uow.run(actor.userId, async (r) => {
          await r.pairing.deleteForUser();
          await r.pairing.insert({ codeHash: hashOf(code8), selector: selectorOf(code8), expiresAt });
        });
        return { code, expiresAt: expiresAt.toISOString() };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // selector collision with another live code: draw again
      }
    }
    throw new Error('could not allocate a pairing code');
  }

  /** Public endpoint used by the agent. Every failure mode returns the same 401. */
  async pair(input: PairDeviceRequest, requestId: string | null): Promise<PairDeviceResponse> {
    const code8 = normalizePairingCode(input.code);
    if (!code8) throw invalidCode();
    const row = await this.lookups.pairingCode(selectorOf(code8));
    const now = this.clock.now();
    if (!row || row.usedAt || row.expiresAt <= now || row.attempts >= MAX_PAIRING_ATTEMPTS) throw invalidCode();

    if (!safeEqual(row.codeHash, hashOf(code8))) {
      await this.uow.run(row.userId, (r) => r.pairing.incrementAttempts(row.codeHash));
      throw invalidCode();
    }

    const deviceToken = randomToken(32);
    return this.uow.run(row.userId, async (r) => {
      if (!(await r.pairing.markUsed(row.codeHash, now))) throw invalidCode();
      const device = await r.devices.insert({
        name: input.deviceName,
        platform: input.platform,
        agentVersion: input.agentVersion,
        tokenHash: sha256(deviceToken),
      });
      // Pairing is a pre-auth flow, so it is logged here rather than by the decorator.
      await r.accessLog.insert({
        actor: 'device',
        actorId: device.id,
        action: 'device.pair',
        resource: `device:${device.id}`,
        requestId,
        at: now,
      });
      return { deviceId: device.id, deviceToken };
    });
  }

  /** Device bearer token -> identity. Lookup is by sha256 so no token comparison happens in app code. */
  async authenticate(token: string): Promise<{ deviceId: string; userId: string }> {
    if (!token || token.length > 200) throw errors.unauthorized('Invalid device token');
    const d = await this.lookups.deviceByTokenHash(sha256(token));
    if (!d || d.revokedAt) throw errors.unauthorized('Invalid or revoked device token');
    return { deviceId: d.deviceId, userId: d.userId };
  }

  list(actor: Actor): Promise<{ items: Device[] }> {
    return this.uow.run(actor.userId, async (r) => ({ items: (await r.devices.list()).map(toDeviceDto) }));
  }

  async revoke(actor: Actor, deviceId: string): Promise<void> {
    await this.uow.run(actor.userId, async (r) => {
      if (!(await r.devices.revoke(deviceId, this.clock.now()))) throw errors.notFound('Device');
    });
  }
}
