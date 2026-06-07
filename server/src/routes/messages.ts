import { Router } from "express";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "../db/db";
import { users, messages, transactions } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { wsService } from "../services/websocket-service";
import { logger } from "../utils/logger";
// Reuse the shared validator + revenue split so client/server validation and
// reading/message payouts share a single source of truth and can't drift.
import { sendMessageSchema, READER_SHARE } from "@soulseer/shared";
import { pendoTrack } from "../services/pendo-track";

const router = Router();

type MessageRow = typeof messages.$inferSelect;

/**
 * Shape a message row for the viewer. A priced message that has not been
 * unlocked is redacted for the RECIPIENT (they must pay to read it); the sender
 * always sees their own content.
 */
function presentMessage(m: MessageRow, viewerId: number) {
  const isLocked = m.priceCents > 0 && !m.isUnlocked;
  const hideBody = isLocked && m.recipientId === viewerId;
  return {
    id: m.id,
    senderId: m.senderId,
    recipientId: m.recipientId,
    content: hideBody ? null : m.content,
    priceCents: m.priceCents,
    isLocked,
    isUnlocked: m.isUnlocked,
    // Whether THIS viewer still needs to pay to read it.
    requiresPayment: hideBody,
    readAt: m.readAt,
    createdAt: m.createdAt,
  };
}

// ─── GET /api/messages/conversations — my conversation list ──────────────────
router.get("/conversations", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const me = req.user!.id;

    // Pull recent messages involving me, then fold into per-counterpart threads.
    const rows = await db
      .select()
      .from(messages)
      .where(or(eq(messages.senderId, me), eq(messages.recipientId, me)))
      .orderBy(desc(messages.createdAt))
      .limit(500);

    const byCounterpart = new Map<
      number,
      { lastMessage: MessageRow; unread: number }
    >();
    for (const m of rows) {
      const other = m.senderId === me ? m.recipientId : m.senderId;
      const entry = byCounterpart.get(other);
      if (!entry) {
        byCounterpart.set(other, { lastMessage: m, unread: 0 });
      }
      // Count unread = messages TO me not yet read (locked paid count as unread).
      if (m.recipientId === me && m.readAt === null) {
        byCounterpart.get(other)!.unread += 1;
      }
    }

    const counterpartIds = [...byCounterpart.keys()];
    const profiles =
      counterpartIds.length > 0
        ? await db
            .select({
              id: users.id,
              fullName: users.fullName,
              username: users.username,
              profileImage: users.profileImage,
              role: users.role,
            })
            .from(users)
            .where(sql`${users.id} = ANY(${counterpartIds})`)
        : [];
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    const conversations = counterpartIds
      .map((id) => {
        const { lastMessage, unread } = byCounterpart.get(id)!;
        const p = profileMap.get(id);
        const locked =
          lastMessage.priceCents > 0 &&
          !lastMessage.isUnlocked &&
          lastMessage.recipientId === me;
        return {
          counterpart: {
            id,
            fullName: p?.fullName ?? null,
            username: p?.username ?? null,
            profileImage: p?.profileImage ?? null,
            role: p?.role ?? "client",
          },
          unread,
          lastMessage: {
            id: lastMessage.id,
            senderId: lastMessage.senderId,
            preview: locked ? null : lastMessage.content.slice(0, 120),
            isLocked: locked,
            priceCents: lastMessage.priceCents,
            createdAt: lastMessage.createdAt,
          },
        };
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt).getTime() -
          new Date(a.lastMessage.createdAt).getTime(),
      );

    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/messages/with/:userId — thread with one counterpart ────────────
router.get("/with/:userId", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const me = req.user!.id;
    const other = parseInt(req.params.userId ?? "", 10);
    if (isNaN(other)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const [counterpart] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        profileImage: users.profileImage,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, other));
    if (!counterpart) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const thread = await db
      .select()
      .from(messages)
      .where(
        or(
          and(eq(messages.senderId, me), eq(messages.recipientId, other)),
          and(eq(messages.senderId, other), eq(messages.recipientId, me)),
        ),
      )
      .orderBy(messages.createdAt)
      .limit(500);

    // Mark visible inbound messages (free, or already unlocked) as read.
    const now = new Date();
    const toMarkRead = thread.filter(
      (m) =>
        m.recipientId === me &&
        m.readAt === null &&
        (m.priceCents === 0 || m.isUnlocked),
    );
    if (toMarkRead.length > 0) {
      const ids = toMarkRead.map((m) => m.id);
      await db
        .update(messages)
        .set({ readAt: now })
        .where(sql`${messages.id} = ANY(${ids})`);
      // Reflect the update in the rows we serialize back, otherwise the client
      // sees stale readAt: null for messages we just marked read.
      for (const m of toMarkRead) m.readAt = now;
    }

    res.json({
      counterpart,
      messages: thread.map((m) => presentMessage(m, me)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/messages/with/:userId — send a message ────────────────────────
router.post(
  "/with/:userId",
  requireAuth,
  validateBody(sendMessageSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const me = req.user!;
      const other = parseInt(req.params.userId ?? "", 10);
      if (isNaN(other)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }
      if (other === me.id) {
        res.status(400).json({ error: "Cannot message yourself" });
        return;
      }

      const [recipient] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, other));
      if (!recipient) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }

      // Premium messaging is between clients and readers only — general
      // user-to-user DMs are deferred. At least one party must be a reader
      // (admins may message anyone).
      const readerInvolved =
        me.role === "reader" || recipient.role === "reader" || me.role === "admin";
      if (!readerInvolved) {
        res.status(403).json({ error: "Messaging is only available with readers" });
        return;
      }

      // Only a reader may charge for their reply. Everyone else sends free.
      const priceCents = me.role === "reader" ? req.body.priceCents : 0;

      const [created] = await db
        .insert(messages)
        .values({
          senderId: me.id,
          recipientId: other,
          content: req.body.content,
          priceCents,
        })
        .returning();

      wsService.send(other, "message:new", {
        messageId: created!.id,
        senderId: me.id,
        priceCents,
      });

      logger.info(
        { messageId: created!.id, senderId: me.id, recipientId: other, priceCents },
        "Message sent",
      );

      pendoTrack("message_sent", me.id, "system", {
        messageId: created!.id,
        senderId: me.id,
        recipientId: other,
        senderRole: me.role,
        priceCents,
        isPaid: priceCents > 0,
      });

      res.status(201).json(presentMessage(created!, me.id));
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/messages/:id/unlock — pay to read a priced message ────────────
router.post("/:id/unlock", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const me = req.user!.id;
    const messageId = parseInt(req.params.id ?? "", 10);
    if (isNaN(messageId)) {
      res.status(400).json({ error: "Invalid message ID" });
      return;
    }

    let unlocked: MessageRow | null = null;
    let problem: { status: number; error: string; code?: string } | null = null;

    await db.transaction(async (tx) => {
      const [m] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .for("update");

      if (!m || m.recipientId !== me) {
        problem = { status: 404, error: "Message not found" };
        return;
      }
      if (m.priceCents <= 0) {
        problem = { status: 400, error: "Message is free — no unlock required" };
        return;
      }
      if (m.isUnlocked) {
        unlocked = m; // already paid — idempotent
        return;
      }

      const [client] = await tx
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, me))
        .for("update");
      const balance = client?.balance ?? 0;
      if (balance < m.priceCents) {
        problem = {
          status: 402,
          error: "Insufficient balance to read this message",
          code: "INSUFFICIENT_BALANCE",
        };
        return;
      }

      // The client is debited the full price; the reader is credited 60%. The
      // remaining 40% is the platform's revenue and is intentionally NOT moved
      // into any user wallet — it is retained from the funds the client already
      // paid in via Stripe. This mirrors the per-minute readings flow (which
      // likewise debits the full charge and credits the reader 60%, tracking the
      // 40% as platformEarned), so total wallet balances shrinking by the
      // platform cut on each unlock is expected, not lost money.
      const readerShare = Math.floor(m.priceCents * READER_SHARE);
      const now = new Date();

      // Debit the client.
      await tx
        .update(users)
        .set({ balance: sql`${users.balance} - ${m.priceCents}`, updatedAt: now })
        .where(eq(users.id, me));
      await tx.insert(transactions).values({
        userId: me,
        type: "reading_charge",
        amount: -m.priceCents,
        balanceBefore: balance,
        balanceAfter: balance - m.priceCents,
        note: `Unlocked paid message #${messageId}`,
      });

      // Credit the reader (sender). Derive balanceBefore from the atomic
      // UPDATE ... RETURNING result rather than a separate unlocked SELECT, so
      // a concurrent payout to the same reader can't corrupt the snapshot.
      const [readerAfter] = await tx
        .update(users)
        .set({ balance: sql`${users.balance} + ${readerShare}`, updatedAt: now })
        .where(eq(users.id, m.senderId))
        .returning({ balance: users.balance });
      const readerNewBalance = readerAfter?.balance ?? 0;
      await tx.insert(transactions).values({
        userId: m.senderId,
        type: "reader_payout",
        amount: readerShare,
        balanceBefore: readerNewBalance - readerShare,
        balanceAfter: readerNewBalance,
        note: `Earned from paid message #${messageId}`,
      });

      const [updated] = await tx
        .update(messages)
        .set({ isUnlocked: true, unlockedAt: now, readAt: now })
        .where(eq(messages.id, messageId))
        .returning();
      unlocked = updated!;
    });

    if (problem) {
      const p = problem as { status: number; error: string; code?: string };
      res.status(p.status).json({ error: p.error, ...(p.code ? { code: p.code } : {}) });
      return;
    }

    const u = unlocked as MessageRow | null;
    if (!u) {
      res.status(500).json({ error: "Unlock failed" });
      return;
    }

    wsService.send(u.senderId, "message:unlocked", { messageId: u.id });
    logger.info({ messageId: u.id, clientId: me }, "Paid message unlocked");

    pendoTrack("paid_message_unlocked", me, "system", {
      messageId: u.id,
      clientId: me,
      readerId: u.senderId,
      priceCents: u.priceCents,
      readerShare: Math.floor(u.priceCents * READER_SHARE),
    });

    res.json(presentMessage(u, me));
  } catch (err) {
    next(err);
  }
});

export default router;
