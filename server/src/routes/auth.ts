import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Request } from "express";
import { getDb } from "../db/db";
import { users } from "../db/schema";
import { checkJwt } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { logger } from "../utils/logger";
import { config } from "../config";
import { AppError } from "../middleware/error-handler";
import { generalLimiter } from "../middleware/rate-limit";

const router = Router();

const callbackSchema = z.object({
  // Optional — the authoritative id/email always come from the verified JWT.
  supabaseId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  profileImage: z.string().optional(),
});

function resolveRole(email: string): "admin" | "client" {
  return config.adminEmails.includes(email.toLowerCase()) ? "admin" : "client";
}

function jwtClaims(req: Request): { supabaseId?: string; email?: string } {
  const payload = req.auth?.payload;
  return {
    supabaseId: payload?.sub,
    email: typeof payload?.email === "string" ? payload.email : undefined,
  };
}

function sanitizeUser(user: typeof users.$inferSelect) {
  const { supabaseId: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safe } = user;
  return { ...safe, accountBalance: safe.balance };
}

// POST /api/auth/sync — Upsert the Supabase Auth user into our users table on
// first (and subsequent) logins. Uses checkJwt — NOT requireAuth — so a brand
// new user can create their row without the chicken-and-egg 401 that
// resolveUser would return. Identity comes from the VERIFIED token, never
// from the request body.
router.post("/sync", checkJwt, generalLimiter, validateBody(callbackSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body;
    const { supabaseId, email: jwtEmail } = jwtClaims(req);

    if (!supabaseId) {
      res.status(401).json({ error: "Missing authentication subject" });
      return;
    }

    const email = (jwtEmail ?? body.email ?? "").toLowerCase();
    if (!email) {
      res.status(400).json({ error: "No email available for this account" });
      return;
    }
    const insertRole = resolveRole(email);

    const profileUpdates: Partial<typeof users.$inferInsert> = {};
    if (body.fullName) profileUpdates.fullName = body.fullName;
    if (body.profileImage) profileUpdates.profileImage = body.profileImage;

    // F-016: explicit guard in case the ON CONFLICT upsert returns no row
    // (e.g. concurrent delete window).
    const [upserted] = await db
      .insert(users)
      .values({
        supabaseId,
        email,
        fullName: body.fullName ?? null,
        profileImage: body.profileImage ?? null,
        role: insertRole,
        balance: 0,
      })
      .onConflictDoUpdate({
        target: users.supabaseId,
        set: {
          ...profileUpdates,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!upserted) {
      throw new Error("sync_failed");
    }

    let finalUser = upserted;

    if (insertRole === "admin" && finalUser.role !== "admin") {
      const [promoted] = await db
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(users.id, finalUser.id))
        .returning();
      if (!promoted) {
        throw new AppError(500, "promote_returned_no_row");
      }
      finalUser = promoted;
    }

    logger.info({ userId: finalUser.id, email, role: finalUser.role }, "User synced via upsert");
    res.json(sanitizeUser(finalUser));
  } catch (err) {
    next(err);
  }
});


export default router;
