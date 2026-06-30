import { eq, and, lt, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/db";
import { users, readings, transactions } from "../db/schema";
import { wsService } from "./websocket-service";
import { logger } from "../utils/logger";
// Revenue split (60% reader / 40% platform) — shared with the messaging routes
// so reading and message payouts can never drift apart. Integer cents only.
import { READER_SHARE } from "@soulseer/shared";

const GRACE_PERIOD_MS = 120_000; // 2 minutes
const SECONDS_PER_MINUTE = 60;

export interface BillingSnapshot {
  readingId: number;
  status: string;
  durationSeconds: number;
  totalCharged: number;
  readerEarned: number;
  clientBalance: number;
  ended: boolean;
  endReason: "insufficient_balance" | "grace_period_expired" | null;
}

/**
 * Server-authoritative pay-per-minute billing.
 *
 * Billing is driven by the session heartbeat (POST /api/readings/:id/heartbeat),
 * which both participants send every ~30s — NOT by a cron job. On each heartbeat
 * the server computes how many WHOLE minutes have elapsed since the session
 * started (wall-clock, from the DB `startedAt`) versus how many minutes have
 * already been billed (`durationSeconds`), and charges the difference inside a
 * single database transaction. Because the amount is derived from server
 * timestamps and clamped to real elapsed time, the client can never inflate or
 * deflate the charge by manipulating tick timing.
 *
 * No persistent timer is required, so this works correctly on stateless
 * serverless (Vercel) where an in-process setInterval would not survive between
 * invocations.
 */
class BillingService {
  // Kept for the standalone (Fly.io) server entrypoint; no timer is started.
  start(): void {
    logger.info("Billing service initialized (heartbeat-driven, no cron)");
  }

  shutdown(): void {
    logger.info("Billing service stopped");
  }

  /**
   * Called from the heartbeat route. Sweeps platform-wide stale/expired
   * sessions, then settles (charges) the heartbeating reading and returns a
   * fresh billing snapshot the client can render immediately.
   */
  async onHeartbeat(
    readingId: number,
    now: Date = new Date(),
  ): Promise<BillingSnapshot | null> {
    // Opportunistic cleanup — without a cron this is how abandoned sessions get
    // finalized. Cheap, indexed query on (status, lastHeartbeat/updatedAt).
    await this.sweepStale(now);
    return this.settle(readingId, now);
  }

  /**
   * Charge any whole minutes owed on a single ACTIVE reading. Atomic and
   * idempotent: concurrent heartbeats from both participants are serialized with
   * SELECT ... FOR UPDATE, so a minute is never billed twice. Paused readings
   * only have their liveness refreshed (no charge).
   */
  async settle(
    readingId: number,
    now: Date = new Date(),
  ): Promise<BillingSnapshot | null> {
    const db = getDb();
    const out: { snapshot: BillingSnapshot | null } = { snapshot: null };
    let endInsufficient = false;
    let clientId = 0;
    let readerId = 0;

    await db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(readings)
        .where(eq(readings.id, readingId))
        .for("update");
      if (!r) return;

      clientId = r.clientId;
      readerId = r.readerId;

      // Non-active (paused / accepted / completed …) — refresh liveness only.
      if (r.status !== "active") {
        if (r.status === "paused" || r.status === "accepted" || r.status === "in_progress") {
          await tx
            .update(readings)
            .set({ lastHeartbeat: now })
            .where(eq(readings.id, readingId));
        }
        const [c] = await tx
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, r.clientId));
        // Terminal statuses must report ended:true so a polling client stops
        // polling and renders the session summary instead of spinning forever.
        const terminal =
          r.status === "completed" ||
          r.status === "cancelled" ||
          r.status === "missed";
        // "missed" means the grace-period sweep ended it; surface that reason so
        // the client shows the right toast. Other terminal states have no
        // billing-specific end reason knowable from status alone.
        const endReason = r.status === "missed" ? "grace_period_expired" : null;
        out.snapshot = this.toSnapshot(r, c?.balance ?? 0, terminal, endReason);
        return;
      }

      const rate = r.ratePerMinute;
      const startedMs = r.startedAt ? r.startedAt.getTime() : now.getTime();
      const elapsedSeconds = Math.max(
        0,
        Math.floor((now.getTime() - startedMs) / 1000),
      );
      const owedMinutes =
        Math.floor(elapsedSeconds / SECONDS_PER_MINUTE) -
        Math.floor(r.durationSeconds / SECONDS_PER_MINUTE);

      // Nothing to charge yet — just refresh the heartbeat timestamp.
      if (rate <= 0 || owedMinutes <= 0) {
        await tx
          .update(readings)
          .set({ lastHeartbeat: now })
          .where(eq(readings.id, readingId));
        const [c] = await tx
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, r.clientId));
        out.snapshot = this.toSnapshot(r, c?.balance ?? 0, false, null);
        return;
      }

      // Lock the client row and charge as many owed minutes as they can afford.
      const [client] = await tx
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, r.clientId))
        .for("update");
      const balance = client?.balance ?? 0;
      const affordableMinutes = Math.min(owedMinutes, Math.floor(balance / rate));

      let newDuration = r.durationSeconds;
      let newTotal = r.totalCharged;
      let newReaderEarned = r.readerEarned;
      let newPlatformEarned = r.platformEarned;
      let newBalance = balance;

      if (affordableMinutes > 0) {
        const charge = affordableMinutes * rate;
        const readerSharePerMin = Math.floor(rate * READER_SHARE);
        const readerShare = readerSharePerMin * affordableMinutes;
        const platformShare = charge - readerShare;

        newDuration += affordableMinutes * SECONDS_PER_MINUTE;
        newTotal += charge;
        newReaderEarned += readerShare;
        newPlatformEarned += platformShare;
        newBalance -= charge;

        await tx
          .update(readings)
          .set({
            durationSeconds: newDuration,
            totalCharged: newTotal,
            readerEarned: newReaderEarned,
            platformEarned: newPlatformEarned,
            lastHeartbeat: now,
            updatedAt: now,
          })
          .where(eq(readings.id, readingId));

        await tx
          .update(users)
          .set({ balance: newBalance, updatedAt: now })
          .where(eq(users.id, r.clientId));
      } else {
        await tx
          .update(readings)
          .set({ lastHeartbeat: now })
          .where(eq(readings.id, readingId));
      }

      // Could not pay for every elapsed minute → terminate after this settle.
      if (affordableMinutes < owedMinutes) endInsufficient = true;

      out.snapshot = this.toSnapshot(
        {
          ...r,
          durationSeconds: newDuration,
          totalCharged: newTotal,
          readerEarned: newReaderEarned,
        },
        newBalance,
        false,
        null,
      );
    });

    if (endInsufficient) {
      await this.endReading(readingId, "completed", "insufficient_balance");
      wsService.broadcast([clientId, readerId], "reading:insufficient_balance", {
        readingId,
      });
      logger.info({ readingId }, "Reading ended due to insufficient balance");
      if (out.snapshot) {
        out.snapshot.ended = true;
        out.snapshot.endReason = "insufficient_balance";
        out.snapshot.status = "completed";
      }
    }

    return out.snapshot;
  }

  /**
   * Finalize stale/abandoned sessions platform-wide. Active sessions whose
   * heartbeat lapsed past the grace period (both parties gone) and paused
   * sessions whose pause exceeded the grace period (reader never returned) are
   * ended as `missed`.
   */
  async sweepStale(now: Date = new Date()): Promise<void> {
    try {
      const db = getDb();
      const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_MS);

      const staleActive = await db
        .select({ id: readings.id })
        .from(readings)
        .where(
          and(eq(readings.status, "active"), lt(readings.lastHeartbeat, graceCutoff)),
        );

      // Paused sessions are marked at pause time via updatedAt; if the reader
      // does not come back within the grace window, end the session.
      const stalePaused = await db
        .select({ id: readings.id })
        .from(readings)
        .where(
          and(eq(readings.status, "paused"), lt(readings.updatedAt, graceCutoff)),
        );

      const allStale = [...staleActive, ...stalePaused];

      // Process in batches to avoid connection pool exhaustion
      const BATCH_SIZE = 50;
      for (let i = 0; i < allStale.length; i += BATCH_SIZE) {
        const batch = allStale.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (r) => {
            try {
              await this.endReading(r.id, "missed", "grace_period_expired");
              logger.warn({ readingId: r.id }, "Reading ended (grace period expired)");
            } catch (err) {
              logger.error({ err, readingId: r.id }, "Failed to end stale reading");
            }
          })
        );
      }
    } catch (err) {
      logger.error({ err }, "Billing stale-sweep error");
    }
  }

  private toSnapshot(
    r: {
      id: number;
      status: string;
      durationSeconds: number;
      totalCharged: number;
      readerEarned: number;
    },
    clientBalance: number,
    ended: boolean,
    endReason: BillingSnapshot["endReason"],
  ): BillingSnapshot {
    return {
      readingId: r.id,
      status: r.status,
      durationSeconds: r.durationSeconds,
      totalCharged: r.totalCharged,
      readerEarned: r.readerEarned,
      clientBalance,
      ended,
      endReason,
    };
  }

  private async endReading(
    readingId: number,
    status: "completed" | "missed",
    reason?: "insufficient_balance" | "grace_period_expired",
  ): Promise<void> {
    const db = getDb();
    const now = new Date();
    const [reading] = await db
      .select()
      .from(readings)
      .where(eq(readings.id, readingId));
    if (!reading) return;

    await db.transaction(async (tx) => {
      // Re-fetch inside transaction to prevent race with readings/:id/end
      const [fresh] = await tx
        .select()
        .from(readings)
        .where(eq(readings.id, readingId))
        .for("update");

      if (!fresh || fresh.status === "completed" || fresh.status === "cancelled") {
        return; // Already finalized by another path
      }

      // Update reading status
      await tx
        .update(readings)
        .set({
          status,
          completedAt: now,
          paymentStatus: fresh.totalCharged > 0 ? "paid" : "pending",
          updatedAt: now,
        })
        .where(eq(readings.id, readingId));

      // Credit reader balance using fresh data
      if (fresh.readerEarned > 0) {
        const [readerBefore] = await tx
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, fresh.readerId));

        const [readerAfter] = await tx
          .update(users)
          .set({
            balance: sql`${users.balance} + ${fresh.readerEarned}`,
            totalReadings: sql`${users.totalReadings} + 1`,
            updatedAt: now,
          })
          .where(eq(users.id, fresh.readerId))
          .returning({ balance: users.balance });

        await tx.insert(transactions).values({
          userId: fresh.readerId,
          readingId,
          type: "reader_payout",
          amount: fresh.readerEarned,
          balanceBefore: readerBefore?.balance ?? 0,
          balanceAfter: readerAfter?.balance ?? 0,
          note: `Earned from reading #${readingId}`,
        });
      }

      // Record client charge transaction
      if (fresh.totalCharged > 0) {
        const [clientAfter] = await tx
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, fresh.clientId));

        await tx.insert(transactions).values({
          userId: fresh.clientId,
          readingId,
          type: "reading_charge",
          amount: -fresh.totalCharged,
          balanceBefore: (clientAfter?.balance ?? 0) + fresh.totalCharged,
          balanceAfter: clientAfter?.balance ?? 0,
          note: `Charged for reading #${readingId}`,
        });
      }
    });

    // Re-fetch the finalized reading so we can broadcast authoritative totals
    // to both participants (client needs these to render the session summary).
    const [finalized] = await db
      .select()
      .from(readings)
      .where(eq(readings.id, readingId));

    wsService.broadcast([reading.clientId, reading.readerId], "reading:ended", {
      readingId,
      status,
      reason,
      durationSeconds: finalized?.durationSeconds ?? reading.durationSeconds ?? 0,
      totalCharged: finalized?.totalCharged ?? reading.totalCharged ?? 0,
      readerEarned: finalized?.readerEarned ?? reading.readerEarned ?? 0,
      ratePerMinute: reading.ratePerMinute,
    });

    logger.info(
      {
        readingId,
        status,
        totalCharged: finalized?.totalCharged ?? reading.totalCharged,
        readerEarned: finalized?.readerEarned ?? reading.readerEarned,
      },
      "Reading ended by billing service",
    );
  }

  /**
   * Reader toggled offline or dropped mid-session. Charge any whole minutes used
   * up to this moment, then pause all of the reader's live sessions so billing
   * stops while they're gone. Both participants are notified; clients can wait
   * for reconnect (resumed within the grace period) or end the session.
   */
  async handleReaderOffline(readerId: number): Promise<void> {
    const db = getDb();
    const now = new Date();

    const sessions = await db
      .select({ id: readings.id, clientId: readings.clientId, status: readings.status })
      .from(readings)
      .where(
        and(
          eq(readings.readerId, readerId),
          inArray(readings.status, ["accepted", "in_progress", "active"] as const),
        ),
      );

    for (const s of sessions) {
      // Settle outstanding minutes before pausing so the time actually used is
      // billed even if the reader never returns.
      if (s.status === "active") {
        await this.settle(s.id, now);
      }
      // Re-read status — settle may have already ended it (insufficient balance).
      const [fresh] = await db
        .select({ status: readings.status })
        .from(readings)
        .where(eq(readings.id, s.id));
      if (
        !fresh ||
        fresh.status === "completed" ||
        fresh.status === "cancelled" ||
        fresh.status === "missed"
      ) {
        continue;
      }

      await db
        .update(readings)
        .set({ status: "paused", updatedAt: now })
        .where(eq(readings.id, s.id));

      wsService.broadcast([s.clientId, readerId], "reading:partner_disconnected", {
        readingId: s.id,
        partnerRole: "reader",
        previousStatus: s.status,
      });
      logger.info({ readingId: s.id, readerId }, "Reading paused: reader went offline");
    }

    // Also cancel any still-pending requests so the client UI clears them.
    const pending = await db
      .select({ id: readings.id, clientId: readings.clientId })
      .from(readings)
      .where(and(eq(readings.readerId, readerId), eq(readings.status, "pending")));

    if (pending.length > 0) {
      await db
        .update(readings)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(eq(readings.readerId, readerId), eq(readings.status, "pending")));

      for (const p of pending) {
        wsService.broadcast([p.clientId, readerId], "reading:cancelled", {
          readingId: p.id,
          reason: "reader_offline",
        });
      }
    }
  }

  /**
   * Reader came back online within the grace period. Resume their paused
   * sessions and re-anchor `startedAt` so the time spent paused is NOT billed:
   * with billed seconds == elapsed seconds at the moment of resume, the next
   * charge only counts minutes accrued from here forward.
   */
  async handleReaderOnline(readerId: number): Promise<void> {
    const db = getDb();
    const now = new Date();

    const paused = await db
      .select({
        id: readings.id,
        clientId: readings.clientId,
        durationSeconds: readings.durationSeconds,
        lastHeartbeat: readings.lastHeartbeat,
        updatedAt: readings.updatedAt,
      })
      .from(readings)
      .where(and(eq(readings.readerId, readerId), eq(readings.status, "paused")));

    const resumeCutoff = now.getTime() - GRACE_PERIOD_MS;

    for (const s of paused) {
      // Only resume sessions the client is still actively waiting on. If the
      // client's heartbeat also went quiet past the grace window the session is
      // abandoned (the paused-sweep will finalize it); resuming it here would
      // resurrect a stale session and start billing a client who has left.
      // lastHeartbeat is nullable — a session paused before its first heartbeat
      // has none, so fall back to updatedAt (the pause timestamp) to avoid
      // permanently skipping a freshly-paused session.
      const lastBeat = (s.lastHeartbeat ?? s.updatedAt)?.getTime() ?? 0;
      if (lastBeat < resumeCutoff) continue;

      const reanchoredStart = new Date(now.getTime() - s.durationSeconds * 1000);
      await db
        .update(readings)
        .set({
          status: "active",
          startedAt: reanchoredStart,
          lastHeartbeat: now,
          updatedAt: now,
        })
        .where(and(eq(readings.id, s.id), eq(readings.status, "paused")));

      wsService.broadcast([s.clientId, readerId], "reading:partner_reconnected", {
        readingId: s.id,
        partnerRole: "reader",
      });
      logger.info({ readingId: s.id, readerId }, "Reading resumed: reader back online");
    }
  }
}

export const billingService = new BillingService();
