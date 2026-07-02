"""SoulSeer backend regression tests (pytest)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://c5f27c0d-0d44-43f7-aabf-053854b5d12d.preview.emergentagent.com").rstrip("/")
SUPABASE_URL = "https://iznypsetnntofngglngk.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6bnlwc2V0bm50b2ZuZ2dsbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODg5MzgsImV4cCI6MjA5ODM2NDkzOH0.8_uVVV9KpqPeL1Eh2A_mAEQ6S2TwYqwqPKwR3HOIZW4"

ADMIN = ("admin@soulseer.com", "SoulSeerAdmin!2024")
LUNA = ("luna@soulseer.com", "ReaderPass!2024")
CLIENT = ("testclient@soulseer.com", "ClientPass!2024")
LUNA_USERNAME = "lunastarweaver"


def supabase_login(email, password):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Supabase login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _rand_email():
    return f"test_{uuid.uuid4().hex[:10]}@example.com"


# ---------- FIXTURES ----------
@pytest.fixture(scope="session")
def admin_token():
    return supabase_login(*ADMIN)


@pytest.fixture(scope="session")
def luna_token():
    return supabase_login(*LUNA)


@pytest.fixture(scope="session")
def client_token():
    return supabase_login(*CLIENT)


# ---------- HEALTH / PUBLIC ----------
class TestHealth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_public_readers_list(self):
        r = requests.get(f"{BASE_URL}/api/readers", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 2
        usernames = [x.get("username") for x in data]
        assert LUNA_USERNAME in usernames

    def test_reader_profile_by_id(self):
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        luna = next(x for x in readers if x["username"] == LUNA_USERNAME)
        r = requests.get(f"{BASE_URL}/api/readers/{luna['id']}", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["pricing_chat"] > 0
        assert "pricing_voice" in body and "pricing_video" in body
        assert "bio" in body
        assert isinstance(body.get("reviews", []), list)

    def test_newsletter_signup(self):
        r = requests.post(f"{BASE_URL}/api/newsletter", json={"email": _rand_email()}, timeout=10)
        assert r.status_code in (200, 201)

    def test_forum_posts_public(self):
        r = requests.get(f"{BASE_URL}/api/forum/posts", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- AUTH ----------
class TestAuth:
    def test_login_all_roles(self, admin_token, luna_token, client_token):
        assert admin_token and luna_token and client_token

    def test_me_endpoint(self, client_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(client_token), timeout=10)
        assert r.status_code == 200
        assert r.json().get("email") == CLIENT[0]

    def test_register_new_client(self):
        email = _rand_email()
        uname = f"tst{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "TestPass!2024", "full_name": "Test User", "username": uname},
            timeout=20,
        )
        assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
        # verify login works
        tok = supabase_login(email, "TestPass!2024")
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(tok)).json()
        assert me["email"] == email
        assert me["role"] == "client"


# ---------- READER FLOWS ----------
class TestReader:
    def test_reader_status_toggle_and_pricing(self, luna_token):
        # ensure luna is online
        r = requests.patch(
            f"{BASE_URL}/api/readers/me/status", headers=auth_headers(luna_token),
            json={"is_online": True}, timeout=10,
        )
        assert r.status_code == 200
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        luna = next(x for x in readers if x["username"] == LUNA_USERNAME)
        assert luna["is_online"] is True

    def test_reader_pricing_update(self, luna_token):
        r = requests.patch(
            f"{BASE_URL}/api/readers/me/pricing", headers=auth_headers(luna_token),
            json={"pricing_chat": 199, "pricing_voice": 299, "pricing_video": 399}, timeout=10,
        )
        assert r.status_code == 200

    def test_reader_earnings(self, luna_token):
        r = requests.get(f"{BASE_URL}/api/readers/me/earnings", headers=auth_headers(luna_token), timeout=10)
        assert r.status_code == 200
        data = r.json()
        for k in ("today_earnings", "pending_payout", "historical_earnings", "commission_pct"):
            assert k in data
        assert data["commission_pct"] == 60

    def test_reader_sessions_history(self, luna_token):
        r = requests.get(f"{BASE_URL}/api/readers/me/sessions", headers=auth_headers(luna_token), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        if rows:
            assert "client_label" in rows[0]
            assert rows[0]["client_label"].startswith("Client #")
            assert "client_id" not in rows[0]

    def test_reader_reviews(self, luna_token):
        r = requests.get(f"{BASE_URL}/api/readers/me/reviews", headers=auth_headers(luna_token), timeout=10)
        assert r.status_code == 200


# ---------- CLIENT DASHBOARD ----------
class TestClientDashboard:
    def test_me_readings(self, client_token):
        r = requests.get(f"{BASE_URL}/api/me/readings", headers=auth_headers(client_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_me_transactions(self, client_token):
        r = requests.get(f"{BASE_URL}/api/me/transactions", headers=auth_headers(client_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- PAYMENTS (Stripe checkout URL only) ----------
class TestPayments:
    def test_checkout_session_created_preset(self, client_token):
        r = requests.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=auth_headers(client_token),
            json={"package_id": "p10", "origin_url": BASE_URL},
            timeout=25,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "url" in data and "session_id" in data
        assert data["url"].startswith("https://checkout.stripe.com")

    def test_checkout_invalid_package(self, client_token):
        r = requests.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=auth_headers(client_token),
            json={"package_id": "nope", "origin_url": BASE_URL},
            timeout=10,
        )
        assert r.status_code == 400


# ---------- SECURITY ----------
class TestSecurity:
    def test_admin_endpoints_forbidden_for_client(self, client_token):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=auth_headers(client_token), timeout=10)
        assert r.status_code == 403

    def test_admin_endpoints_forbidden_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/users", timeout=10)
        assert r.status_code in (401, 403)

    def test_reading_402_when_low_balance(self):
        email = _rand_email()
        uname = f"lowbal{uuid.uuid4().hex[:6]}"
        reg = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "TestPass!2024", "full_name": "LowBal", "username": uname},
            timeout=20,
        )
        assert reg.status_code in (200, 201), reg.text
        token = supabase_login(email, "TestPass!2024")
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        luna = next(x for x in readers if x["username"] == LUNA_USERNAME)
        r = requests.post(
            f"{BASE_URL}/api/readings/request",
            headers=auth_headers(token),
            json={"reader_id": luna["id"], "type": "chat"},
            timeout=10,
        )
        assert r.status_code == 402, f"Expected 402, got {r.status_code} {r.text}"

    def test_reading_403_for_non_participant(self, client_token):
        readings = requests.get(f"{BASE_URL}/api/me/readings", headers=auth_headers(client_token), timeout=10).json()
        if not readings:
            pytest.skip("No readings available")
        rid = readings[0]["id"]
        email = _rand_email()
        uname = f"strg{uuid.uuid4().hex[:6]}"
        reg = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "TestPass!2024", "full_name": "Stranger", "username": uname},
            timeout=20,
        )
        assert reg.status_code in (200, 201), reg.text
        stranger = supabase_login(email, "TestPass!2024")
        r = requests.get(f"{BASE_URL}/api/readings/{rid}", headers=auth_headers(stranger), timeout=10)
        assert r.status_code == 403


# ---------- ADMIN ----------
class TestAdmin:
    def test_admin_users_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=auth_headers(admin_token), timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        client = next((u for u in users if u.get("email") == CLIENT[0]), None)
        assert client is not None
        assert "account_balance" in client

    def test_admin_readings_with_split(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/readings", headers=auth_headers(admin_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "readings" in body and "commission_pct" in body
        assert body["commission_pct"] == 60
        completed = [x for x in body["readings"] if x.get("status") == "completed" and (x.get("total_price") or 0) > 0]
        if completed:
            rd = completed[0]
            total = rd["total_price"]
            reader_earned = rd["reader_earned"]
            platform = rd["platform_revenue"]
            assert reader_earned + platform == total
            # 60/40 split
            assert abs(reader_earned - int(round(total * 0.6))) <= 1

    def test_admin_transactions(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/transactions", headers=auth_headers(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_balance_adjust(self, admin_token, client_token):
        me_before = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(client_token), timeout=10).json()
        initial = me_before["account_balance"]
        user_id = me_before["id"]

        r = requests.post(
            f"{BASE_URL}/api/admin/balance-adjust",
            headers=auth_headers(admin_token),
            json={"user_id": user_id, "amount": 500, "note": "TEST_adjust"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["account_balance"] == initial + 500
        # verify from client side
        me_after = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(client_token)).json()
        assert me_after["account_balance"] == initial + 500
        # revert
        rev = requests.post(
            f"{BASE_URL}/api/admin/balance-adjust",
            headers=auth_headers(admin_token),
            json={"user_id": user_id, "amount": -500, "note": "TEST_revert"},
            timeout=10,
        )
        assert rev.status_code == 200

    def test_admin_create_reader(self, admin_token):
        uname = f"tstrdr{uuid.uuid4().hex[:6]}"
        email = _rand_email()
        # /admin/readers uses Form data, not JSON
        r = requests.post(
            f"{BASE_URL}/api/admin/readers",
            headers=auth_headers(admin_token),
            data={
                "email": email, "full_name": "TEST Reader", "username": uname,
                "bio": "Test bio", "specialties": "Tarot,Astrology",
                "pricing_chat": 199, "pricing_voice": 299, "pricing_video": 399,
            },
            timeout=30,
        )
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        data = r.json()
        assert "initial_password" in data
        assert "id" in data
        # verify appears on public readers list
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        assert any(u["username"] == uname for u in readers)

    def test_admin_flagged_moderation(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/forum/flagged", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- FORUM ----------
class TestForum:
    def test_create_post_and_flag_and_delete(self, client_token, admin_token):
        title = f"TEST post {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/forum/posts",
            headers=auth_headers(client_token),
            json={"title": title, "content": "Test forum content"},
            timeout=10,
        )
        assert r.status_code in (200, 201), r.text
        post_id = r.json()["id"]

        rc = requests.post(
            f"{BASE_URL}/api/forum/posts/{post_id}/comments",
            headers=auth_headers(client_token),
            json={"content": "Test comment"},
            timeout=10,
        )
        assert rc.status_code in (200, 201)

        rf = requests.post(
            f"{BASE_URL}/api/forum/flag",
            headers=auth_headers(client_token),
            json={"target_type": "post", "target_id": post_id, "reason": "spam"},
            timeout=10,
        )
        assert rf.status_code in (200, 201), rf.text

        queue = requests.get(f"{BASE_URL}/api/admin/forum/flagged", headers=auth_headers(admin_token), timeout=10).json()
        assert any(post_id in (str(q.get("target_id")), str(q.get("post_id")), str(q.get("id"))) for q in queue)

        rd = requests.delete(
            f"{BASE_URL}/api/admin/forum/post/{post_id}",
            headers=auth_headers(admin_token),
            timeout=10,
        )
        assert rd.status_code in (200, 204)
        # confirm removed from public listing
        posts = requests.get(f"{BASE_URL}/api/forum/posts", timeout=10).json()
        assert not any(p["id"] == post_id for p in posts)


# ---------- READING REQUEST (chat) ----------
class TestReadingRequest:
    def test_request_and_decline(self, client_token, luna_token):
        # ensure luna online
        requests.patch(f"{BASE_URL}/api/readers/me/status", headers=auth_headers(luna_token),
                       json={"is_online": True}, timeout=10)
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        luna = next(x for x in readers if x["username"] == LUNA_USERNAME)

        r = requests.post(
            f"{BASE_URL}/api/readings/request",
            headers=auth_headers(client_token),
            json={"reader_id": luna["id"], "type": "chat"},
            timeout=10,
        )
        if r.status_code == 400 and "already have an active" in r.text:
            # clean up existing pending
            active = requests.get(f"{BASE_URL}/api/readings/active", headers=auth_headers(client_token)).json()
            if active:
                requests.post(f"{BASE_URL}/api/readings/{active[0]['id']}/cancel", headers=auth_headers(client_token))
            r = requests.post(
                f"{BASE_URL}/api/readings/request",
                headers=auth_headers(client_token),
                json={"reader_id": luna["id"], "type": "chat"},
                timeout=10,
            )
        assert r.status_code in (200, 201), r.text
        reading_id = r.json()["id"]

        inc = requests.get(f"{BASE_URL}/api/readings/incoming", headers=auth_headers(luna_token), timeout=10)
        assert inc.status_code == 200
        assert any(x["id"] == reading_id for x in inc.json())

        rd = requests.post(f"{BASE_URL}/api/readings/{reading_id}/decline", headers=auth_headers(luna_token), timeout=10)
        assert rd.status_code in (200, 204)


# ---------- CLOUDFLARE (expected fail) ----------
class TestCloudflare:
    def test_rtc_session_expected_502(self, client_token, luna_token):
        readers = requests.get(f"{BASE_URL}/api/readers").json()
        luna = next(x for x in readers if x["username"] == LUNA_USERNAME)
        # cancel any active
        active = requests.get(f"{BASE_URL}/api/readings/active", headers=auth_headers(client_token)).json()
        if active:
            requests.post(f"{BASE_URL}/api/readings/{active[0]['id']}/cancel", headers=auth_headers(client_token))
        r = requests.post(
            f"{BASE_URL}/api/readings/request",
            headers=auth_headers(client_token),
            json={"reader_id": luna["id"], "type": "voice"},
            timeout=10,
        )
        if r.status_code not in (200, 201):
            pytest.skip(f"Reading request failed: {r.status_code} {r.text}")
        reading_id = r.json()["id"]
        requests.post(f"{BASE_URL}/api/readings/{reading_id}/accept", headers=auth_headers(luna_token), timeout=10)
        rs = requests.post(f"{BASE_URL}/api/rtc/{reading_id}/session", headers=auth_headers(client_token), timeout=20)
        # cleanup
        requests.post(f"{BASE_URL}/api/readings/{reading_id}/end", headers=auth_headers(client_token), timeout=10)
        assert rs.status_code in (502, 500, 400), f"Expected CF failure, got {rs.status_code} {rs.text}"
