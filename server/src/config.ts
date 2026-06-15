import './load-env';
import { z } from 'zod';

// Resolve Neon Auth configuration. Neon Auth issues JWTs that the API verifies
// against the project's JWKS endpoint. We accept either an explicit
// NEON_AUTH_JWKS_URL, or derive it from the public auth base URL
// (VITE_NEON_AUTH_URL / NEON_AUTH_URL). The auth base URL doubles as the JWT
// `issuer`. Without this the API cannot validate any logged-in request.
function pickNeonAuthEnv() {
  const env = process.env;
  const authUrl = (env.VITE_NEON_AUTH_URL || env.NEON_AUTH_URL || '')
    .trim()
    .replace(/\/$/, '');
  const jwksUrl = (
    env.NEON_AUTH_JWKS_URL ||
    (authUrl ? `${authUrl}/.well-known/jwks.json` : '')
  ).trim();
  // better-auth uses the auth base URL as the token issuer. Left empty when the
  // base URL is unknown so signature-only verification still works.
  const issuer = authUrl || '';
  return { authUrl, jwksUrl, issuer };
}

// Database alias: Vercel + Neon integrations often expose the connection string
// as NEON_DB_CONNECTION_STRING / POSTGRES_URL rather than DATABASE_URL.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.NEON_DB_CONNECTION_STRING ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    '';
}

const neonAuthResolved = pickNeonAuthEnv();
process.env.NEON_AUTH_JWKS_URL = neonAuthResolved.jwksUrl;
process.env.NEON_AUTH_URL = neonAuthResolved.authUrl;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  // Neon Auth: JWKS endpoint used to verify session JWTs. Required so the API
  // can authenticate requests minted by Neon Auth.
  NEON_AUTH_JWKS_URL: z.string().min(1),
  NEON_AUTH_URL: z.string().default(''),
  AGORA_APP_ID: z.string().default(''),
  AGORA_APP_CERTIFICATE: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // Optional: Cloudinary credentials for reader profile image uploads.
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
  // Optional: Brevo (Sendinblue) transactional email.
  BREVO_API_KEY: z.string().default(''),
  BREVO_SENDER_EMAIL: z.string().default('hello@soulseerpsychics.com'),
  BREVO_SENDER_NAME: z.string().default('SoulSeer'),
  NEWSLETTER_WELCOME_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  ADMIN_EMAILS: z.string().default('emilynnj14@gmail.com'),
  // Comma-separated emails that are bootstrapped to role=reader on their next
  // /api/auth/sync. Lets founding reader accounts come up with the right role
  // without going through admin provisioning.
  READER_EMAILS: z.string().default('emilynn992@gmail.com'),
  POSTHOG_API_KEY: z.string().default(''),
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),
  // F-009: Pendo integration key moved out of source so it can be rotated
  // without a redeploy and isolated per environment.
  PENDO_INTEGRATION_KEY: z.string().default(''),
  // F-012: Frontend URL used in transactional email templates. Falls back to
  // the configured Vercel deployment; override for custom domains.
  FRONTEND_URL: z
    .string()
    .url()
    .default('https://soulseerpsychics.vercel.app'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`\n❌ Invalid environment variables:\n${formatted}\n`);
    // Throw (instead of process.exit) so callers — notably the Vercel
    // serverless wrapper — can catch this at boot and surface the missing
    // variable names as a readable 500 response instead of an uncatchable
    // FUNCTION_INVOCATION_FAILED crash.
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  return parsed.data;
}

const env = loadConfig();

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,
  database: { url: env.DATABASE_URL },
  // Neon Auth — primary authentication provider. The API verifies incoming
  // session JWTs against `jwksUrl`.
  neonAuth: {
    authUrl: neonAuthResolved.authUrl,
    jwksUrl: env.NEON_AUTH_JWKS_URL,
    issuer: neonAuthResolved.issuer,
  },
  agora: {
    appId: env.AGORA_APP_ID,
    appCertificate: env.AGORA_APP_CERTIFICATE,
    tokenExpiration: 3600,
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    enabled: Boolean(
      env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
    ),
  },
  brevo: {
    apiKey: env.BREVO_API_KEY,
    senderEmail: env.BREVO_SENDER_EMAIL,
    senderName: env.BREVO_SENDER_NAME,
    welcomeEnabled: env.NEWSLETTER_WELCOME_ENABLED,
    enabled: Boolean(env.BREVO_API_KEY),
  },
  adminEmails: env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  readerEmails: env.READER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  posthog: {
    apiKey: env.POSTHOG_API_KEY,
    host: env.POSTHOG_HOST,
    enabled: Boolean(env.POSTHOG_API_KEY),
  },
  pendo: {
    integrationKey: env.PENDO_INTEGRATION_KEY,
    enabled: Boolean(env.PENDO_INTEGRATION_KEY),
  },
  frontendUrl: env.FRONTEND_URL,
} as const;
