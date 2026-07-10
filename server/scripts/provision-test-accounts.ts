/**
 * Provision the three test accounts used for QA:
 *
 *   - admin  : emilynnj14@gmail.com
 *   - reader : emilynn992@gmail.com
 *   - client : emily81292@gmail.com
 *
 * Creates the Supabase Auth users (via the Auth admin API) with the
 * caller-supplied passwords, and upserts matching rows into the `users`
 * table with the correct role and a starter balance for the client.
 *
 * Usage:
 *   cd server
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... \
 *   ADMIN_PASSWORD=... READER_PASSWORD=... CLIENT_PASSWORD=... \
 *   npx tsx scripts/provision-test-accounts.ts
 *
 * The script is idempotent — re-running it will reuse existing Supabase
 * users (updating their password to the supplied value) and update the DB
 * row instead of inserting a duplicate.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/db';
import { users } from '../src/db/schema';
import { supabaseAdminService } from '../src/services/supabase-admin';

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
  if (!supabaseAdminService.enabled) {
    console.error(
      'Supabase admin API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
    process.exit(1);
  }

  await Promise.all(SPECS.map(async (spec) => {
    console.log(`\n── [${spec.label}] ${spec.email} ─────────────────────────`);

    // 1) Create (or reuse) the Supabase Auth user with the supplied password.
    let supabaseId: string | null = null;
    try {
      const upsert = await supabaseAdminService.upsertUserWithPassword({
        email: spec.email,
        password: spec.password,
        fullName: spec.fullName,
        role: spec.label,
        username: spec.username,
      });
      supabaseId = upsert.supabaseId;
      console.log(
        `[${spec.label}] Supabase user ${upsert.created ? 'created' : 'reused (password updated)'}: ${supabaseId}`,
      );
    } catch (err) {
      console.error(`[${spec.label}] Supabase user provisioning failed:`, err);
      return;
    }

    if (!supabaseId) return;

    // 2) Upsert internal DB row with correct role/pricing/balance.
    const role = spec.label === 'admin' ? 'admin' : spec.label === 'reader' ? 'reader' : 'client';
    const [existingDb] = await db.select().from(users).where(eq(users.supabaseId, supabaseId));

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
        .values({ supabaseId, ...patch })
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
