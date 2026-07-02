# SoulSeer Test Credentials

Auth is Supabase (email/password). Login at /login.

| Role   | Email                   | Password          |
|--------|-------------------------|-------------------|
| Admin  | admin@soulseer.com      | SoulSeerAdmin!2024 |
| Reader | luna@soulseer.com       | ReaderPass!2024   |
| Reader | orion@soulseer.com      | ReaderPass!2024   |
| Client | testclient@soulseer.com | ClientPass!2024   |

Notes:
- Clients can self-register at /login (Sign up mode) — backend endpoint POST /api/auth/register (auto email-confirm).
- Supabase project: https://iznypsetnntofngglngk.supabase.co (keys in /app/backend/.env)
- Stripe uses LIVE keys — do NOT complete real payments in tests; only verify checkout session URL creation.
- Cloudflare Realtime App ID currently invalid (per CF API) — voice/video media won't connect until user supplies valid App ID/secret; chat readings fully functional.
