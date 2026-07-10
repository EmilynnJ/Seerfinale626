import * as jose from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { resolveUser } from './rbac';
import '../types';

/**
 * Supabase Auth JWT verification.
 *
 * Every protected route validates the Supabase access token on every request
 * (no exceptions — build guide §14.1). Two verification modes:
 *   - HS256 with the project's legacy JWT secret (SUPABASE_JWT_SECRET), or
 *   - asymmetric keys fetched from the project's JWKS endpoint.
 *
 * The verified payload is attached as `req.auth = { payload, token }` with
 * `payload.sub` = the Supabase Auth user id (auth.users.id UUID).
 */

let hsSecret: Uint8Array | null = null;
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getVerifier(): {
  key: Uint8Array | ReturnType<typeof jose.createRemoteJWKSet>;
} {
  if (config.supabase.jwtSecret) {
    if (!hsSecret) hsSecret = new TextEncoder().encode(config.supabase.jwtSecret);
    return { key: hsSecret };
  }
  if (!config.supabase.jwksUrl) {
    throw new Error(
      'Supabase JWT verification is not configured. Set SUPABASE_JWT_SECRET or SUPABASE_URL/SUPABASE_JWKS_URL.',
    );
  }
  if (!jwks) jwks = jose.createRemoteJWKSet(new URL(config.supabase.jwksUrl));
  return { key: jwks };
}

/** Verify a raw Supabase access token. Throws on any validation failure. */
export async function verifySupabaseToken(
  token: string,
): Promise<jose.JWTPayload & { email?: string }> {
  const { key } = getVerifier();
  const options: jose.JWTVerifyOptions = { audience: 'authenticated' };
  if (config.supabase.issuer) options.issuer = config.supabase.issuer;
  const { payload } =
    key instanceof Uint8Array
      ? await jose.jwtVerify(token, key, options)
      : await jose.jwtVerify(token, key, options);
  return payload as jose.JWTPayload & { email?: string };
}

/**
 * JWT-only middleware: verifies the Supabase access token in the
 * Authorization header and attaches `req.auth`. Does NOT resolve the internal
 * user row — used on /sync where the row may not exist yet.
 */
export function checkJwt(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  verifySupabaseToken(token)
    .then((payload) => {
      req.auth = { payload, token };
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

/**
 * Combined middleware: validate JWT + resolve internal user record.
 * After this middleware runs, `req.user` is populated with the full DB user object.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  checkJwt(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    resolveUser(req, res, next);
  });
}
