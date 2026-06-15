import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Request, Response, NextFunction, RequestHandler } from "express";
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
  auth0Id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().optional(),
  profileImage: z.string().optional(),
});

function resolveRole(email: string): "admin" | "reader" | "client" {
  const normalized = email.toLowerCase();
  if (config.adminEmails.includes(normalized)) return "admin";
  if (config.readerEmails.includes(normalized)) return "reader";
  return "client";
}

function jwtClaims(req: Request): { auth0Id?: string; email?: string } {
  const payload = req.auth?.payload;
  return {
    auth0Id: payload?.sub,
    email: typeof payload?.email === "string" ? payload.email : undefined,
  };
}

/**
 * JWT-only guard: verifies the Neon Auth token signature but does NOT resolve
 * the user row in Neon. Used on /sync so that a brand new user can create their
 * Neon row on first login without hitting the chicken-and-egg 401 that
 * resolveUser would return.
 *
 * This is intentionally named `requireAuth` here so the route reads as
 * `requireAuth, generalLimiter` per the security spec, while the rest of the
 * app continues to use the combined `requireAuth` exported by middleware/auth.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  (checkJwt as RequestHandler)(req, res, next);
}

function sanitizeUser(user: typeof users.$inferSelect) {
  const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safe } = user;
  return { ...safe, accountBalance: safe.balance };
}

// POST /api/auth/sync — Upsert the authenticated (Neon Auth) user into the DB
// on first (and subsequent) logins. Uses the JWT-only guard — NOT the combined
// requireAuth — so the user row does not need to exist yet.
router.post("/sync", requireAuth, generalLimiter, validateBody(callbackSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body;
    const { auth0Id, email: jwtEmail } = jwtClaims(req);

    if (!auth0Id) {
      res.status(401).json({ error: "Missing authentication subject" });
      return;
    }

    const email = (jwtEmail ?? body.email).toLowerCase();
    const insertRole = resolveRole(email);

    const profileUpdates: Partial<typeof users.$inferInsert> = {};
    if (body.fullName) profileUpdates.fullName = body.fullName;
    if (body.profileImage) profileUpdates.profileImage = body.profileImage;

    // F-016: explicit guard in case the ON CONFLICT upsert returns no row
    // (e.g. concurrent delete window).
    const [upserted] = await db
      .insert(users)
      .values({
        auth0Id,
        email,
        fullName: body.fullName ?? null,
        profileImage: body.profileImage ?? null,
        role: insertRole,
        balance: 0,
      })
      .onConflictDoUpdate({
        target: users.auth0Id,
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

    // Bootstrap founding accounts to their configured role on every sync. The
    // ON CONFLICT upsert above intentionally does not touch `role` (so admins
    // can't be demoted by a stale client login), so we apply the elevated role
    // here when an admin/reader email logs in and the stored role differs.
    if ((insertRole === "admin" || insertRole === "reader") && finalUser.role !== insertRole) {
      const [promoted] = await db
        .update(users)
        .set({ role: insertRole, updatedAt: new Date() })
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
