-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Row Level Security (RLS)
--
-- RLS is an ADDITIONAL enforcement layer on top of the mandatory server-side
-- role checks (build guide §14.1). The Express API connects as the table
-- owner / service role and is not constrained by these policies; they exist
-- to lock down any direct PostgREST/Realtime access made with the anon or
-- authenticated keys, so a leaked anon key can never read private data.
--
-- No INSERT/UPDATE/DELETE policies are defined: ALL writes must go through
-- the API, which validates JWTs, roles, and participants server-side.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forum_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forum_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forum_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- users: a signed-in user may read ONLY their own row. Public reader
-- browsing goes through the API, which strips private columns (email,
-- balance, Stripe ids) before responding.
CREATE POLICY "users_select_own" ON "users"
  FOR SELECT TO authenticated
  USING (supabase_id = (SELECT auth.uid()::text));--> statement-breakpoint

-- readings: only the two participants may read a reading.
CREATE POLICY "readings_select_participants" ON "readings"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "users" u
      WHERE u.id IN ("readings"."client_id", "readings"."reader_id")
        AND u.supabase_id = (SELECT auth.uid()::text)
    )
  );--> statement-breakpoint

-- transactions: only the owning user may read their ledger entries.
CREATE POLICY "transactions_select_own" ON "transactions"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "users" u
      WHERE u.id = "transactions"."user_id"
        AND u.supabase_id = (SELECT auth.uid()::text)
    )
  );--> statement-breakpoint

-- messages: only sender or recipient may read.
CREATE POLICY "messages_select_participants" ON "messages"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "users" u
      WHERE u.id IN ("messages"."sender_id", "messages"."recipient_id")
        AND u.supabase_id = (SELECT auth.uid()::text)
    )
  );--> statement-breakpoint

-- Public forum: anyone (including signed-out visitors) can read posts and
-- comments; posting/commenting/flagging goes through the API.
CREATE POLICY "forum_posts_select_public" ON "forum_posts"
  FOR SELECT TO anon, authenticated
  USING (true);--> statement-breakpoint

CREATE POLICY "forum_comments_select_public" ON "forum_comments"
  FOR SELECT TO anon, authenticated
  USING (true);
