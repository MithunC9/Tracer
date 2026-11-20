import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import { LIMITS, type LoginRequest, type Session, type SignupRequest } from '@tracer/schema';
import type { Clock } from '../lib/clock.js';
import { AppError, errors, isUniqueViolation } from '../lib/errors.js';
import { FailureThrottle } from '../lib/rate-limit.js';
import { randomToken, sha256 } from '../lib/tokens.js';
import type { AuthLookups, Repos, UnitOfWork } from '../repositories/index.js';
import type { KeyService } from './context.js';

export interface IssuedSession {
  session: Session;
  /** Raw refresh token; goes only into the httpOnly cookie. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

export class Argon2Hasher implements PasswordHasher {
  private readonly opts: { type: typeof argon2.argon2id; memoryCost: number; timeCost: number; parallelism: number };
  constructor(memoryKiB: number, timeCost: number) {
    this.opts = { type: argon2.argon2id, memoryCost: memoryKiB, timeCost, parallelism: 1 };
  }
  hash(password: string) {
    return argon2.hash(password, this.opts);
  }
  async verify(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
  needsRehash(hash: string) {
    return argon2.needsRehash(hash, this.opts);
  }
}

const ISSUER = 'tracer-api';
const AUDIENCE = 'tracer-web';

export class AccessTokens {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const exp = now + LIMITS.accessTokenTtlSeconds;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Returns the user id, or throws 401. Only HS256 accepted (no `alg: none` / confusion). */
  async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      if (typeof payload.sub !== 'string') throw new Error('no sub');
      return payload.sub;
    } catch {
      throw errors.unauthorized('Invalid or expired access token');
    }
  }
}

/**
 * Accounts and web sessions: signup, login (argon2id + throttling), rotating refresh tokens
 * with family-wide reuse detection, logout.
 */
export class AuthService {
  private readonly throttle: FailureThrottle;
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly lookups: AuthLookups,
    private readonly keys: KeyService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: AccessTokens,
    private readonly clock: Clock,
    opts: { maxLoginFailures: number },
  ) {
    this.throttle = new FailureThrottle(opts.maxLoginFailures, 15 * 60_000, clock);
  }

  async signup(input: SignupRequest): Promise<IssuedSession> {
    if (input.acceptSelfObservation !== true) throw errors.badRequest('Consent to the self-observation rule is required');
    const passwordHash = await this.hasher.hash(input.password);
    const userId = randomUUID();
    try {
      return await this.uow.run(userId, async (r) => {
        const user = await r.users.insert({
          id: userId,
          email: input.email,
          passwordHash,
          displayName: input.displayName ?? null,
          consentAt: this.clock.now(),
        });
        await this.keys.create(r);
        return this.issue(r, { id: user.id, email: user.email, displayName: user.displayName }, randomUUID());
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict('An account with this email already exists');
      throw err;
    }
  }

  async login(input: LoginRequest): Promise<IssuedSession> {
    const key = input.email.toLowerCase();
    const locked = this.throttle.lockedFor(key);
    if (locked > 0) throw errors.rateLimited(locked, 'Too many failed login attempts; try again later');

    const found = await this.lookups.userByEmail(key);
    // Verify against a dummy hash when the account does not exist so timing does not reveal it.
    const hash = found?.passwordHash ?? (await this.getDummyHash());
    const ok = await this.hasher.verify(hash, input.password);
    if (!found || !ok) {
      this.throttle.fail(key);
      throw errors.unauthorized('Invalid email or password');
    }
    this.throttle.succeed(key);
    return this.uow.run(found.id, async (r) => {
      const user = await r.users.findById(found.id);
      if (!user) throw errors.unauthorized('Invalid email or password');
      if (this.hasher.needsRehash(user.passwordHash)) {
        await r.users.update(user.id, { passwordHash: await this.hasher.hash(input.password) });
      }
      await r.refreshTokens.pruneExpired(this.clock.now());
      return this.issue(r, user, randomUUID());
    });
  }

  /**
   * Rotation: each refresh token is single-use. Presenting one that was already rotated or
   * revoked means it leaked (or two clients raced); the whole family is revoked and the user
   * must log in again.
   */
  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    if (!rawToken) throw errors.unauthorized('Missing refresh token');
    const found = await this.lookups.refreshToken(sha256(rawToken));
    if (!found) throw errors.unauthorized('Invalid refresh token');
    const now = this.clock.now();

    const outcome = await this.uow.run(found.userId, async (r) => {
      if (found.revokedAt || found.rotatedAt) {
        await r.refreshTokens.revokeFamily(found.familyId, now);
        return { kind: 'reuse' as const };
      }
      if (found.expiresAt <= now) return { kind: 'expired' as const };
      if (!(await r.refreshTokens.markRotated(found.id, now))) {
        await r.refreshTokens.revokeFamily(found.familyId, now);
        return { kind: 'reuse' as const };
      }
      const user = await r.users.findById(found.userId);
      if (!user) return { kind: 'expired' as const };
      return { kind: 'issued' as const, issued: await this.issue(r, user, found.familyId) };
    });
    if (outcome.kind === 'issued') return outcome.issued;
    if (outcome.kind === 'reuse') throw new AppError('unauthorized', 401, 'Refresh token reuse detected; all sessions in this family were revoked');
    throw errors.unauthorized('Refresh token expired');
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const found = await this.lookups.refreshToken(sha256(rawToken));
    if (!found) return;
    await this.uow.run(found.userId, (r) => r.refreshTokens.revokeFamily(found.familyId, this.clock.now()));
  }

  verifyAccessToken(token: string) {
    return this.tokens.verify(token);
  }

  private async issue(r: Repos, user: { id: string; email: string; displayName: string | null }, familyId: string): Promise<IssuedSession> {
    const access = await this.tokens.sign(user.id);
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(this.clock.now().getTime() + LIMITS.refreshTokenTtlSeconds * 1000);
    await r.refreshTokens.insert({ userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt });
    return {
      refreshToken,
      refreshExpiresAt,
      session: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        csrfToken: randomToken(32),
        user: { id: user.id, email: user.email, displayName: user.displayName },
      },
    };
  }

  private getDummyHash() {
    this.dummyHash ??= this.hasher.hash(randomToken(16));
    return this.dummyHash;
  }
}
