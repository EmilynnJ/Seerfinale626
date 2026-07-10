/**
 * Manual admin seed (build guide §5.1 — admin accounts are a manual DB seed).
 *
 * Creates (or reuses) the Supabase Auth user for the admin email and upserts
 * the matching `users` row with role=admin.
 *
 * Usage:
 *   cd server
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... \
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NAME="..."] \
 *   npx tsx scripts/seed-admin.ts
 *
 * Idempotent: re-running updates the password and re-asserts role=admin.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/db';
import { users } from '../src/db/schema';
import { supabaseAdminService } from '../src/services/supabase-admin';

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

  const email = required('ADMIN_EMAIL').toLowerCase();
  const password = required('ADMIN_PASSWORD');
  const fullName = process.env.ADMIN_NAME || 'SoulSeer Admin';

  const { supabaseId, created } = await supabaseAdminService.upsertUserWithPassword({
    email,
    password,
    fullName,
    role: 'admin',
  });
  console.log(`Supabase Auth user ${created ? 'created' : 'reused (password updated)'}: ${supabaseId}`);

  const [existing] = await db.select().from(users).where(eq(users.supabaseId, supabaseId));
  if (existing) {
    await db
      .update(users)
      .set({ email, fullName, role: 'admin', updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    console.log(`users row updated (id=${existing.id}) — role=admin`);
  } else {
    const [inserted] = await db
      .insert(users)
      .values({ supabaseId, email, fullName, role: 'admin' })
      .returning({ id: users.id });
    console.log(`users row inserted (id=${inserted?.id}) — role=admin`);
  }

  console.log('Admin seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Admin seed failed:', err);
  void pool.end().finally(() => process.exit(1));
});
