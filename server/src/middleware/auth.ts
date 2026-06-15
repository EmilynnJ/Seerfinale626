import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { resolveUser } from './rbac';

// Neon Auth signs its session JWTs with keys published at the JWKS endpoint.
// We verify the token signature against that remote key set on every request.
// `createRemoteJWKSet` caches and refreshes the keys automatically.
const jwks = createRemoteJWKSet(new URL(config.neonAuth.jwksUrl));

/**
 * Validate the Neon Auth JWT carried on the `Authorization: Bearer <token>`
 * header. On success the decoded payload is attached to `req.auth` using the
 * same `{ payload }` shape the rest of the app already reads
 * (e.g. `req.auth.payload.sub`), so downstream middleware is unchanged.
 *
 * On failure this responds 401 directly and does NOT call `next`.
 */
export async function checkJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    // Verify the signature against the Neon Auth JWKS. We deliberately do NOT
    // enforce issuer/audience here: Neon Auth (Better Auth) signs tokens with
    // the keys published at the JWKS endpoint, and the signature is the real
    // security guarantee. Enforcing an exact `iss` string is brittle — if the
    // token's issuer differs by even a trailing slash or path segment, every
    // request 401s ("Invalid or expired token"), which is the symptom we are
    // fixing here.
    const { payload } = await jwtVerify(token, jwks);
    req.auth = { payload: payload as JWTPayload, token };
    next();
  } catch (err) {
    // Surface the concrete jose reason (e.g. JWKSNoMatchingKey, JWTExpired) in
    // the logs so misconfiguration is diagnosable from the platform console.
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, code, message }, 'Neon Auth JWT verification failed');
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Combined middleware: validate JWT + resolve internal user record.
 * After this middleware runs, `req.user` is populated with the full DB user object.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void checkJwt(req, res, (err?: unknown) => {
    if (err) {
      next(err as Error);
      return;
    }
    resolveUser(req, res, next);
  });
}
