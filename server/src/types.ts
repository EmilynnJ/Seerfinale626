import type { InferSelectModel } from 'drizzle-orm';
import type { JWTPayload } from 'jose';
import type { users, readings } from './db/schema';

export type User = InferSelectModel<typeof users>;
export type Reading = InferSelectModel<typeof readings>;

/** Verified Supabase Auth JWT attached to the request by `checkJwt`. */
export interface SupabaseAuthResult {
  payload: JWTPayload & { email?: string };
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      reading?: Reading;
      auth?: SupabaseAuthResult;
    }
  }
}
