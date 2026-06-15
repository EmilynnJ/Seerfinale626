import { randomInt } from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Neon Auth (Better Auth) admin/provisioning wrapper.
 *
 * Replaces the former Auth0 Management API integration. User creation goes
 * through Better Auth's hosted email/password sign-up endpoint
 * (`POST {authUrl}/sign-up/email`), which returns the new user's id — the value
 * stored in `users.auth0_id` (kept as the column name; it now holds the Neon
 * Auth user id).
 *
 * Server-side deletion of a Neon Auth user requires privileged credentials the
 * API does not hold, so `deleteUser` is a logged no-op; callers already scrub
 * the local DB row, which is what gates application access.
 */
class NeonAuthAdminService {
  get enabled(): boolean {
    return Boolean(config.neonAuth.authUrl);
  }

  private baseUrl(): string {
    if (!this.enabled) {
      throw new Error(
        'Neon Auth is not configured. Set VITE_NEON_AUTH_URL (or NEON_AUTH_URL).',
      );
    }
    return config.neonAuth.authUrl;
  }

  /**
   * Generate a cryptographically strong password (length ≥ 16, upper, lower,
   * digit, symbol) suitable as an initial credential.
   */
  generatePassword(length = 18): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*-_=+?';
    const all = upper + lower + digits + symbols;
    const required = [upper, lower, digits, symbols];

    const chars: string[] = [];
    for (let i = 0; i < required.length; i++) {
      chars.push(required[i]![randomInt(required[i]!.length)]!);
    }
    for (let i = required.length; i < length; i++) {
      chars.push(all[randomInt(all.length)]!);
    }
    // Fisher–Yates shuffle using unbiased cryptographic random indices
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  }

  /**
   * Call Better Auth's email/password sign-up. Returns the new user id, or
   * `{ conflict: true }` when a user with that email already exists.
   */
  private async signUpEmail(params: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ id: string } | { conflict: true }> {
    // Resolve the endpoint before the try so a "not configured" error surfaces
    // cleanly instead of being wrapped as an "unreachable" network error.
    const endpoint = `${this.baseUrl()}/sign-up/email`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: params.email,
          password: params.password,
          name: params.name,
        }),
      });
    } catch (err) {
      logger.error({ err, email: params.email }, 'Neon Auth sign-up request failed');
      throw new Error(`Neon Auth is unreachable: ${(err as Error).message}`);
    }

    const body: { user?: { id?: string }; message?: string; code?: string } = await res
      .json()
      .catch(() => ({}));

    if (res.ok) {
      const id = body?.user?.id;
      if (!id) {
        throw new Error('Neon Auth did not return a user id');
      }
      return { id };
    }

    const code = body?.code ?? '';
    const message = body?.message ?? `HTTP ${res.status}`;
    const isConflict =
      res.status === 409 ||
      res.status === 422 ||
      /already|exists|duplicate/i.test(`${code} ${message}`);
    if (isConflict) {
      return { conflict: true };
    }
    throw new Error(`Neon Auth user creation failed: ${message}`);
  }

  /**
   * Create a Neon Auth user with a generated password.
   * Returns the Neon Auth user id (as `auth0Id` to match the DB column) and the
   * generated password. The caller delivers the password to the reader.
   */
  async createUserWithPassword(params: {
    email: string;
    fullName: string;
    username?: string | null;
  }): Promise<{ auth0Id: string; password: string }> {
    const password = this.generatePassword();
    const result = await this.signUpEmail({
      email: params.email,
      password,
      name: params.fullName,
    });
    if ('conflict' in result) {
      throw new Error(`Neon Auth user with email ${params.email} already exists`);
    }
    logger.info({ userId: result.id, email: params.email }, 'Neon Auth user created via sign-up');
    return { auth0Id: result.id, password };
  }

  /**
   * Create a Neon Auth user with a known password (QA provisioning).
   * If the user already exists, returns `created: false` — server-side password
   * reset requires the Neon Auth dashboard.
   */
  async upsertUserWithPassword(params: {
    email: string;
    password: string;
    fullName: string;
    role: 'admin' | 'reader' | 'client';
    username?: string | null;
  }): Promise<{ auth0Id: string; created: boolean }> {
    const result = await this.signUpEmail({
      email: params.email,
      password: params.password,
      name: params.fullName,
    });
    if ('conflict' in result) {
      throw new Error(
        `Neon Auth user already exists for ${params.email}; reset the password from the Neon Auth dashboard`,
      );
    }
    return { auth0Id: result.id, created: true };
  }

  /**
   * Delete a Neon Auth user. Server-side deletion is not available without
   * privileged Neon Auth credentials, so this is a logged no-op — the caller's
   * local DB scrub is what revokes application access.
   */
  async deleteUser(neonUserId: string): Promise<boolean> {
    logger.warn(
      { neonUserId },
      'Neon Auth user deletion skipped (not supported via server credentials); local data scrubbed instead',
    );
    return false;
  }
}

export const neonAuthAdminService = new NeonAuthAdminService();
