import crypto from 'crypto';

/** Generate a 6-digit numeric OTP */
export const generateOtp = (): string =>
  Math.floor(100_000 + Math.random() * 900_000).toString();

/** Generate a booking reference: SK-XXXXXX (uppercase alphanum) */
export const generateBookingRef = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = 'SK-';
  for (let i = 0; i < 6; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
};

/** HMAC-SHA256 signature verification for webhooks */
export const verifyWebhookSignature = (
  payload: string,
  signature: string,
  secret: string
): boolean => {
  const expected = crypto
    .createHmac('sha512', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
};

/** Hash a token for storage (never store raw refresh tokens) */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Generate a cryptographically secure random token */
export const generateSecureToken = (bytes = 32): string =>
  crypto.randomBytes(bytes).toString('hex');
