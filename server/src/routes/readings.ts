import { Router } from "express";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/db";
import { users, readings, transactions } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { requireParticipant } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { RealtimeService } from "../services/realtime-service";
import { wsService } from "../services/websocket-service";
import { billingService } from "../services/billing-service";
import { logger } from "../utils/logger";
import { pendoTrack } from "../services/pendo-track";
import { strictLimiter } from "../middleware/rate-limit";

const router = Router();

const MIN_BALANCE_CENTS = 500;

// ─── POST /api/readings/on-demand — Client creates reading request ──────────
const onDemandSchema = z.object({
  readerId: z.number().int().positive(),
  readingType: z.enum(["chat", "voice", "video"]),
});

router.post(
  "/on-demand",
  requireAuth,
  strictLimiter,
  validateBody(onDemandSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const { readerId, readingType } = req.body;

      // Cannot read for yourself
      if (readerId === req.user!.id) {
        res.status(400).json({ error: "Cannot read for yourself" });
        return;
      }

      // Must be a client
      if (req.user!.role !== "client" && req.user!.role !== "admin") {
        res.status(403).json({ error: "Only clients can request readings" });
        return;
      }

      // Verify reader exists and is online
      const [reader] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, readerId), eq(users.role, "reader")));

      if (!reader) {
        res.status(404).json({ error: "Reader not found" });
        return;
      }
      if (!reader.isOnline) {
        res.status(409).json({ error: "Reader is offline" });
        return;
      }

      // Check pricing exists for this type
      const rateKey =
        readingType === "chat"
          ? "pricingChat"
          : readingType === "voice"
            ? "pricingVoice"
            : "pricingVideo";
      const ratePerMinute = reader[rateKey];

      if (!ratePerMinute || ratePerMinute <= 0) {
        res
          .status(400)
          .json({ error: `Reader has no ${readingType} pricing set` });
        return;
      }

      // Check minimum balance
      if (req.user!.balance < MIN_BALANCE_CENTS) {
        res.status(402).json({
          error: `Minimum balance $${(MIN_BALANCE_CENTS / 100).toFixed(2)} required`,
          code: "INSUFFICIENT_BALANCE",
        });
        return;
      }

      // Create reading record, then stamp the unique Realtime channel name
      // (reading_[readingId] per build guide) once the id is known.
      const [inserted] = await db
        .insert(readings)
        .values({
          clientId: req.user!.id,
          readerId,
          readingType,
          ratePerMinute,
          status: "pending",
        })
        .returning();

      const [reading] = await db
        .update(readings)
        .set({ rtcChannel: `reading_${inserted!.id}` })
        .where(eq(readings.id, inserted!.id))
        .returning();

      // Notify reader via WebSocket
      wsService.send(readerId, "reading:new_request", {
        readingId: reading!.id,
        clientId: req.user!.id,
        readingType,
        clientName: req.user!.fullName ?? "Client",
      });

      logger.info(
        { readingId: reading!.id, clientId: req.user!.id, readerId, readingType },
        "Reading request created",
      );

      pendoTrack("reading_requested", req.user!.id, "system", {
        readingId: reading!.id,
        clientId: req.user!.id,
        readerId,
        readingType,
        ratePerMinute,
        clientBalance: req.user!.balance,
      });

      res.status(201).json({ reading });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /api/readings/reader/pending — Reader's pending incoming requests ──
router.get("/reader/pending", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    if (req.user!.role !== "reader" && req.user!.role !== "admin") {
      res.status(403).json({ error: "Reader access required" });
      return;
    }
    const result = await db
      .select({
        id: readings.id,
        clientId: readings.clientId,
        readingType: readings.readingType,
        ratePerMinute: readings.ratePerMinute,
        status: readings.status,
        createdAt: readings.createdAt,
        clientName: users.fullName,
        clientUsername: users.username,
        clientAvatar: users.profileImage,
      })
      .from(readings)
      .innerJoin(users, eq(readings.clientId, users.id))
      .where(and(eq(readings.readerId, req.user!.id), eq(readings.status, "pending")))
      .orderBy(desc(readings.createdAt));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/readings/:id/decline — Reader declines request ───────────────
router.post("/:id/decline", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const readingId = parseInt(req.params.id!, 10);

    if (isNaN(readingId)) {
      res.status(400).json({ error: "Invalid reading ID" });
      return;
    }

    const [reading] = await db
      .select()
      .from(readings)
      .where(
        and(
          eq(readings.id, readingId),
          eq(readings.readerId, req.user!.id),
          eq(readings.status, "pending"),
        ),
      );

    if (!reading) {
      res.status(404).json({ error: "Reading not found or not pending" });
      return;
    }

    const now = new Date();
    await db
      .update(readings)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(readings.id, readingId));

    wsService.send(reading.clientId, "reading:cancelled", {
      readingId,
      reason: "reader_declined",
    });

    logger.info({ readingId }, "Reading declined by reader");

    pendoTrack("reading_declined", req.user!.id, "system", {
      readingId,
      readerId: req.user!.id,
      clientId: reading.clientId,
      readingType: reading.readingType,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/readings/:id/accept — Reader accepts request ─────────────────
router.post("/:id/accept", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const readingId = parseInt(req.params.id!, 10);

    if (isNaN(readingId)) {
      res.status(400).json({ error: "Invalid reading ID" });
      return;
    }

    const [reading] = await db
      .select()
      .from(readings)
      .where(
        and(
          eq(readings.id, readingId),
          eq(readings.readerId, req.user!.id),
          eq(readings.status, "pending"),
        ),
      );

    if (!reading) {
      res.status(404).json({ error: "Reading not found or not pending" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(readings)
      .set({ status: "accepted", updatedAt: now })
      .where(eq(readings.id, readingId))
      .returning();

    // Notify client that the reading was accepted
    wsService.send(reading.clientId, "reading:accepted", {
      readingId,
      rtcChannel: reading.rtcChannel,
    });

    logger.info({ readingId }, "Reading accepted by reader");

    const responseTimeSeconds = Math.round(
      (now.getTime() - new Date(reading.createdAt).getTime()) / 1000,
    );
    pendoTrack("reading_accepted", req.user!.id, "system", {
      readingId,
      readerId: req.user!.id,
      clientId: reading.clientId,
      readingType: reading.readingType,
      responseTimeSeconds,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Cloudflare Realtime session access & SFU proxy ─────────────────────────
// Replaces the old /:id/agora-token endpoint. All Cloudflare API calls are
// made server-side with the app token; the client only ever receives
// short-lived ICE credentials and proxied SFU responses. Participant-only,
// auth-gated, and the reading must exist and be joinable.

function assertJoinable(reading: { status: string }): boolean {
  return (
    reading.status === "accepted" ||
    reading.status === "in_progress" ||
    reading.status === "active" ||
    reading.status === "paused"
  );
}

// POST /api/readings/:id/rtc-session — session bootstrap (channel + ICE + MoQ)
router.post(
  "/:id/rtc-session",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const reading = req.reading!;

      if (!assertJoinable(reading)) {
        res.status(409).json({ error: "Reading is not in a joinable state" });
        return;
      }

      const access = await RealtimeService.buildSessionAccess(reading.id);
      res.json({
        ...access,
        readingId: reading.id,
        role: req.user!.id === reading.clientId ? "client" : "reader",
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/readings/:id/rtc/sessions/new — create an SFU session
router.post(
  "/:id/rtc/sessions/new",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      if (!assertJoinable(req.reading!)) {
        res.status(409).json({ error: "Reading is not in a joinable state" });
        return;
      }
      const result = await RealtimeService.sfuRequest("POST", "sessions/new", req.body);
      res.status(result.status).json(result.body ?? {});
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/readings/:id/rtc/sessions/:sessionId/tracks/new — push/pull tracks
router.post(
  "/:id/rtc/sessions/:sessionId/tracks/new",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      if (!assertJoinable(req.reading!)) {
        res.status(409).json({ error: "Reading is not in a joinable state" });
        return;
      }
      const sessionId = encodeURIComponent(req.params.sessionId!);
      const result = await RealtimeService.sfuRequest(
        "POST",
        `sessions/${sessionId}/tracks/new`,
        req.body,
      );
      res.status(result.status).json(result.body ?? {});
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/readings/:id/rtc/sessions/:sessionId/renegotiate — SDP renegotiation
router.put(
  "/:id/rtc/sessions/:sessionId/renegotiate",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const sessionId = encodeURIComponent(req.params.sessionId!);
      const result = await RealtimeService.sfuRequest(
        "PUT",
        `sessions/${sessionId}/renegotiate`,
        req.body,
      );
      res.status(result.status).json(result.body ?? {});
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/readings/:id/rtc/sessions/:sessionId/tracks/close — close tracks
router.put(
  "/:id/rtc/sessions/:sessionId/tracks/close",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const sessionId = encodeURIComponent(req.params.sessionId!);
      const result = await RealtimeService.sfuRequest(
        "PUT",
        `sessions/${sessionId}/tracks/close`,
        req.body,
      );
      res.status(result.status).json(result.body ?? {});
    } catch (err) {
      next(err);
    }
  },
);

// ─── RTC signaling: announce published tracks / discover the peer's ─────────
const announceSchema = z.object({
  sessionId: z.string().min(1).max(255),
  tracks: z
    .array(
      z.object({
        trackName: z.string().min(1).max(255),
        kind: z.enum(["audio", "video"]),
      }),
    )
    .max(4),
});

// POST /api/readings/:id/rtc/announce — publish my session id + track names
router.post(
  "/:id/rtc/announce",
  requireAuth,
  requireParticipant,
  validateBody(announceSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const reading = req.reading!;
      const role = req.user!.id === reading.clientId ? "client" : "reader";

      const currentState =
        (reading.rtcState as Record<string, unknown> | null) ?? {};
      const nextState = {
        ...currentState,
        [role]: {
          sessionId: req.body.sessionId,
          tracks: req.body.tracks,
          userId: req.user!.id,
          updatedAt: Date.now(),
        },
      };

      await db
        .update(readings)
        .set({ rtcState: nextState, updatedAt: new Date() })
        .where(eq(readings.id, reading.id));

      // Push the announcement to the other participant so they can pull
      // the new tracks immediately (polling GET /rtc/peers is the fallback).
      const otherUserId =
        role === "client" ? reading.readerId : reading.clientId;
      wsService.send(otherUserId, "reading:rtc_peer", {
        readingId: reading.id,
        peer: nextState[role],
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/readings/:id/rtc/peers — the other participant's announced tracks
router.get(
  "/:id/rtc/peers",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const db = getDb();
      const reading = req.reading!;
      // Re-read: req.reading may be stale relative to a just-announced peer.
      const [fresh] = await db
        .select({ rtcState: readings.rtcState })
        .from(readings)
        .where(eq(readings.id, reading.id));

      const state = (fresh?.rtcState as Record<string, unknown> | null) ?? {};
      const myRole = req.user!.id === reading.clientId ? "client" : "reader";
      const peerRole = myRole === "client" ? "reader" : "client";

      res.json({ peer: state[peerRole] ?? null, self: state[myRole] ?? null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/readings/:id/start — Both joined, start billing ──────────────
router.post(
  "/:id/start",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const db = getDb();
      const reading = req.reading!;

      // Only start billing if reading is in accepted state
      if (reading.status !== "accepted" && reading.status !== "in_progress") {
        // If already active, just acknowledge
        if (reading.status === "active") {
          res.json({ message: "Billing already started", readingId: reading.id });
          return;
        }
        res
          .status(409)
          .json({ error: "Reading is not in a startable state" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(readings)
        .set({
          status: "active",
          startedAt: now,
          lastHeartbeat: now,
          updatedAt: now,
        })
        .where(eq(readings.id, reading.id))
        .returning();

      // Notify both participants
      wsService.broadcast(
        [reading.clientId, reading.readerId],
        "reading:started",
        { readingId: reading.id },
      );

      logger.info(
        { readingId: reading.id, clientId: reading.clientId, readerId: reading.readerId },
        "Reading session started, billing active",
      );

      pendoTrack("reading_session_started", req.user!.id, "system", {
        readingId: reading.id,
        clientId: reading.clientId,
        readerId: reading.readerId,
        readingType: reading.readingType,
        ratePerMinute: reading.ratePerMinute,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/readings/:id/heartbeat — Keep alive + drive per-minute billing ─
router.post(
  "/:id/heartbeat",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const reading = req.reading!;

      if (
        reading.status !== "active" &&
        reading.status !== "paused" &&
        reading.status !== "accepted" &&
        reading.status !== "in_progress"
      ) {
        res.status(409).json({ error: "Reading is not active" });
        return;
      }

      // Server-authoritative billing: charge any whole minutes elapsed since the
      // last settle, finalize on insufficient balance, and refresh liveness.
      // This is what replaces the old Vercel cron — billing advances on the
      // heartbeat both participants already send every ~30s.
      const snapshot = await billingService.onHeartbeat(reading.id);

      res.json({ ok: true, billing: snapshot });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/readings/:id/end — End session, finalize billing ─────────────
router.post(
  "/:id/end",
  requireAuth,
  requireParticipant,
  async (req, res, next) => {
    try {
      const db = getDb();
      const reading = req.reading!;

      if (
        reading.status !== "active" &&
        reading.status !== "paused" &&
        reading.status !== "in_progress" &&
        reading.status !== "accepted"
      ) {
        res.status(409).json({ error: "Reading is not active" });
        return;
      }

      // Charge any final whole minutes accrued since the last heartbeat settle,
      // and finalize on insufficient balance, BEFORE we close the record. After
      // this the DB holds authoritative billing totals. Call settle()
      // unconditionally rather than gating on the (possibly stale) req.reading
      // snapshot — settle() re-reads the row FOR UPDATE and only charges when it
      // is genuinely active, so gating here risks skipping the final charge and
      // undercharging the session.
      await billingService.settle(reading.id);

      // CRITICAL: Re-fetch the reading inside the transaction to get the latest
      // billing-accumulated totals. Do NOT recalculate charges from elapsed time
      // -- the heartbeat settle has already deducted per-minute charges. We only
      // finalize the record and credit the reader here.

      const now = new Date();

      let finalReading: any;

      await db.transaction(async (tx) => {
        // Re-read the reading with latest accumulated billing totals
        const [fresh] = await tx
          .select()
          .from(readings)
          .where(eq(readings.id, reading.id))
          .for("update");

        if (!fresh) throw new Error("Reading not found");

        // Prevent double-finalization (heartbeat sweep or insufficient-balance
        // termination may have already completed it).
        if (
          fresh.status === "completed" ||
          fresh.status === "cancelled" ||
          fresh.status === "missed"
        ) {
          finalReading = fresh;
          return;
        }

        // Billed seconds are the source of truth for the final duration — the
        // settle pass above already rounded to whole billed minutes.
        const durationSeconds = fresh.durationSeconds;

        // Use the already-accumulated totals from the heartbeat settles.
        // These were charged incrementally each minute -- do NOT re-charge.
        const totalCharged = fresh.totalCharged;
        const readerEarned = fresh.readerEarned;
        const platformEarned = fresh.platformEarned;

        // Finalize the reading record
        await tx
          .update(readings)
          .set({
            status: "completed",
            completedAt: now,
            durationSeconds,
            paymentStatus: totalCharged > 0 ? "paid" : "pending",
            updatedAt: now,
          })
          .where(eq(readings.id, reading.id));

        // Credit reader balance (billing service deducted from client but
        // credits the reader only at session end via endReading)
        if (readerEarned > 0) {
          const [readerBefore] = await tx
            .select({ balance: users.balance })
            .from(users)
            .where(eq(users.id, fresh.readerId));
          const readerBalanceBefore = readerBefore?.balance ?? 0;

          const [readerAfter] = await tx
            .update(users)
            .set({
              balance: sql`${users.balance} + ${readerEarned}`,
              totalReadings: sql`${users.totalReadings} + 1`,
              updatedAt: now,
            })
            .where(eq(users.id, fresh.readerId))
            .returning({ balance: users.balance });

          await tx.insert(transactions).values({
            userId: fresh.readerId,
            readingId: fresh.id,
            type: "reader_payout",
            amount: readerEarned,
            balanceBefore: readerBalanceBefore,
            balanceAfter: readerAfter!.balance,
            note: `Earned from reading #${fresh.id}`,
          });
        }

        // Record the client charge transaction (amount was already deducted
        // by billing service ticks, this is just the ledger entry)
        if (totalCharged > 0) {
          const [clientNow] = await tx
            .select({ balance: users.balance })
            .from(users)
            .where(eq(users.id, fresh.clientId));

          await tx.insert(transactions).values({
            userId: fresh.clientId,
            readingId: fresh.id,
            type: "reading_charge",
            amount: -totalCharged,
            balanceBefore: (clientNow?.balance ?? 0) + totalCharged,
            balanceAfter: clientNow?.balance ?? 0,
            note: `Reading #${fresh.id}: ${Math.ceil(durationSeconds / 60)} min`,
          });
        }

        finalReading = {
          ...fresh,
          status: "completed",
          completedAt: now,
          durationSeconds,
          totalCharged,
          readerEarned,
          platformEarned,
        };
      });

      const r = finalReading;

      // Notify both participants
      wsService.broadcast(
        [reading.clientId, reading.readerId],
        "reading:ended",
        {
          readingId: reading.id,
          durationSeconds: r.durationSeconds,
          totalCharged: r.totalCharged,
          readerEarned: r.readerEarned,
        },
      );

      logger.info(
        {
          readingId: reading.id,
          durationSeconds: r.durationSeconds,
          totalCharged: r.totalCharged,
          readerEarned: r.readerEarned,
          platformEarned: r.platformEarned,
        },
        "Reading ended and billing finalized",
      );

      pendoTrack("reading_session_completed", req.user!.id, "system", {
        readingId: reading.id,
        clientId: reading.clientId,
        readerId: reading.readerId,
        readingType: reading.readingType,
        durationSeconds: r.durationSeconds,
        totalCharged: r.totalCharged,
        readerEarned: r.readerEarned,
        platformEarned: r.platformEarned,
        ratePerMinute: reading.ratePerMinute,
      });

      res.json({
        readingId: reading.id,
        durationSeconds: r.durationSeconds,
        totalCharged: r.totalCharged,
        readerEarned: r.readerEarned,
        platformEarned: r.platformEarned,
        duration: r.durationSeconds,
        totalCost: r.totalCharged,
        ratePerMinute: reading.ratePerMinute,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/readings/:id/rate — Submit rating and review ─────────────────
const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(2000).optional(),
});

router.post(
  "/:id/rate",
  requireAuth,
  validateBody(rateSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const readingId = parseInt(req.params.id!, 10);
      if (isNaN(readingId)) {
        res.status(400).json({ error: "Invalid reading ID" });
        return;
      }

      const { rating, review } = req.body;

      const [reading] = await db
        .select()
        .from(readings)
        .where(
          and(
            eq(readings.id, readingId),
            eq(readings.clientId, req.user!.id),
            eq(readings.status, "completed"),
          ),
        );

      if (!reading) {
        res.status(404).json({ error: "Completed reading not found" });
        return;
      }

      if (reading.rating !== null) {
        res.status(409).json({ error: "Reading already rated" });
        return;
      }

      const [updated] = await db
        .update(readings)
        .set({ rating, review: review || null, updatedAt: new Date() })
        .where(eq(readings.id, readingId))
        .returning();

      pendoTrack("reading_review_submitted", req.user!.id, "system", {
        readingId,
        clientId: req.user!.id,
        readerId: reading.readerId,
        rating,
        hasReviewText: !!review,
        readingType: reading.readingType,
        durationSeconds: reading.durationSeconds,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/readings/:id/message — Send chat message ─────────────────────
const messageSchema = z.object({
  content: z.string().min(1).max(5000),
});

router.post(
  "/:id/message",
  requireAuth,
  requireParticipant,
  validateBody(messageSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const reading = req.reading!;

      if (reading.readingType !== "chat") {
        res.status(400).json({ error: "Messages only for chat readings" });
        return;
      }

      if (reading.status !== "active" && reading.status !== "in_progress") {
        res.status(409).json({ error: "Reading is not active" });
        return;
      }

      const message = {
        senderId: req.user!.id,
        content: req.body.content,
        timestamp: Date.now(),
      };

      // Append message to chat transcript
      const currentTranscript = (reading.chatTranscript as any[]) ?? [];
      currentTranscript.push(message);

      await db
        .update(readings)
        .set({
          chatTranscript: currentTranscript,
          updatedAt: new Date(),
        })
        .where(eq(readings.id, reading.id));

      // Notify the other participant via WebSocket
      const otherUserId =
        req.user!.id === reading.clientId
          ? reading.readerId
          : reading.clientId;

      wsService.send(otherUserId, "reading:message", {
        readingId: reading.id,
        message,
      });

      res.json({ ok: true, message });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /api/readings/client — Client's reading history ─────────────────────
router.get("/client", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db
      .select()
      .from(readings)
      .where(eq(readings.clientId, req.user!.id))
      .orderBy(desc(readings.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/readings/reader — Reader's session history ─────────────────────
router.get("/reader", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();

    if (req.user!.role !== "reader" && req.user!.role !== "admin") {
      res.status(403).json({ error: "Reader access required" });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db
      .select()
      .from(readings)
      .where(eq(readings.readerId, req.user!.id))
      .orderBy(desc(readings.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/readings/history — Combined history (backward compat) ──────────
router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await db
      .select()
      .from(readings)
      .where(or(eq(readings.clientId, userId), eq(readings.readerId, userId)))
      .orderBy(desc(readings.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/readings/:id — Single reading detail ──────────────────────────
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const readingId = parseInt(req.params.id!, 10);

    if (isNaN(readingId)) {
      res.status(400).json({ error: "Invalid reading ID" });
      return;
    }

    const [reading] = await db
      .select()
      .from(readings)
      .where(eq(readings.id, readingId));

    if (!reading) {
      res.status(404).json({ error: "Reading not found" });
      return;
    }

    // Only participants and admins can view
    if (
      reading.clientId !== req.user!.id &&
      reading.readerId !== req.user!.id &&
      req.user!.role !== "admin"
    ) {
      res.status(403).json({ error: "Not a participant" });
      return;
    }

    res.json(reading);
  } catch (err) {
    next(err);
  }
});

export default router;
