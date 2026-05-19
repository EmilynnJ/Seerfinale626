import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getDb } from "../db/db";
import { users } from "../db/schema";
import { requireAuth, checkJwt } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { logger } from "../utils/logger";
import { config } from "../config";

const router = Router();

const callbackSchema = z.object({
  auth0Id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().optional(),
  profileImage: z.string().url().optional(),
});

function resolveRole(email: string): "admin" | "client" {
  return config.adminEmails.includes(email.toLowerCase()) ? "admin" : "client";
}

/**
 * JWT-only guard: verifies the Auth0 token signature and audience but does
 * NOT require the user row to exist in Neon. Used on /sync so that a brand
 * new user can create their Neon row on first login without hitting the
 * chicken-and-egg 401 that resolveUser would return.
 *
 * The auth0Id used for the upsert is always taken from req.auth.payload.sub
 * (the verified JWT claim) — never from the request body — so a client
 * cannot forge a sync for a different user's record.
 */
function jwtOnly(req: Request, res: Response, next: NextFunction): void {
  (checkJwt as RequestHandler)(req, res, next);
}

// POST /api/auth/sync — Upsert Auth0 user into Neon on first (and subsequent) logins.
// Uses jwtOnly — NOT requireAuth — so the user row does not need to exist yet.
router.post("/sync", jwtOnly, validateBody(callbackSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body;

    // Always use the sub from the verified JWT as the authoritative auth0Id.
    // This prevents a client from syncing a different user's record.
    const auth0Id = req.auth?.payload?.sub;
    if (!auth0Id) {
      res.status(401).json({ error: "Missing authentication subject" });
      return;
    }

    const [existing] = await db.select().from(users).where(eq(users.auth0Id, auth0Id));
    if (existing) {
      const updates: Partial<typeof users.$inferInsert> = {};
      if (body.fullName && body.fullName !== existing.fullName) updates.fullName = body.fullName;
      if (body.profileImage && body.profileImage !== existing.profileImage) updates.profileImage = body.profileImage;
      const expectedRole = resolveRole(existing.email);
      if (expectedRole === "admin" && existing.role !== "admin") {
        updates.role = "admin";
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        const [updated] = await db.update(users).set(updates).where(eq(users.id, existing.id)).returning();
        const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safeUp } = updated!;
        res.json({ ...safeUp, accountBalance: safeUp.balance });
      } else {
        const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safeEx } = existing;
        res.json({ ...safeEx, accountBalance: safeEx.balance });
      }
      return;
    }

    // New user — create the Neon row using the verified JWT sub as auth0Id.
    const role = resolveRole(body.email);
    const [newUser] = await db.insert(users).values({
      auth0Id,
      email: body.email,
      fullName: body.fullName ?? null,
      profileImage: body.profileImage ?? null,
      role,
      balance: 0,
    }).returning();
    logger.info({ userId: newUser!.id, email: body.email, role }, "New user created via sync");
    const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safeNew } = newUser!;
    res.status(201).json({ ...safeNew, accountBalance: safeNew.balance });
  } catch (err) { next(err); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const { auth0Id, stripeAccountId, stripeCustomerId, ...safeUser } = req.user;
    res.json({ ...safeUser, accountBalance: safeUser.balance });
  } catch (err) { next(err); }
});

export default router;
