import asyncio
import json
from datetime import datetime, timezone
from db import pool, fetch_one

GRACE_SECONDS = 120


async def get_commission_pct():
    row = await fetch_one("select value from platform_settings where key='reader_commission_pct'")
    return int(row["value"]) if row else 60


class LiveSession:
    def __init__(self, reading):
        self.reading_id = str(reading["id"])
        self.reader_id = str(reading["reader_id"])
        self.client_id = str(reading["client_id"])
        self.ppm = reading["price_per_minute"]
        self.rtype = reading["type"]
        self.sockets = {}
        self.billable_seconds = 0
        self.total_charged = 0
        self.reader_earned = 0
        self.transcript = []
        self.started = False
        self.ended = False
        self.absent_seconds = 0
        self.task = None


class SessionManager:
    def __init__(self):
        self.sessions = {}

    def get(self, reading_id):
        return self.sessions.get(str(reading_id))

    async def join(self, reading, user_id, ws):
        rid = str(reading["id"])
        sess = self.sessions.get(rid)
        if not sess:
            sess = LiveSession(reading)
            self.sessions[rid] = sess
        user_id = str(user_id)
        sess.sockets[user_id] = ws
        sess.absent_seconds = 0
        await self.broadcast(sess, {"type": "participant_joined", "user_id": user_id})
        if not sess.started and sess.reader_id in sess.sockets and sess.client_id in sess.sockets:
            sess.started = True
            await self._start_billing(sess)
        return sess

    async def leave(self, sess, user_id):
        user_id = str(user_id)
        if sess.sockets.get(user_id):
            sess.sockets.pop(user_id, None)
        if not sess.ended:
            await self.broadcast(sess, {"type": "participant_left", "user_id": user_id})

    async def chat(self, sess, user_id, text):
        msg = {"sender_id": str(user_id), "text": text[:2000], "ts": datetime.now(timezone.utc).isoformat()}
        sess.transcript.append(msg)
        await self.broadcast(sess, {"type": "chat", **msg})

    async def broadcast(self, sess, payload):
        data = json.dumps(payload)
        for ws in list(sess.sockets.values()):
            try:
                await ws.send_text(data)
            except Exception:
                pass

    async def _start_billing(self, sess):
        async with pool.connection() as conn:
            await conn.execute(
                "update readings set status='in_progress', started_at=%s where id=%s and status in ('accepted','in_progress')",
                (datetime.now(timezone.utc), sess.reading_id),
            )
        await self.broadcast(sess, {"type": "session_started"})
        sess.task = asyncio.create_task(self._billing_loop(sess))

    async def _billing_loop(self, sess):
        pct = await get_commission_pct()
        try:
            while not sess.ended:
                both = sess.reader_id in sess.sockets and sess.client_id in sess.sockets
                if both:
                    sess.absent_seconds = 0
                    if sess.billable_seconds % 60 == 0:
                        ok = await self._tick(sess, pct)
                        if not ok:
                            await self.end(sess, "insufficient_balance")
                            return
                    sess.billable_seconds += 1
                else:
                    sess.absent_seconds += 1
                    if sess.absent_seconds >= GRACE_SECONDS:
                        await self.end(sess, "disconnected")
                        return
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass

    async def _tick(self, sess, pct):
        reader_cut = (sess.ppm * pct) // 100
        async with pool.connection() as conn:
            async with conn.transaction():
                cur = await conn.execute("select account_balance from users where id=%s for update", (sess.client_id,))
                row = await cur.fetchone()
                bal = row["account_balance"]
                if bal < sess.ppm:
                    return False
                await conn.execute("update users set account_balance=account_balance-%s where id=%s", (sess.ppm, sess.client_id))
                await conn.execute("update users set earnings_balance=earnings_balance+%s where id=%s", (reader_cut, sess.reader_id))
                await conn.execute(
                    "insert into transactions (user_id,type,amount,balance_before,balance_after,reading_id,note) values (%s,'reading_charge',%s,%s,%s,%s,%s)",
                    (sess.client_id, -sess.ppm, bal, bal - sess.ppm, sess.reading_id, f"{sess.rtype} reading minute"),
                )
                cur2 = await conn.execute("select earnings_balance from users where id=%s", (sess.reader_id,))
                erow = await cur2.fetchone()
                eb = erow["earnings_balance"]
                await conn.execute(
                    "insert into transactions (user_id,type,amount,balance_before,balance_after,reading_id,note) values (%s,'reading_earning',%s,%s,%s,%s,%s)",
                    (sess.reader_id, reader_cut, eb - reader_cut, eb, sess.reading_id, f"{pct}% of {sess.rtype} reading minute"),
                )
        sess.total_charged += sess.ppm
        sess.reader_earned += reader_cut
        bal_after = bal - sess.ppm
        await self.broadcast(sess, {
            "type": "billing_tick", "billable_seconds": sess.billable_seconds,
            "total_charged": sess.total_charged, "client_balance": bal_after,
        })
        return True

    async def end(self, sess, reason="ended"):
        if sess.ended:
            return
        sess.ended = True
        if sess.task and sess.task is not asyncio.current_task():
            sess.task.cancel()
        async with pool.connection() as conn:
            await conn.execute(
                """update readings set status='completed', completed_at=%s, duration=%s, total_price=%s,
                   reader_earned=%s, payment_status='paid', chat_transcript=%s, end_reason=%s where id=%s""",
                (datetime.now(timezone.utc), sess.billable_seconds, sess.total_charged,
                 sess.reader_earned, json.dumps(sess.transcript), reason, sess.reading_id),
            )
        await self.broadcast(sess, {
            "type": "session_ended", "reason": reason, "duration": sess.billable_seconds,
            "total_charged": sess.total_charged,
        })
        for ws in list(sess.sockets.values()):
            try:
                await ws.close()
            except Exception:
                pass
        self.sessions.pop(sess.reading_id, None)


manager = SessionManager()
