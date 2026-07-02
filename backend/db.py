import os
from dotenv import load_dotenv
from pathlib import Path
from psycopg_pool import AsyncConnectionPool
from psycopg.rows import dict_row

load_dotenv(Path(__file__).parent / ".env")

DB_URL = os.environ["SUPABASE_DB_URL"]

pool = AsyncConnectionPool(DB_URL, min_size=1, max_size=8, open=False, kwargs={"row_factory": dict_row})


async def fetch_one(query, params=None):
    async with pool.connection() as conn:
        cur = await conn.execute(query, params)
        return await cur.fetchone()


async def fetch_all(query, params=None):
    async with pool.connection() as conn:
        cur = await conn.execute(query, params)
        return await cur.fetchall()


async def execute(query, params=None):
    async with pool.connection() as conn:
        await conn.execute(query, params)


def clean(row):
    if row is None:
        return None
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = str(v) if type(v).__name__ == "UUID" else v
    return out
