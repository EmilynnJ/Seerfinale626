# Vite Config Security Fix - Test Documentation

## Overview
This test suite validates the security fix applied to `client/vite.config.ts` that restricts environment variable loading to only those with the `VITE_` prefix, preventing sensitive CI/CD secrets from being exposed in the client-side bundle.

## Test Coverage

### 1. Environment Variable Prefix Restriction
Tests that verify the core security fix:

- **`should only load VITE_ prefixed variables after fix`**
  - Validates that only `VITE_` prefixed variables are loaded
  - Ensures sensitive variables (DATABASE_URL, SECRET_KEY, AWS_SECRET_ACCESS_KEY) are not present

- **`should prevent exposure of CI/CD secrets`**
  - Simulates a CI/CD environment with various tokens
  - Verifies that CI_SECRET_TOKEN, GITHUB_TOKEN, NPM_TOKEN are filtered out
  - Confirms only VITE_PUBLIC_VAR is accessible

### 2. deriveClientAuth0Env Function Tests
Tests for the Auth0 environment variable hoisting logic:

- **Priority and Fallback Logic**
  - Verifies VITE_ prefixed Auth0 variables take priority
  - Tests fallback to non-VITE_ Auth0 variables when needed
  - Ensures AUTH0_APP_ID is NOT used as clientId (avoids management API collision)

- **URL Normalization**
  - Tests protocol stripping (https://, http://)
  - Tests trailing slash removal from domain and redirectUri
  - Validates various domain source formats (AUTH0_DOMAIN_URL, AUTH0_ISSUER_BASE_URL)

- **Audience Derivation**
  - Tests automatic audience generation from domain
  - Validates explicit audience override
  - Tests AUTH0_IDENTIFIER as fallback

- **Edge Cases**
  - Empty environment (all values should be empty strings)
  - Various Auth0 variable name combinations

### 3. Security Regression Tests
Tests that verify specific sensitive data types are protected:

- **Database Credentials**
  - DATABASE_URL, DB_PASSWORD should not be exposed

- **API Keys and Tokens**
  - STRIPE_SECRET_KEY, AUTH0_MGMT_CLIENT_SECRET, CLOUDINARY_API_SECRET should be filtered

- **Deployment and Infrastructure Secrets**
  - VERCEL_TOKEN, FLY_API_TOKEN, DOCKER_PASSWORD should not be accessible

### 4. Integration Scenarios
Real-world configuration tests:

- **Production Environment**
  - Tests typical production setup with VITE_ prefixed client vars
  - Verifies server secrets (DATABASE_URL, STRIPE_SECRET_KEY) are excluded

- **Vercel-style Environment**
  - Tests deployment scenario where non-VITE_ Auth0 vars exist
  - Validates that deriveClientAuth0Env returns empty values when VITE_ vars are missing

## Security Impact

### Before the Fix
```typescript
const env = loadEnv(mode, process.cwd(), '');
```
- **Risk**: All environment variables loaded into client bundle
- **Exposure**: CI/CD secrets, API keys, database credentials visible in browser

### After the Fix
```typescript
const env = loadEnv(mode, process.cwd(), 'VITE_');
```
- **Protection**: Only VITE_ prefixed variables loaded
- **Result**: Sensitive secrets remain server-side only

## Running the Tests

```bash
# Run all tests
npm test

# Run only vite-config tests
npm test vite-config

# Run with coverage
npm run test:coverage
```

## Expected Behavior

1. **Client-safe variables** (prefixed with `VITE_`) are loaded and accessible
2. **Server-only variables** (no VITE_ prefix) are filtered out
3. **deriveClientAuth0Env** still works with fallback logic for backward compatibility
4. **Build-time warnings** alert developers when Auth0 config is incomplete

## Migration Notes

After this fix, developers must:
1. Prefix all client-needed environment variables with `VITE_`
2. Keep server-only secrets without the `VITE_` prefix
3. Update deployment configurations to include VITE_ prefixed Auth0 variables if needed

## Related Files
- `client/vite.config.ts` - The configuration file being tested
- `client/.env.example` - Example environment variables
- `docs/BUILD_GUIDE.md` - Build and deployment documentation
