# Environment Variables Security Guide

## Quick Reference

### ✅ DO: Use VITE_ prefix for client-side variables
```bash
VITE_API_URL=https://api.example.com
VITE_AUTH0_DOMAIN=example.auth0.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### ❌ DON'T: Use VITE_ prefix for server secrets
```bash
# These should NEVER have VITE_ prefix:
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_live_...
AUTH0_MGMT_CLIENT_SECRET=...
```

## Security Fix Details

### What Changed?
The Vite configuration was updated to restrict environment variable loading:

**Before (UNSAFE):**
```typescript
const env = loadEnv(mode, process.cwd(), '');  // Loads ALL variables
```

**After (SAFE):**
```typescript
const env = loadEnv(mode, process.cwd(), 'VITE_');  // Only loads VITE_* variables
```

### Why This Matters
Without the prefix restriction, **all environment variables** (including sensitive secrets like database passwords, API keys, and CI/CD tokens) would be embedded in the client-side JavaScript bundle and publicly accessible in the browser.

## Variable Categories

### 1. Client-Safe (Use VITE_ prefix)
These are safe to expose in the browser:
- `VITE_API_URL` - Public API endpoint
- `VITE_AUTH0_DOMAIN` - Auth0 tenant domain (public)
- `VITE_AUTH0_CLIENT_ID` - Auth0 SPA client ID (public)
- `VITE_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key (public)
- `VITE_AGORA_APP_ID` - Agora app ID (public)

### 2. Server-Only (NO VITE_ prefix)
These must remain server-side:
- `DATABASE_URL` - Database connection string
- `STRIPE_SECRET_KEY` - Stripe secret key
- `AUTH0_MGMT_CLIENT_SECRET` - Auth0 management API secret
- `CLOUDINARY_API_SECRET` - Cloudinary API secret
- `SESSION_SECRET` - Session encryption key
- Any CI/CD tokens (GITHUB_TOKEN, NPM_TOKEN, etc.)

## Testing

Run the security tests to verify the fix:
```bash
cd client
npm test vite-config
```

The test suite validates:
- ✅ Only VITE_ prefixed variables are loaded
- ✅ Sensitive secrets are filtered out
- ✅ Auth0 variable hoisting works correctly
- ✅ No regression in environment handling

## Deployment Checklist

When deploying, ensure:

1. **Client variables** have `VITE_` prefix in your deployment platform (Vercel, Netlify, etc.)
2. **Server variables** do NOT have `VITE_` prefix
3. Review the build output - no secrets should appear in `dist/assets/*.js`
4. Test in production that Auth0 login works (validates VITE_ prefixed vars are loaded)

## Common Issues

### Issue: "Auth0 is missing required values" warning
**Cause:** Auth0 environment variables don't have VITE_ prefix  
**Fix:** Add VITE_ prefix to Auth0 variables in your deployment config

### Issue: API calls fail with undefined URL
**Cause:** VITE_API_URL not set or missing VITE_ prefix  
**Fix:** Ensure `VITE_API_URL` is set in your environment

### Issue: Environment variable not available in client
**Cause:** Variable doesn't have VITE_ prefix  
**Fix:** Add VITE_ prefix if it's safe for client-side use

## Migration from Old Config

If you have existing deployments without VITE_ prefixed Auth0 variables:

1. The `deriveClientAuth0Env` function provides backward compatibility
2. It will still read non-VITE_ Auth0 variables from `process.env`
3. However, for security, you should migrate to VITE_ prefixed variables
4. Update your deployment platform environment variables:
   - `AUTH0_DOMAIN` → `VITE_AUTH0_DOMAIN`
   - `AUTH0_CLIENT_ID` → `VITE_AUTH0_CLIENT_ID`
   - etc.

## References

- Test suite: `client/src/test/vite-config.test.ts`
- Test documentation: `client/src/test/vite-config.test.md`
- Example config: `client/.env.example`
- Vite config: `client/vite.config.ts`
- Vite docs: https://vitejs.dev/guide/env-and-mode.html
