import type { Database } from '../db/database.js';

/**
 * Pre-tenant lookups. Each call is one SECURITY DEFINER function owned by `tracer_auth`
 * (see migration 0002); the app role itself never bypasses RLS.
 */
export interface AuthLookups {
  userByEmail(email: string): Promise<{ id: string; passwordHash: string } | null>;
  deviceByTokenHash(hash: Buffer): Promise<{ deviceId: string; userId: string; revokedAt: Date | null } | null>;
  refreshToken(hash: Buffer): Promise<{
    id: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
    rotatedAt: Date | null;
    revokedAt: Date | null;
  } | null>;
  pairingCode(selector: Buffer): Promise<{ codeHash: Buffer; userId: string; expiresAt: Date; usedAt: Date | null; attempts: number } | null>;
  auditsDue(now: Date, limit: number): Promise<{ auditId: string; userId: string; status: string }[]>;
  purgePairingCodes(now: Date): Promise<number>;
}

export class PgAuthLookups implements AuthLookups {
  constructor(private readonly db: Database) {}

  async userByEmail(email: string) {
    const r = await this.db.query<{ id: string; password_hash: string }>('select * from auth_user_by_email($1)', [email]);
    const u = r.rows[0];
    return u ? { id: u.id, passwordHash: u.password_hash } : null;
  }

  async deviceByTokenHash(hash: Buffer) {
    const r = await this.db.query<{ device_id: string; user_id: string; revoked_at: Date | null }>('select * from auth_device_by_token($1)', [hash]);
    const d = r.rows[0];
    return d ? { deviceId: d.device_id, userId: d.user_id, revokedAt: d.revoked_at } : null;
  }

  async refreshToken(hash: Buffer) {
    const r = await this.db.query<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      rotated_at: Date | null;
      revoked_at: Date | null;
    }>('select * from auth_refresh_token($1)', [hash]);
    const t = r.rows[0];
    return t
      ? { id: t.id, userId: t.user_id, familyId: t.family_id, expiresAt: t.expires_at, rotatedAt: t.rotated_at, revokedAt: t.revoked_at }
      : null;
  }

  async pairingCode(selector: Buffer) {
    const r = await this.db.query<{ code_hash: Buffer; user_id: string; expires_at: Date; used_at: Date | null; attempts: number }>(
      'select * from auth_pairing_code($1)',
      [selector],
    );
    const p = r.rows[0];
    return p ? { codeHash: p.code_hash, userId: p.user_id, expiresAt: p.expires_at, usedAt: p.used_at, attempts: p.attempts } : null;
  }

  async auditsDue(now: Date, limit: number) {
    const r = await this.db.query<{ audit_id: string; user_id: string; status: string }>('select * from system_audits_due($1, $2)', [now, limit]);
    return r.rows.map((x) => ({ auditId: x.audit_id, userId: x.user_id, status: x.status }));
  }

  async purgePairingCodes(now: Date) {
    const r = await this.db.query<{ n: number }>('select system_purge_pairing_codes($1) as n', [now]);
    return r.rows[0]?.n ?? 0;
  }
}
