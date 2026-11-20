import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { devices, pairingCodes, refreshTokens, userKeys, users } from '../db/schema.js';
import type { Tx } from '../db/database.js';

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;

/**
 * Repositories receive a tenant transaction and add explicit user filters as defence in depth;
 * Postgres RLS is the actual isolation boundary.
 */
export class UsersRepo {
  constructor(private readonly tx: Tx) {}

  async insert(row: { id: string; email: string; passwordHash: string; displayName: string | null; consentAt: Date }) {
    const [u] = await this.tx.db
      .insert(users)
      .values({
        id: row.id,
        email: row.email,
        passwordHash: row.passwordHash,
        displayName: row.displayName,
        consentSelfObservationAt: row.consentAt,
      })
      .returning();
    return u!;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [u] = await this.tx.db.select().from(users).where(eq(users.id, id));
    return u ?? null;
  }

  async update(id: string, patch: Partial<Pick<UserRow, 'displayName' | 'constraints' | 'passwordHash'>>) {
    const [u] = await this.tx.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return u ?? null;
  }
}

export class UserKeysRepo {
  constructor(private readonly tx: Tx) {}
  async insert(userId: string, wrappedDek: Buffer) {
    await this.tx.db.insert(userKeys).values({ userId, wrappedDek });
  }
  async get(userId: string) {
    const [k] = await this.tx.db.select().from(userKeys).where(eq(userKeys.userId, userId));
    return k ?? null;
  }
}

export class RefreshTokensRepo {
  constructor(private readonly tx: Tx) {}

  async insert(row: { userId: string; familyId: string; tokenHash: Buffer; expiresAt: Date }) {
    await this.tx.db.insert(refreshTokens).values(row);
  }

  /** Marks a token as used. Returns false if it was already rotated/revoked (lost a race = reuse). */
  async markRotated(id: string, at: Date): Promise<boolean> {
    const r = await this.tx.db
      .update(refreshTokens)
      .set({ rotatedAt: at })
      .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, this.tx.userId), isNull(refreshTokens.rotatedAt), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return r.length === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const r = await this.tx.db
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokens.familyId, familyId), eq(refreshTokens.userId, this.tx.userId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return r.length;
  }

  /** Housekeeping: drop this user's expired or long-dead tokens. */
  async pruneExpired(now: Date) {
    await this.tx.db
      .delete(refreshTokens)
      .where(and(eq(refreshTokens.userId, this.tx.userId), or(lt(refreshTokens.expiresAt, now), lt(refreshTokens.revokedAt, sql`${now}::timestamptz - interval '7 days'`))));
  }
}

export class PairingCodesRepo {
  constructor(private readonly tx: Tx) {}

  /** One outstanding code per user: creating a new one retires the old ones. */
  async deleteForUser() {
    await this.tx.db.delete(pairingCodes).where(eq(pairingCodes.userId, this.tx.userId));
  }

  async insert(row: { codeHash: Buffer; selector: Buffer; expiresAt: Date }) {
    await this.tx.db.insert(pairingCodes).values({ ...row, userId: this.tx.userId });
  }

  async incrementAttempts(codeHash: Buffer): Promise<number> {
    const [r] = await this.tx.db
      .update(pairingCodes)
      .set({ attempts: sql`${pairingCodes.attempts} + 1` })
      .where(and(eq(pairingCodes.codeHash, codeHash), eq(pairingCodes.userId, this.tx.userId)))
      .returning({ attempts: pairingCodes.attempts });
    return r?.attempts ?? 0;
  }

  /** Single-use: returns false if someone else redeemed it first. */
  async markUsed(codeHash: Buffer, at: Date): Promise<boolean> {
    const r = await this.tx.db
      .update(pairingCodes)
      .set({ usedAt: at })
      .where(and(eq(pairingCodes.codeHash, codeHash), eq(pairingCodes.userId, this.tx.userId), isNull(pairingCodes.usedAt)))
      .returning({ c: pairingCodes.codeHash });
    return r.length === 1;
  }
}

export class DevicesRepo {
  constructor(private readonly tx: Tx) {}

  async insert(row: { name: string; platform: string; agentVersion: string; tokenHash: Buffer }) {
    const [d] = await this.tx.db
      .insert(devices)
      .values({ ...row, userId: this.tx.userId })
      .returning();
    return d!;
  }

  async list(): Promise<DeviceRow[]> {
    return this.tx.db.select().from(devices).where(eq(devices.userId, this.tx.userId)).orderBy(devices.createdAt);
  }

  async findById(id: string): Promise<DeviceRow | null> {
    const [d] = await this.tx.db.select().from(devices).where(and(eq(devices.id, id), eq(devices.userId, this.tx.userId)));
    return d ?? null;
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const r = await this.tx.db
      .update(devices)
      .set({ revokedAt: sql`coalesce(${devices.revokedAt}, ${at}::timestamptz)` })
      .where(and(eq(devices.id, id), eq(devices.userId, this.tx.userId)))
      .returning({ id: devices.id });
    return r.length === 1;
  }

  /** Updates lastSeenAt at most once a minute per device to avoid write amplification on ingest. */
  async touch(id: string, at: Date, agentVersion?: string) {
    await this.tx.client.query(
      `update devices set last_seen_at = $2, agent_version = coalesce($3, agent_version)
       where id = $1 and user_id = $4 and (last_seen_at is null or last_seen_at < $2::timestamptz - interval '60 seconds')`,
      [id, at, agentVersion ?? null, this.tx.userId],
    );
  }
}
