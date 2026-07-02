import os
import json
import secrets
import string
import httpx
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from supabase import create_client
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

from db import pool, fetch_one, fetch_all, execute, clean
from auth import get_current_user, require_role, user_from_token
from billing import manager, get_commission_pct

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CF_APP_ID = os.environ["CLOUDFLARE_REALTIME_APP_ID"]
CF_TOKEN = os.environ["CLOUDFLARE_REALTIME_TOKEN"]
CF_BASE = f"https://rtc.live.cloudflare.com/v1/apps/{CF_APP_ID}"
STRIPE_KEY = os.environ["STRIPE_API_KEY"]

sb_admin = create_client(SUPABASE_URL, SERVICE_KEY)

app = FastAPI(title="SoulSeer API")
api = APIRouter(prefix="/api")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await pool.open()


@app.on_event("shutdown")
async def shutdown():
    await pool.close()


def cf_headers():
    return {"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"}


PUBLIC_USER_FIELDS = "id, username, full_name, role, bio, specialties, profile_image, pricing_chat, pricing_voice, pricing_video, is_online, created_at"

# ---------------- AUTH ----------------

class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=40)


@api.post("/auth/register")
async def register(req: RegisterReq):
    existing = await fetch_one("select id from users where email=%s or username=%s", (req.email.lower(), req.username))
    if existing:
        raise HTTPException(400, "Email or username already in use")
    try:
        res = sb_admin.auth.admin.create_user({"email": req.email, "password": req.password, "email_confirm": True})
    except Exception as e:
        raise HTTPException(400, f"Could not create account: {e}")
    auth_id = res.user.id
    await execute(
        "insert into users (auth_id, email, username, full_name, role) values (%s,%s,%s,%s,'client')",
        (auth_id, req.email.lower(), req.username, req.full_name),
    )
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return clean(user)


# ---------------- READERS (public) ----------------

@api.get("/readers")
async def list_readers(online: Optional[bool] = None):
    q = f"select {PUBLIC_USER_FIELDS} from users where role='reader'"
    if online:
        q += " and is_online=true"
    q += " order by is_online desc, created_at asc"
    rows = await fetch_all(q)
    out = []
    for r in rows:
        stats = await fetch_one(
            "select round(avg(rating),1) as avg_rating, count(rating) as review_count from readings where reader_id=%s and rating is not null",
            (r["id"],),
        )
        d = clean(r)
        d["avg_rating"] = float(stats["avg_rating"]) if stats["avg_rating"] else None
        d["review_count"] = stats["review_count"]
        out.append(d)
    return out


@api.get("/readers/{reader_id}")
async def get_reader(reader_id: str):
    r = await fetch_one(f"select {PUBLIC_USER_FIELDS} from users where id=%s and role='reader'", (reader_id,))
    if not r:
        raise HTTPException(404, "Reader not found")
    stats = await fetch_one(
        "select round(avg(rating),1) as avg_rating, count(rating) as review_count from readings where reader_id=%s and rating is not null",
        (reader_id,),
    )
    reviews = await fetch_all(
        """select rd.rating, rd.review, rd.completed_at, u.username as reviewer_name
           from readings rd join users u on u.id = rd.client_id
           where rd.reader_id=%s and rd.rating is not null order by rd.completed_at desc limit 20""",
        (reader_id,),
    )
    d = clean(r)
    d["avg_rating"] = float(stats["avg_rating"]) if stats["avg_rating"] else None
    d["review_count"] = stats["review_count"]
    d["reviews"] = [clean(x) for x in reviews]
    return d


# ---------------- READER SELF-SERVICE ----------------

class StatusReq(BaseModel):
    is_online: bool


@api.patch("/readers/me/status")
async def set_status(req: StatusReq, user: dict = Depends(require_role("reader"))):
    await execute("update users set is_online=%s where id=%s", (req.is_online, user["id"]))
    return {"is_online": req.is_online}


class PricingReq(BaseModel):
    pricing_chat: int = Field(ge=0, le=100000)
    pricing_voice: int = Field(ge=0, le=100000)
    pricing_video: int = Field(ge=0, le=100000)


@api.patch("/readers/me/pricing")
async def set_pricing(req: PricingReq, user: dict = Depends(require_role("reader"))):
    await execute(
        "update users set pricing_chat=%s, pricing_voice=%s, pricing_video=%s where id=%s",
        (req.pricing_chat, req.pricing_voice, req.pricing_video, user["id"]),
    )
    return {"ok": True}


@api.get("/readers/me/earnings")
async def my_earnings(user: dict = Depends(require_role("reader"))):
    today = await fetch_one(
        "select coalesce(sum(amount),0) as v from transactions where user_id=%s and type='reading_earning' and created_at >= date_trunc('day', now())",
        (user["id"],),
    )
    total = await fetch_one(
        "select coalesce(sum(amount),0) as v from transactions where user_id=%s and type='reading_earning'", (user["id"],)
    )
    pct = await get_commission_pct()
    return {
        "today_earnings": today["v"],
        "pending_payout": user["earnings_balance"],
        "historical_earnings": total["v"],
        "commission_pct": pct,
    }


@api.get("/readers/me/sessions")
async def my_sessions(user: dict = Depends(require_role("reader"))):
    rows = await fetch_all(
        """select id, client_id, type, status, price_per_minute, duration, total_price, reader_earned, rating, review, started_at, completed_at, created_at
           from readings where reader_id=%s and status='completed' order by completed_at desc limit 100""",
        (user["id"],),
    )
    out = []
    for r in rows:
        d = clean(r)
        d["client_label"] = f"Client #{str(r['client_id'])[:8]}"
        d.pop("client_id", None)
        out.append(d)
    return out


@api.get("/readers/me/reviews")
async def my_reviews(user: dict = Depends(require_role("reader"))):
    rows = await fetch_all(
        "select id, rating, review, completed_at, client_id from readings where reader_id=%s and rating is not null order by completed_at desc limit 100",
        (user["id"],),
    )
    out = []
    for r in rows:
        d = clean(r)
        d["client_label"] = f"Client #{str(r['client_id'])[:8]}"
        d.pop("client_id", None)
        out.append(d)
    return out


# ---------------- CLIENT DASHBOARD ----------------

@api.get("/me/readings")
async def my_readings(user: dict = Depends(get_current_user)):
    rows = await fetch_all(
        """select rd.*, u.full_name as reader_name, u.profile_image as reader_image
           from readings rd join users u on u.id = rd.reader_id
           where rd.client_id=%s order by rd.created_at desc limit 100""",
        (user["id"],),
    )
    return [clean(r) for r in rows]


@api.get("/me/transactions")
async def my_transactions(user: dict = Depends(get_current_user)):
    rows = await fetch_all("select * from transactions where user_id=%s order by created_at desc limit 200", (user["id"],))
    return [clean(r) for r in rows]


# ---------------- READINGS ----------------

class ReadingReq(BaseModel):
    reader_id: str
    type: str


@api.post("/readings/request")
async def request_reading(req: ReadingReq, user: dict = Depends(get_current_user)):
    if req.type not in ("chat", "voice", "video"):
        raise HTTPException(400, "Invalid reading type")
    if user["role"] != "client":
        raise HTTPException(403, "Only clients can request readings")
    reader = await fetch_one("select * from users where id=%s and role='reader'", (req.reader_id,))
    if not reader:
        raise HTTPException(404, "Reader not found")
    if not reader["is_online"]:
        raise HTTPException(400, "Reader is offline")
    ppm = reader[f"pricing_{req.type}"]
    if ppm <= 0:
        raise HTTPException(400, "Reader does not offer this reading type")
    if user["account_balance"] < 500:
        raise HTTPException(402, "Minimum $5.00 balance required. Please add funds.")
    active = await fetch_one(
        "select id from readings where client_id=%s and status in ('pending','accepted','in_progress')", (user["id"],)
    )
    if active:
        raise HTTPException(400, "You already have an active reading request")
    row = await fetch_one(
        "insert into readings (reader_id, client_id, type, price_per_minute) values (%s,%s,%s,%s) returning *",
        (req.reader_id, user["id"], req.type, ppm),
    )
    return clean(row)


@api.get("/readings/incoming")
async def incoming(user: dict = Depends(require_role("reader"))):
    rows = await fetch_all(
        """select rd.id, rd.type, rd.price_per_minute, rd.created_at, rd.status, u.username as client_username
           from readings rd join users u on u.id=rd.client_id
           where rd.reader_id=%s and rd.status='pending' and rd.created_at > now() - interval '10 minutes'
           order by rd.created_at desc""",
        (user["id"],),
    )
    return [clean(r) for r in rows]


@api.get("/readings/active")
async def active_readings(user: dict = Depends(get_current_user)):
    rows = await fetch_all(
        """select rd.*, r.full_name as reader_name, c.username as client_username
           from readings rd join users r on r.id=rd.reader_id join users c on c.id=rd.client_id
           where (rd.client_id=%s or rd.reader_id=%s) and rd.status in ('pending','accepted','in_progress')
           order by rd.created_at desc""",
        (user["id"], user["id"]),
    )
    return [clean(r) for r in rows]


async def get_reading_for(reading_id, user):
    row = await fetch_one("select * from readings where id=%s", (reading_id,))
    if not row:
        raise HTTPException(404, "Reading not found")
    if str(user["id"]) not in (str(row["reader_id"]), str(row["client_id"])) and user["role"] != "admin":
        raise HTTPException(403, "Not a participant")
    return row


@api.get("/readings/{reading_id}")
async def get_reading(reading_id: str, user: dict = Depends(get_current_user)):
    row = await get_reading_for(reading_id, user)
    d = clean(row)
    reader = await fetch_one("select full_name, profile_image from users where id=%s", (row["reader_id"],))
    d["reader_name"] = reader["full_name"]
    d["reader_image"] = reader["profile_image"]
    return d


@api.post("/readings/{reading_id}/accept")
async def accept_reading(reading_id: str, user: dict = Depends(require_role("reader"))):
    row = await get_reading_for(reading_id, user)
    if row["status"] != "pending":
        raise HTTPException(400, "Reading is not pending")
    await execute("update readings set status='accepted' where id=%s", (reading_id,))
    return {"status": "accepted"}


@api.post("/readings/{reading_id}/decline")
async def decline_reading(reading_id: str, user: dict = Depends(require_role("reader"))):
    row = await get_reading_for(reading_id, user)
    if row["status"] != "pending":
        raise HTTPException(400, "Reading is not pending")
    await execute("update readings set status='cancelled', end_reason='declined' where id=%s", (reading_id,))
    return {"status": "cancelled"}


@api.post("/readings/{reading_id}/cancel")
async def cancel_reading(reading_id: str, user: dict = Depends(get_current_user)):
    row = await get_reading_for(reading_id, user)
    if row["status"] not in ("pending", "accepted"):
        raise HTTPException(400, "Cannot cancel now")
    await execute("update readings set status='cancelled', end_reason='cancelled' where id=%s", (reading_id,))
    return {"status": "cancelled"}


@api.post("/readings/{reading_id}/end")
async def end_reading(reading_id: str, user: dict = Depends(get_current_user)):
    row = await get_reading_for(reading_id, user)
    sess = manager.get(reading_id)
    if sess:
        await manager.end(sess, "ended_by_participant")
    elif row["status"] in ("accepted", "in_progress"):
        await execute("update readings set status='completed', completed_at=%s, end_reason='ended' where id=%s",
                      (datetime.now(timezone.utc), reading_id))
    return {"status": "completed"}


class RateReq(BaseModel):
    rating: int = Field(ge=1, le=5)
    review: str = Field(default="", max_length=2000)


@api.post("/readings/{reading_id}/rate")
async def rate_reading(reading_id: str, req: RateReq, user: dict = Depends(get_current_user)):
    row = await get_reading_for(reading_id, user)
    if str(row["client_id"]) != str(user["id"]):
        raise HTTPException(403, "Only the client can rate")
    if row["status"] != "completed":
        raise HTTPException(400, "Reading not completed")
    await execute("update readings set rating=%s, review=%s where id=%s", (req.rating, req.review, reading_id))
    return {"ok": True}


# ---------------- WEBSOCKET (presence + chat + billing events) ----------------

@app.websocket("/api/ws/readings/{reading_id}")
async def reading_ws(ws: WebSocket, reading_id: str, token: str = ""):
    try:
        user = await user_from_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    if not user:
        await ws.close(code=4401)
        return
    reading = await fetch_one("select * from readings where id=%s", (reading_id,))
    if not reading or str(user["id"]) not in (str(reading["reader_id"]), str(reading["client_id"])):
        await ws.close(code=4403)
        return
    if reading["status"] not in ("accepted", "in_progress"):
        await ws.close(code=4400)
        return
    await ws.accept()
    sess = await manager.join(reading, user["id"], ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("type") == "chat" and sess and not sess.ended:
                await manager.chat(sess, user["id"], str(msg.get("text", "")))
            elif msg.get("type") == "end" and sess and not sess.ended:
                await manager.end(sess, "ended_by_participant")
    except WebSocketDisconnect:
        pass
    finally:
        if sess and not sess.ended:
            await manager.leave(sess, user["id"])


# ---------------- CLOUDFLARE REALTIME (SFU proxy) ----------------

@api.get("/rtc/ice")
async def ice_servers(user: dict = Depends(get_current_user)):
    return {"iceServers": [{"urls": "stun:stun.cloudflare.com:3478"}]}


@api.post("/rtc/{reading_id}/session")
async def rtc_new_session(reading_id: str, user: dict = Depends(get_current_user)):
    await get_reading_for(reading_id, user)
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{CF_BASE}/sessions/new", headers=cf_headers())
    if r.status_code >= 400:
        raise HTTPException(502, f"Cloudflare error: {r.text[:300]}")
    sid = r.json()["sessionId"]
    await execute(
        """insert into rtc_sessions (reading_id, user_id, cf_session_id, tracks) values (%s,%s,%s,'[]')
           on conflict (reading_id, user_id) do update set cf_session_id=excluded.cf_session_id, tracks='[]'""",
        (reading_id, user["id"], sid),
    )
    return {"sessionId": sid}


class LocalTracksReq(BaseModel):
    sessionId: str
    sdp: str
    tracks: List[dict]


@api.post("/rtc/{reading_id}/tracks/local")
async def rtc_local_tracks(reading_id: str, req: LocalTracksReq, user: dict = Depends(get_current_user)):
    await get_reading_for(reading_id, user)
    own = await fetch_one("select * from rtc_sessions where reading_id=%s and user_id=%s", (reading_id, user["id"]))
    if not own or own["cf_session_id"] != req.sessionId:
        raise HTTPException(403, "Session mismatch")
    body = {
        "sessionDescription": {"type": "offer", "sdp": req.sdp},
        "tracks": [{"location": "local", "mid": t["mid"], "trackName": t["trackName"]} for t in req.tracks],
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{CF_BASE}/sessions/{req.sessionId}/tracks/new", headers=cf_headers(), json=body)
    if r.status_code >= 400:
        raise HTTPException(502, f"Cloudflare error: {r.text[:300]}")
    names = [t["trackName"] for t in req.tracks]
    await execute("update rtc_sessions set tracks=%s where reading_id=%s and user_id=%s",
                  (json.dumps(names), reading_id, user["id"]))
    return r.json()


@api.get("/rtc/{reading_id}/remote")
async def rtc_remote(reading_id: str, user: dict = Depends(get_current_user)):
    await get_reading_for(reading_id, user)
    row = await fetch_one(
        "select cf_session_id, tracks from rtc_sessions where reading_id=%s and user_id != %s", (reading_id, user["id"])
    )
    if not row or not row["tracks"]:
        return {"ready": False}
    return {"ready": True, "sessionId": row["cf_session_id"], "trackNames": row["tracks"]}


class RemoteTracksReq(BaseModel):
    sessionId: str
    remoteSessionId: str
    trackNames: List[str]


@api.post("/rtc/{reading_id}/tracks/remote")
async def rtc_remote_tracks(reading_id: str, req: RemoteTracksReq, user: dict = Depends(get_current_user)):
    await get_reading_for(reading_id, user)
    body = {"tracks": [{"location": "remote", "sessionId": req.remoteSessionId, "trackName": n} for n in req.trackNames]}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{CF_BASE}/sessions/{req.sessionId}/tracks/new", headers=cf_headers(), json=body)
    if r.status_code >= 400:
        raise HTTPException(502, f"Cloudflare error: {r.text[:300]}")
    return r.json()


class RenegotiateReq(BaseModel):
    sessionId: str
    sdp: str


@api.put("/rtc/{reading_id}/renegotiate")
async def rtc_renegotiate(reading_id: str, req: RenegotiateReq, user: dict = Depends(get_current_user)):
    await get_reading_for(reading_id, user)
    body = {"sessionDescription": {"type": "answer", "sdp": req.sdp}}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.put(f"{CF_BASE}/sessions/{req.sessionId}/renegotiate", headers=cf_headers(), json=body)
    if r.status_code >= 400:
        raise HTTPException(502, f"Cloudflare error: {r.text[:300]}")
    return r.json()


# ---------------- PAYMENTS (Stripe) ----------------

PACKAGES = {"p10": 10.0, "p25": 25.0, "p50": 50.0, "p100": 100.0}


class CheckoutReq(BaseModel):
    package_id: Optional[str] = None
    custom_amount: Optional[float] = None
    origin_url: str


@api.post("/payments/checkout")
async def create_checkout(req: CheckoutReq, request: Request, user: dict = Depends(get_current_user)):
    if req.package_id:
        if req.package_id not in PACKAGES:
            raise HTTPException(400, "Invalid package")
        amount = PACKAGES[req.package_id]
    elif req.custom_amount:
        amount = round(float(req.custom_amount), 2)
        if amount < 5.0 or amount > 1000.0:
            raise HTTPException(400, "Amount must be between $5 and $1000")
    else:
        raise HTTPException(400, "No amount specified")
    host_url = str(request.base_url)
    stripe_checkout = StripeCheckout(api_key=STRIPE_KEY, webhook_url=f"{host_url}api/webhook/stripe")
    success_url = f"{req.origin_url}/dashboard?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/dashboard"
    session = await stripe_checkout.create_checkout_session(CheckoutSessionRequest(
        amount=amount, currency="usd", success_url=success_url, cancel_url=cancel_url,
        metadata={"user_id": str(user["id"]), "purpose": "add_funds"},
    ))
    await execute(
        "insert into payment_transactions (user_id, session_id, amount, currency, payment_status, metadata) values (%s,%s,%s,'usd','initiated',%s)",
        (user["id"], session.session_id, int(amount * 100), json.dumps({"purpose": "add_funds"})),
    )
    return {"url": session.url, "session_id": session.session_id}


async def credit_payment(session_id: str, payment_status: str, amount_total: int):
    async with pool.connection() as conn:
        async with conn.transaction():
            cur = await conn.execute("select * from payment_transactions where session_id=%s for update", (session_id,))
            pt = await cur.fetchone()
            if not pt:
                return None
            if pt["payment_status"] == "paid":
                return pt
            await conn.execute("update payment_transactions set payment_status=%s, updated_at=now() where session_id=%s",
                               (payment_status, session_id))
            if payment_status == "paid":
                cur2 = await conn.execute("select account_balance from users where id=%s for update", (pt["user_id"],))
                u = await cur2.fetchone()
                bal = u["account_balance"]
                await conn.execute("update users set account_balance=account_balance+%s where id=%s", (amount_total, pt["user_id"]))
                await conn.execute(
                    "insert into transactions (user_id,type,amount,balance_before,balance_after,stripe_id,note) values (%s,'deposit',%s,%s,%s,%s,'Added funds via Stripe')",
                    (pt["user_id"], amount_total, bal, bal + amount_total, session_id),
                )
            return pt


@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
    host_url = str(request.base_url)
    stripe_checkout = StripeCheckout(api_key=STRIPE_KEY, webhook_url=f"{host_url}api/webhook/stripe")
    status = await stripe_checkout.get_checkout_status(session_id)
    ps = "paid" if status.payment_status == "paid" else ("expired" if status.status == "expired" else status.payment_status)
    await credit_payment(session_id, ps, status.amount_total)
    fresh = await fetch_one("select account_balance from users where id=%s", (user["id"],))
    return {"status": status.status, "payment_status": status.payment_status, "account_balance": fresh["account_balance"]}


@app.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    host_url = str(request.base_url)
    stripe_checkout = StripeCheckout(api_key=STRIPE_KEY, webhook_url=f"{host_url}api/webhook/stripe")
    try:
        wh = await stripe_checkout.handle_webhook(body, request.headers.get("Stripe-Signature"))
        if wh.payment_status == "paid":
            await credit_payment(wh.session_id, "paid", None)
    except Exception:
        pass
    return {"ok": True}


# ---------------- FORUM ----------------

@api.get("/forum/posts")
async def forum_posts():
    rows = await fetch_all(
        """select p.id, p.title, p.content, p.created_at, u.username as author_name, u.role as author_role,
           (select count(*) from forum_comments c where c.post_id=p.id and c.is_deleted=false) as comment_count
           from forum_posts p join users u on u.id=p.author_id where p.is_deleted=false order by p.created_at desc limit 100"""
    )
    return [clean(r) for r in rows]


@api.get("/forum/posts/{post_id}")
async def forum_post(post_id: str):
    p = await fetch_one(
        "select p.*, u.username as author_name, u.role as author_role from forum_posts p join users u on u.id=p.author_id where p.id=%s and p.is_deleted=false",
        (post_id,),
    )
    if not p:
        raise HTTPException(404, "Post not found")
    comments = await fetch_all(
        "select c.*, u.username as author_name, u.role as author_role from forum_comments c join users u on u.id=c.author_id where c.post_id=%s and c.is_deleted=false order by c.created_at asc",
        (post_id,),
    )
    d = clean(p)
    d["comments"] = [clean(c) for c in comments]
    return d


class PostReq(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    content: str = Field(min_length=1, max_length=10000)


@api.post("/forum/posts")
async def create_post(req: PostReq, user: dict = Depends(get_current_user)):
    row = await fetch_one("insert into forum_posts (author_id, title, content) values (%s,%s,%s) returning id",
                          (user["id"], req.title, req.content))
    return {"id": str(row["id"])}


class CommentReq(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


@api.post("/forum/posts/{post_id}/comments")
async def create_comment(post_id: str, req: CommentReq, user: dict = Depends(get_current_user)):
    p = await fetch_one("select id from forum_posts where id=%s and is_deleted=false", (post_id,))
    if not p:
        raise HTTPException(404, "Post not found")
    await execute("insert into forum_comments (post_id, author_id, content) values (%s,%s,%s)", (post_id, user["id"], req.content))
    return {"ok": True}


class FlagReq(BaseModel):
    target_type: str
    target_id: str
    reason: str = Field(default="", max_length=500)


@api.post("/forum/flag")
async def flag_content(req: FlagReq, user: dict = Depends(get_current_user)):
    if req.target_type not in ("post", "comment"):
        raise HTTPException(400, "Invalid target type")
    await execute("insert into forum_flags (target_type, target_id, flagged_by, reason) values (%s,%s,%s,%s)",
                  (req.target_type, req.target_id, user["id"], req.reason))
    return {"ok": True}


# ---------------- NEWSLETTER ----------------

class NewsletterReq(BaseModel):
    email: EmailStr


@api.post("/newsletter")
async def newsletter(req: NewsletterReq):
    await execute("insert into newsletter_subscribers (email) values (%s) on conflict (email) do nothing", (req.email.lower(),))
    return {"ok": True}


# ---------------- ADMIN ----------------

admin_dep = require_role("admin")


@api.get("/admin/users")
async def admin_users(search: str = "", user: dict = Depends(admin_dep)):
    q = "select id, email, username, full_name, role, account_balance, earnings_balance, is_online, created_at from users"
    params = ()
    if search:
        q += " where email ilike %s or username ilike %s or full_name ilike %s"
        s = f"%{search}%"
        params = (s, s, s)
    q += " order by created_at desc limit 200"
    rows = await fetch_all(q, params)
    return [clean(r) for r in rows]


def gen_password():
    alphabet = string.ascii_letters + string.digits
    return "Ss!" + "".join(secrets.choice(alphabet) for _ in range(10))


async def upload_image(file: UploadFile):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Image too large (max 5MB)")
    ext = (file.filename or "img.jpg").split(".")[-1].lower()
    name = f"{secrets.token_hex(8)}.{ext}"
    try:
        sb_admin.storage.from_("profiles").upload(name, data, {"content-type": file.content_type or "image/jpeg"})
        return f"{SUPABASE_URL}/storage/v1/object/public/profiles/{name}"
    except Exception as e:
        raise HTTPException(500, f"Image upload failed: {e}")


@api.post("/admin/readers")
async def admin_create_reader(
    email: EmailStr = Form(...), full_name: str = Form(...), username: str = Form(...),
    bio: str = Form(""), specialties: str = Form(""),
    pricing_chat: int = Form(0), pricing_voice: int = Form(0), pricing_video: int = Form(0),
    image: Optional[UploadFile] = File(None), user: dict = Depends(admin_dep),
):
    existing = await fetch_one("select id from users where email=%s or username=%s", (email.lower(), username))
    if existing:
        raise HTTPException(400, "Email or username already in use")
    password = gen_password()
    try:
        res = sb_admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
    except Exception as e:
        raise HTTPException(400, f"Could not create auth account: {e}")
    img_url = await upload_image(image) if image else ""
    specs = [s.strip() for s in specialties.split(",") if s.strip()]
    row = await fetch_one(
        """insert into users (auth_id, email, username, full_name, role, bio, specialties, profile_image, pricing_chat, pricing_voice, pricing_video)
           values (%s,%s,%s,%s,'reader',%s,%s,%s,%s,%s,%s) returning id""",
        (res.user.id, email.lower(), username, full_name, bio, specs, img_url, pricing_chat, pricing_voice, pricing_video),
    )
    return {"id": str(row["id"]), "email": email, "initial_password": password}


@api.patch("/admin/readers/{reader_id}")
async def admin_edit_reader(
    reader_id: str,
    full_name: Optional[str] = Form(None), username: Optional[str] = Form(None), bio: Optional[str] = Form(None),
    specialties: Optional[str] = Form(None), pricing_chat: Optional[int] = Form(None),
    pricing_voice: Optional[int] = Form(None), pricing_video: Optional[int] = Form(None),
    image: Optional[UploadFile] = File(None), user: dict = Depends(admin_dep),
):
    reader = await fetch_one("select * from users where id=%s and role='reader'", (reader_id,))
    if not reader:
        raise HTTPException(404, "Reader not found")
    updates, params = [], []
    for field, val in [("full_name", full_name), ("username", username), ("bio", bio),
                       ("pricing_chat", pricing_chat), ("pricing_voice", pricing_voice), ("pricing_video", pricing_video)]:
        if val is not None:
            updates.append(f"{field}=%s")
            params.append(val)
    if specialties is not None:
        updates.append("specialties=%s")
        params.append([s.strip() for s in specialties.split(",") if s.strip()])
    if image:
        updates.append("profile_image=%s")
        params.append(await upload_image(image))
    if not updates:
        return {"ok": True}
    params.append(reader_id)
    await execute(f"update users set {', '.join(updates)} where id=%s", tuple(params))
    return {"ok": True}


@api.get("/admin/readings")
async def admin_readings(search: str = "", user: dict = Depends(admin_dep)):
    pct = await get_commission_pct()
    q = """select rd.*, r.full_name as reader_name, c.username as client_username
           from readings rd join users r on r.id=rd.reader_id join users c on c.id=rd.client_id"""
    params = ()
    if search:
        q += " where r.full_name ilike %s or c.username ilike %s or rd.status ilike %s or rd.type ilike %s"
        s = f"%{search}%"
        params = (s, s, s, s)
    q += " order by rd.created_at desc limit 200"
    rows = await fetch_all(q, params)
    out = []
    for r in rows:
        d = clean(r)
        d["platform_revenue"] = r["total_price"] - r["reader_earned"]
        out.append(d)
    return {"readings": out, "commission_pct": pct}


@api.get("/admin/transactions")
async def admin_transactions(user: dict = Depends(admin_dep)):
    rows = await fetch_all(
        "select t.*, u.username, u.email from transactions t join users u on u.id=t.user_id order by t.created_at desc limit 500"
    )
    return [clean(r) for r in rows]


class BalanceAdjustReq(BaseModel):
    user_id: str
    amount: int
    note: str = Field(min_length=3, max_length=500)


@api.post("/admin/balance-adjust")
async def balance_adjust(req: BalanceAdjustReq, user: dict = Depends(admin_dep)):
    async with pool.connection() as conn:
        async with conn.transaction():
            cur = await conn.execute("select account_balance from users where id=%s for update", (req.user_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "User not found")
            bal = row["account_balance"]
            new_bal = bal + req.amount
            if new_bal < 0:
                raise HTTPException(400, "Adjustment would make balance negative")
            await conn.execute("update users set account_balance=%s where id=%s", (new_bal, req.user_id))
            await conn.execute(
                "insert into transactions (user_id,type,amount,balance_before,balance_after,note) values (%s,'admin_adjustment',%s,%s,%s,%s)",
                (req.user_id, req.amount, bal, new_bal, f"Admin adjustment: {req.note}"),
            )
    return {"account_balance": new_bal}


class PayoutReq(BaseModel):
    reader_id: str
    note: str = ""


@api.post("/admin/payouts")
async def record_payout(req: PayoutReq, user: dict = Depends(admin_dep)):
    async with pool.connection() as conn:
        async with conn.transaction():
            cur = await conn.execute("select earnings_balance from users where id=%s and role='reader' for update", (req.reader_id,))
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Reader not found")
            amt = row["earnings_balance"]
            if amt < 1500:
                raise HTTPException(400, "Payout threshold is $15.00")
            await conn.execute("update users set earnings_balance=0 where id=%s", (req.reader_id,))
            await conn.execute(
                "insert into transactions (user_id,type,amount,balance_before,balance_after,note) values (%s,'payout',%s,%s,0,%s)",
                (req.reader_id, -amt, amt, f"Payout processed: {req.note}"),
            )
    return {"paid_out": amt}


@api.get("/admin/forum/flagged")
async def flagged_content(user: dict = Depends(admin_dep)):
    rows = await fetch_all(
        """select f.*, u.username as flagger_name from forum_flags f left join users u on u.id=f.flagged_by
           where f.status='open' order by f.created_at desc limit 100"""
    )
    out = []
    for f in rows:
        d = clean(f)
        if f["target_type"] == "post":
            t = await fetch_one("select title, content, is_deleted from forum_posts where id=%s", (f["target_id"],))
        else:
            t = await fetch_one("select content, is_deleted from forum_comments where id=%s", (f["target_id"],))
        d["target"] = clean(t) if t else None
        out.append(d)
    return out


@api.delete("/admin/forum/{target_type}/{target_id}")
async def delete_content(target_type: str, target_id: str, user: dict = Depends(admin_dep)):
    if target_type == "post":
        await execute("update forum_posts set is_deleted=true where id=%s", (target_id,))
        await execute("update forum_comments set is_deleted=true where post_id=%s", (target_id,))
    elif target_type == "comment":
        await execute("update forum_comments set is_deleted=true where id=%s", (target_id,))
    else:
        raise HTTPException(400, "Invalid target type")
    await execute("update forum_flags set status='resolved' where target_type=%s and target_id=%s", (target_type, target_id))
    return {"ok": True}


@api.get("/health")
async def health():
    row = await fetch_one("select 1 as ok")
    return {"status": "ok", "db": bool(row)}


app.include_router(api)
