/**
 * Provision the three test accounts used for QA:
 *
 *   - admin  : emilynnj14@gmail.com
 *   - reader : emilynn992@gmail.com
 *   - client : emily81292@gmail.com
 *
 * Creates the Neon Auth users (via the hosted sign-up endpoint) with the
 * caller-supplied passwords, and upserts matching rows into the `users` table
 * with the correct role and a starter balance for the client.
 *
 * Usage:
 *   cd server
 *   VITE_NEON_AUTH_URL=... NEON_AUTH_JWKS_URL=... DATABASE_URL=... \
 *   ADMIN_PASSWORD=... READER_PASSWORD=... CLIENT_PASSWORD=... \
 *   npx tsx scripts/provision-test-accounts.ts
 *
 * The script is idempotent on the DB side — re-running updates the existing
 * row. Note: Neon Auth users that already exist cannot have their password
 * reset from the server; reset those from the Neon Auth dashboard if needed.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/db';
import { users } from '../src/db/schema';
import { neonAuthAdminService } from '../src/services/neon-auth-admin';

interface AccountSpec {
  label: 'admin' | 'reader' | 'client';
  email: string;
  password: string;
  fullName: string;
  username: string;
  startingBalanceCents?: number;
  pricing?: { chat: number; voice: number; video: number };
  bio?: string;
  specialties?: string;
}

const SPECS: AccountSpec[] = [
  {
    label: 'admin',
    email: 'emilynnj14@gmail.com',
    password: required('ADMIN_PASSWORD'),
    fullName: 'Emilynn (Admin)',
    username: 'emilynn-admin',
  },
  {
    label: 'reader',
    email: 'emilynn992@gmail.com',
    password: required('READER_PASSWORD'),
    fullName: 'Emilynn',
    username: 'emilynn',
    pricing: { chat: 299, voice: 399, video: 499 },
    bio: 'Test reader account for QA.',
    specialties: 'Tarot, Clairvoyance, Mediumship',
  },
  {
    label: 'client',
    email: 'emily81292@gmail.com',
    password: required('CLIENT_PASSWORD'),
    fullName: 'Emily',
    username: 'emily',
    startingBalanceCents: 5000, // $50 starter balance for smoke-testing
  },
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  if (!neonAuthAdminService.enabled) {
    console.error(
      'Neon Auth is not configured. Set VITE_NEON_AUTH_URL (or NEON_AUTH_URL).',
    );
    process.exit(1);
  }

  await Promise.all(SPECS.map(async (spec) => {
    console.log(`\n── [${spec.label}] ${spec.email} ─────────────────────────`);

    // 1) Create (or reuse) the Neon Auth user.
    let neonUserId: string | null = null;
    try {
      const created = await neonAuthAdminService.upsertUserWithPassword({
        email: spec.email,
        password: spec.password,
        fullName: spec.fullName,
        role: spec.label,
        username: spec.username,
      });
      neonUserId = created.auth0Id;
      console.log(`[${spec.label}] Neon Auth user created: ${neonUserId}`);
    } catch (err) {
      // Existing Neon Auth users can't be resolved/reset from the server.
      // Fall back to the DB row (matched by email) so role/pricing still sync.
      console.warn(`[${spec.label}] Neon Auth sign-up skipped:`, (err as Error).message);
      const [existingByEmail] = await db
        .select({ auth0Id: users.auth0Id })
        .from(users)
        .where(eq(users.email, spec.email));
      neonUserId = existingByEmail?.auth0Id ?? null;
      if (!neonUserId) {
        console.error(
          `[${spec.label}] No existing DB row to update; have ${spec.email} sign up via the app first.`,
        );
        return;
      }
      console.log(`[${spec.label}] Using existing Neon Auth user id from DB: ${neonUserId}`);
    }

    if (!neonUserId) return;

    // 2) Upsert internal DB row with correct role/pricing/balance.
    const role = spec.label === 'admin' ? 'admin' : spec.label === 'reader' ? 'reader' : 'client';
    const [existingDb] = await db.select().from(users).where(eq(users.auth0Id, neonUserId));

    const patch = {
      email: spec.email,
      username: spec.username,
      fullName: spec.fullName,
      role,
      bio: spec.bio ?? null,
      specialties: spec.specialties ?? null,
      pricingChat: spec.pricing?.chat ?? 0,
      pricingVoice: spec.pricing?.voice ?? 0,
      pricingVideo: spec.pricing?.video ?? 0,
      balance: spec.startingBalanceCents ?? 0,
      updatedAt: new Date(),
    } as const;

    if (existingDb) {
      await db.update(users).set(patch).where(eq(users.id, existingDb.id));
      console.log(`[${spec.label}] DB row updated (id=${existingDb.id}, role=${role})`);
    } else {
      const [inserted] = await db
        .insert(users)
        .values({ auth0Id: neonUserId, ...patch })
        .returning({ id: users.id });
      console.log(`[${spec.label}] DB row inserted (id=${inserted?.id}, role=${role})`);
    }
  }));

  console.log('\nDone. All accounts provisioned.');
  await pool.end();
}

main().catch((err) => {
  console.error('\nProvisioning failed:', err);
  void pool.end().finally(() => process.exit(1));
});
