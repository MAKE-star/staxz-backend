import dotenv from 'dotenv';
dotenv.config();

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const optionalNum = (key: string, fallback: number): number => {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
};

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: optionalNum('PORT', 3000),
  apiVersion: optional('API_VERSION', 'v1'),
  isProduction: process.env.NODE_ENV === 'production',

  db: {
    url: required('DATABASE_URL'),
    poolMin: optionalNum('DATABASE_POOL_MIN', 2),
    poolMax: optionalNum('DATABASE_POOL_MAX', 10),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '30d'),
  },

  otp: {
    ttlSeconds: optionalNum('OTP_TTL_SECONDS', 300),
    maxAttempts: optionalNum('OTP_MAX_ATTEMPTS', 5),
    rateLimitWindow: optionalNum('OTP_RATE_LIMIT_WINDOW', 3600),
  },

  termii: {
    apiKey: optional('TERMII_API_KEY', ''),
    senderId: optional('TERMII_SENDER_ID', 'Staxz'),
    baseUrl: optional('TERMII_BASE_URL', 'https://api.ng.termii.com'),
  },

  paystack: {
    secretKey: optional('PAYSTACK_SECRET_KEY', ''),
    publicKey: optional('PAYSTACK_PUBLIC_KEY', ''),
    webhookSecret: optional('PAYSTACK_WEBHOOK_SECRET', ''),
    platformFeePercent: optionalNum('PLATFORM_FEE_PERCENT', 15),
  },

  cloudinary: {
    cloudName: optional('CLOUDINARY_CLOUD_NAME', ''),
    apiKey: optional('CLOUDINARY_API_KEY', ''),
    apiSecret: optional('CLOUDINARY_API_SECRET', ''),
  },

  wati: {
    apiUrl: optional('WATI_API_URL', ''),
    accessToken: optional('WATI_ACCESS_TOKEN', ''),
    webhookToken: optional('WATI_WEBHOOK_TOKEN', ''),
  },

  firebase: {
    projectId: optional('FIREBASE_PROJECT_ID', ''),
    privateKey: optional('FIREBASE_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
    clientEmail: optional('FIREBASE_CLIENT_EMAIL', ''),
  },

  cac: {
    apiUrl: optional('CAC_VERIFY_API_URL', ''),
    apiKey: optional('CAC_VERIFY_API_KEY', ''),
    appId: optional('CAC_VERIFY_APP_ID', ''),
  },

  booking: {
    providerResponseTimeoutMins: optionalNum('PROVIDER_RESPONSE_TIMEOUT_MINS', 60),
    clientPaymentTimeoutMins: optionalNum('CLIENT_PAYMENT_TIMEOUT_MINS', 30),
    autoRefundAfterHours: optionalNum('AUTO_REFUND_AFTER_HOURS', 48),
    lateCancelWindowMins: optionalNum('LATE_CANCEL_WINDOW_MINS', 120),
    lateCancelFeePercent: optionalNum('LATE_CANCEL_FEE_PERCENT', 20),
  },

  cors: {
    allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:3000').split(','),
  },
};
