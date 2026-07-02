import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import psycopg
from supabase import create_client

DB_URL = os.environ["SUPABASE_DB_URL"]
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

SEEDS = [
    ("admin@soulseer.com", "SoulSeerAdmin!2024", "admin", "Emilynn", "emilynn", "", [], "", 0, 0, 0),
    ("luna@soulseer.com", "ReaderPass!2024", "reader", "Luna Starweaver", "lunastarweaver",
     "Third-generation psychic medium specializing in tarot and celestial guidance. I connect with spirit to bring you clarity, healing, and truth on your soul's journey.",
     ["Tarot", "Mediumship", "Love & Relationships"],
     "https://images.unsplash.com/photo-1610737241336-371badac3b66?w=400&q=80", 199, 299, 399),
    ("orion@soulseer.com", "ReaderPass!2024", "reader", "Orion Sage", "orionsage",
     "Intuitive empath and astrologer with 15 years of experience. I read the stars and your energy to illuminate your path forward in career, love, and spiritual growth.",
     ["Astrology", "Career Guidance", "Energy Healing"],
     "https://images.unsplash.com/photo-1601412436009-d964bd02edbc?w=400&q=80", 149, 249, 349),
]


def get_or_create_auth_user(email, password):
    try:
        res = sb.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
        return res.user.id
    except Exception:
        page = sb.auth.admin.list_users()
        users = page if isinstance(page, list) else getattr(page, "users", [])
        for u in users:
            if u.email == email:
                return u.id
        raise


def main():
    schema = (Path(__file__).parent / "schema.sql").read_text()
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute(schema)
        print("Schema applied")
        for email, password, role, full_name, username, bio, specs, img, pc, pv, pvd in SEEDS:
            auth_id = get_or_create_auth_user(email, password)
            conn.execute(
                """insert into users (auth_id, email, username, full_name, role, bio, specialties, profile_image, pricing_chat, pricing_voice, pricing_video, is_online)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   on conflict (email) do update set auth_id=excluded.auth_id, role=excluded.role""",
                (auth_id, email, username, full_name, role, bio, specs, img, pc, pv, pvd, role == "reader"),
            )
            print(f"Seeded {role}: {email}")
    try:
        sb.storage.create_bucket("profiles", options={"public": True})
        print("Bucket created")
    except Exception as e:
        print(f"Bucket: {e}")


if __name__ == "__main__":
    main()
