import crypto from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH  = 12; // 96 bits for GCM

function getKey(): Buffer {
  const secret = process.env.CONTACT_ENCRYPTION_KEY ?? '';
  if (!secret || secret.length < 32) {
    // In dev, derive a key from JWT secret as fallback
    return crypto.scryptSync(
      process.env.JWT_ACCESS_SECRET ?? 'dev-fallback-key',
      'staxz-contact-salt',
      KEY_LENGTH
    );
  }
  return Buffer.from(secret.slice(0, KEY_LENGTH * 2), 'hex');
}

/** Encrypt a string for at-rest storage */
export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  // Store ciphertext + authTag together
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    ciphertext: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/** Decrypt an at-rest stored value */
export function decrypt(ciphertext: string, iv: string): string {
  const key     = getKey();
  const ivBuf   = Buffer.from(iv, 'base64');
  const combined = Buffer.from(ciphertext, 'base64');

  // Last 16 bytes are the GCM auth tag
  const authTag    = combined.slice(combined.length - 16);
  const encrypted  = combined.slice(0, combined.length - 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

/** Encrypt provider contact details (phone + address) for storage */
export function encryptProviderContact(data: {
  phone: string;
  address?: string;
}): { ciphertext: string; iv: string } {
  return encrypt(JSON.stringify(data));
}

/** Decrypt provider contact — only called after payment confirmed */
export function decryptProviderContact(
  ciphertext: string,
  iv: string
): { phone: string; address?: string } {
  return JSON.parse(decrypt(ciphertext, iv));
}
