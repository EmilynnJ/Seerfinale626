import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { getDb } from "../db/db";
import { users } from "../db/schema";
import { requireAuth, checkJwt } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { logger } from "../utils/logger";
import { config } from "../config";

const router = Router();

const DEBUG_LOG_PATHS = [
  resolve(__dirname, "../../../debug-f0e72b.log"),
  resolve(process.cwd(), "debug-f0e72b.log"),
  resolve(process.cwd(), "../debug-f0e72b.log"),
];

function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  const line = `${JSON.stringify({
    sessionId: "f0e72b",
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
    runId: "post-fix",
  })}\n`;
  for (const logPath of DEBUG_LOG_PATHS) {
    try {
      appendFileSync(logPath, line);
      return;
    } catch {
      /* try next path */
    }
  }
}

const callbackSchema = z.object({
  auth0Id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().optional(),
  profileImage: z.string().optional(),
});

function resolveRole(email: string): "admin" | "client" {
  return config.adminEmails.includes(email.toLowerCase()) ? "admin" : "client";
}

function jwtClaims(req: Request): { auth0Id?: string; email?: string } {
  const payload = req.auth?.payload;
  return {
    auth0Id: payload?.sub,
    email: typeof payload?.email === "string" ? payload.email : undefined,
  };
}

/**
 * JWT-only guard: verifies the Auth0 token signature and audience but does
 * NOT require the user row to exist in Neon. Used on /sync so that a brand
 * new user can create their Neon row on first login without hitting the
 * chicken-and-egg 401 that resolveUser would return.
 */
function jwtOnly(req: Request, res: Response, next: NextFunction): void {
  (checkJwt as RequestHandler)(req, res, next);
}

function sanitizeUser(user: typeof users.$inferSelect) {
  const { auth0Id: _a, stripeAccountId: _s, stripeCustomerId: _sc, ...safe } = user;
  return { ...safe, accountBalance: safe.balance };
}

// POST /api/auth/sync — Upsert Auth0 user into Neon on first (and subsequent) logins.
// Uses jwtOnly — NOT requireAuth — so the user row does not need to exist yet.
router.post("/sync", jwtOnly, validateBody(callbackSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body;
    const { auth0Id, email: jwtEmail } = jwtClaims(req);

    // #region agent log
    debugLog("auth.ts:sync:entry", "POST /sync reached (jwtOnly, no resolveUser)", {
      hasAuth0Id: !!auth0Id,
      hasJwtEmail: !!jwtEmail,
    }, "A");
    // #endregion

    if (!auth0Id) {
      res.status(401).json({ error: "Missing authentication subject" });
      return;
    }

    const email = (jwtEmail ?? body.email).toLowerCase();
    const insertRole = resolveRole(email);

    const profileUpdates: Partial<typeof users.$inferInsert> = {};
    if (body.fullName) profileUpdates.fullName = body.fullName;
    if (body.profileImage) profileUpdates.profileImage = body.profileImage;

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

    let finalUser = upserted!;

    if (insertRole === "admin" && finalUser.role !== "admin") {
      const [promoted] = await db
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(users.id, finalUser.id))
        .returning();
      finalUser = promoted!;
    }

    // #region agent log
    debugLog("auth.ts:sync:exit", "POST /sync upsert complete", {
      userId: finalUser.id,
      role: finalUser.role,
    }, "A");
    // #endregion

    logger.info({ userId: finalUser.id, email, role: finalUser.role }, "User synced via upsert");
    res.json(sanitizeUser(finalUser));
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { auth0Id, stripeAccountId, stripeCustomerId, ...safeUser } = req.user;
    res.json({ ...safeUser, accountBalance: safeUser.balance });
  } catch (err) {
    next(err);
  }
});

export default router;
