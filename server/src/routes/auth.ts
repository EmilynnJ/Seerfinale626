import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/db";
import { users } from "../db/schema";
import { requireAuth } from "../middleware/auth";
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

// POST /api/auth/sync — Sync Auth0 user to internal DB on first login
router.post("/sync", requireAuth, validateBody(callbackSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body;
    const [existing] = await db.select().from(users).where(eq(users.auth0Id, body.auth0Id));
    if (existing) {
      const updates: Partial<typeof users.$inferInsert> = {};
      if (body.fullName && body.fullName !== existing.fullName) updates.fullName = body.fullName;
      if (body.profileImage && body.profileImage !== existing.profileImage) updates.profileImage = body.profileImage;
      // Promote to admin if email is in admin list but role isn't admin yet
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
    const role = resolveRole(body.email);
    const [newUser] = await db.insert(users).values({
      auth0Id: body.auth0Id, email: body.email,
      fullName: body.fullName ?? null, profileImage: body.profileImage ?? null,
      role, balance: 0,
    }).returning();
    logger.info({ userId: newUser!.id, email: body.email, role }, "New user created");
    const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safeNew } = newUser!;
    res.status(201).json({ ...safeNew, accountBalance: safeNew.balance });
  } catch (err) { next(err); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const { auth0Id, stripeAccountId, stripeCustomerId, ...safeUser } = req.user;
    // Expose accountBalance as an alias for balance so the client User type
    // is satisfied regardless of which /me endpoint is called.
    res.json({ ...safeUser, accountBalance: safeUser.balance });
  } catch (err) { next(err); }
});

export default router;
