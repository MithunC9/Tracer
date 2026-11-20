import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Envelope encryption.
 *
 *   MASTER_KEY (env, 32 bytes) --wraps--> per-user DEK (32 bytes, stored in user_keys)
 *   DEK --AES-256-GCM--> event payloads, stage outputs, reports
 *
 * Blob layout: [version=1][iv:12][tag:16][ciphertext]. Every blob is bound to its row with
 * additional authenticated data (AAD), so a ciphertext copied into another row or another
 * user's account fails authentication instead of decrypting.
 *
 * Deleting a user's wrapped DEK makes every residual copy (backups, WAL, replicas)
 * undecryptable: crypto-shredding.
 */
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER = 1 + IV_LEN + TAG_LEN;

export class CryptoError extends Error {}

export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function aesGcmDecrypt(key: Buffer, blob: Buffer, aad: string): Buffer {
  if (blob.length < HEADER || blob[0] !== VERSION) throw new CryptoError('unsupported ciphertext');
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, HEADER);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(HEADER)), decipher.final()]);
  } catch {
    throw new CryptoError('decryption failed');
  }
}

/** AAD conventions, one place so writers and readers cannot disagree. */
export const aad = {
  dek: (userId: string) => `user_keys:${userId}`,
  event: (userId: string, eventId: string) => `events:${userId}:${eventId}`,
  report: (userId: string, auditId: string) => `reports:${userId}:${auditId}`,
  /** Content-addressed so a cached output can be reused by a later run of the same user. */
  stageOutput: (userId: string, stage: string, inputHash: string) => `stage_outputs:${userId}:${stage}:${inputHash}`,
  llmCache: (userId: string, cacheKey: string) => `llm_cache:${userId}:${cacheKey}`,
};

export class KeyRing {
  private readonly master: Buffer;

  constructor(masterKeyBase64: string) {
    this.master = Buffer.from(masterKeyBase64, 'base64');
    if (this.master.length !== 32) throw new CryptoError('MASTER_KEY must be 32 bytes');
  }

  /** Independent subkeys for other purposes (receipt HMAC, ...), so the master key is never reused directly. */
  subkey(purpose: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.from('tracer/v1'), Buffer.from(purpose), 32));
  }

  newDek(userId: string): { dek: Buffer; wrapped: Buffer } {
    const dek = randomBytes(32);
    return { dek, wrapped: aesGcmEncrypt(this.master, dek, aad.dek(userId)) };
  }

  unwrapDek(userId: string, wrapped: Buffer): Buffer {
    return aesGcmDecrypt(this.master, wrapped, aad.dek(userId));
  }
}

export const encryptJson = (dek: Buffer, value: unknown, ad: string) =>
  aesGcmEncrypt(dek, Buffer.from(JSON.stringify(value), 'utf8'), ad);
export const decryptJson = <T = unknown>(dek: Buffer, blob: Buffer, ad: string): T =>
  JSON.parse(aesGcmDecrypt(dek, blob, ad).toString('utf8')) as T;
