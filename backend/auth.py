import os
import time
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from db import fetch_one

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]

security = HTTPBearer(auto_error=False)
_cache = {}


async def verify_token(token: str) -> dict:
    now = time.time()
    hit = _cache.get(token)
    if hit and hit[1] > now:
        return hit[0]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    data = r.json()
    if len(_cache) > 2000:
        _cache.clear()
    _cache[token] = (data, now + 60)
    return data


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    auth_user = await verify_token(credentials.credentials)
    row = await fetch_one("select * from users where auth_id = %s", (auth_user["id"],))
    if not row:
        raise HTTPException(status_code=403, detail="Account not synced")
    return row


def require_role(*roles):
    async def dep(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


async def user_from_token(token: str):
    auth_user = await verify_token(token)
    return await fetch_one("select * from users where auth_id = %s", (auth_user["id"],))
