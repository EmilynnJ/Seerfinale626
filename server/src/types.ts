import type { InferSelectModel } from 'drizzle-orm';
import type { JWTPayload } from 'jose';
import type { users, readings } from './db/schema';

export type User = InferSelectModel<typeof users>;
export type Reading = InferSelectModel<typeof readings>;

/**
 * Decoded auth context attached to each authenticated request by the JWT
 * middleware. Mirrors the minimal shape the app reads (`req.auth.payload.sub`,
 * `req.auth.payload.email`). Populated from a verified Neon Auth JWT.
 */
export interface AuthResult {
  payload: JWTPayload;
  token?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      reading?: Reading;
      auth?: AuthResult;
    }
  }
}
