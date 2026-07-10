import './load-env';
import { z } from 'zod';

// ─── Supabase env aliases ────────────────────────────────────────────────────
// Deployments may set the client-style VITE_SUPABASE_* names only; the server
// accepts those as fallbacks so a single set of env vars works everywhere.
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
}
if (!process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    '';
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY || '';
}

// Database alias: the connection string may be exposed under several names
// (Supabase dashboard, Vercel integration, generic Postgres). All persistent
// data lives in Supabase Postgres — this is the ONLY database provider.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    '';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),

  // ── Supabase (database + auth) ─────────────────────────────────────────────
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().default(''),
  // Service-role key: server-only, used for the Auth admin API (reader account
  // provisioning). NEVER exposed to the client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  // HS256 legacy JWT secret. When set, access tokens are verified locally with
  // it; otherwise the JWKS endpoint (asymmetric keys) is used.
  SUPABASE_JWT_SECRET: z.string().default(''),
  SUPABASE_JWKS_URL: z.string().default(''),

  // ── Cloudflare Realtime (SFU + TURN + MoQ) ────────────────────────────────
  // Replaces Agora for ALL real-time communication. App credentials stay on
  // the server; clients get short-lived, server-mediated session access only.
  CLOUDFLARE_REALTIME_APP_ID: z.string().default(''),
  CLOUDFLARE_REALTIME_TOKEN: z.string().default(''),
  CLOUDFLARE_REALTIME_BASE_URL: z
    .string()
    .default('https://rtc.live.cloudflare.com/v1'),
  // Cloudflare Calls TURN service (NAT traversal).
  CLOUDFLARE_TURN_KEY_ID: z.string().default(''),
  CLOUDFLARE_TURN_API_TOKEN: z.string().default(''),
  // MoQ (Media over QUIC) relay for chat-type real-time data transport.
  CLOUDFLARE_MOQ_RELAY_URL: z.string().default(''),

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

const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, '');

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,
  database: { url: env.DATABASE_URL },
  supabase: {
    url: supabaseUrl,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET,
    jwksUrl:
      env.SUPABASE_JWKS_URL ||
      (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : ''),
    issuer: supabaseUrl ? `${supabaseUrl}/auth/v1` : '',
    adminEnabled: Boolean(supabaseUrl && env.SUPABASE_SERVICE_ROLE_KEY),
  },
  realtime: {
    appId: env.CLOUDFLARE_REALTIME_APP_ID,
    appToken: env.CLOUDFLARE_REALTIME_TOKEN,
    baseUrl: env.CLOUDFLARE_REALTIME_BASE_URL.replace(/\/$/, ''),
    turnKeyId: env.CLOUDFLARE_TURN_KEY_ID,
    turnApiToken: env.CLOUDFLARE_TURN_API_TOKEN,
    moqRelayUrl: env.CLOUDFLARE_MOQ_RELAY_URL,
    // Short-lived session access issued by the server, per build guide: 1 hour.
    tokenExpiration: 3600,
    enabled: Boolean(env.CLOUDFLARE_REALTIME_APP_ID && env.CLOUDFLARE_REALTIME_TOKEN),
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
  adminEmails: env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()),
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
