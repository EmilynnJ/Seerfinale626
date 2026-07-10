import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Supabase Auth admin API wrapper for programmatic user creation.
 *
 * Reader accounts are admin-created ONLY (build guide §5.1) — they are
 * provisioned here via the Auth admin API using the service-role key, never
 * through self-registration. Role lives in our own users table, NOT in
 * Supabase Auth metadata.
 *
 * When credentials are not configured, the service throws a clearly-named
 * error so callers can degrade gracefully.
 */
class SupabaseAdminService {
  private client: SupabaseClient | null = null;

  get enabled(): boolean {
    return config.supabase.adminEnabled;
  }

  private getClient(): SupabaseClient {
    if (!this.enabled) {
      throw new Error(
        'Supabase admin API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    if (!this.client) {
      this.client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return this.client;
  }

  /**
   * Generate a cryptographically strong password (length ≥ 16, upper, lower,
   * digit, symbol).
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

  private isAlreadyExistsError(message: string, status?: number): boolean {
    return (
      status === 409 ||
      status === 422 ||
      /already (been )?registered|already exists|email_exists/i.test(message)
    );
  }

  /** Find a Supabase Auth user id by email, paging through the admin list. */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const client = this.getClient();
    const target = email.toLowerCase();
    const perPage = 200;
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`Supabase listUsers failed: ${error.message}`);
      const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
      if (match) return match.id;
      if (data.users.length < perPage) break;
    }
    return null;
  }

  /**
   * Create a Supabase Auth user with a generated password.
   * Returns the Supabase user id (UUID) and the generated password.
   * The caller is responsible for delivering the password to the reader.
   */
  async createUserWithPassword(params: {
    email: string;
    fullName: string;
    username?: string | null;
  }): Promise<{ supabaseId: string; password: string }> {
    const client = this.getClient();
    const password = this.generatePassword();

    const { data, error } = await client.auth.admin.createUser({
      email: params.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: params.fullName,
        ...(params.username ? { username: params.username } : {}),
        source: 'admin-provisioned',
      },
    });

    if (error) {
      logger.error(
        { err: error, status: error.status, email: params.email },
        'Supabase user creation failed',
      );
      if (this.isAlreadyExistsError(error.message, error.status)) {
        throw new Error(`A Supabase user with email ${params.email} already exists`);
      }
      throw new Error(`Supabase user creation failed: ${error.message}`);
    }
    if (!data.user?.id) {
      throw new Error('Supabase did not return a user id');
    }

    logger.info(
      { supabaseId: data.user.id, email: params.email },
      'Supabase Auth user created via admin API',
    );

    return { supabaseId: data.user.id, password };
  }

  /**
   * Create the user, or if one already exists with the same email, update the
   * password to the supplied value. Used for QA test-account provisioning where
   * the caller wants a known, repeatable password.
   */
  async upsertUserWithPassword(params: {
    email: string;
    password: string;
    fullName: string;
    role: 'admin' | 'reader' | 'client';
    username?: string | null;
  }): Promise<{ supabaseId: string; created: boolean }> {
    const client = this.getClient();
    const { data, error } = await client.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: {
        full_name: params.fullName,
        ...(params.username ? { username: params.username } : {}),
        source: 'test-provisioning',
      },
    });

    if (!error) {
      const id = data.user?.id;
      if (!id) throw new Error('Supabase did not return a user id');
      return { supabaseId: id, created: true };
    }

    if (!this.isAlreadyExistsError(error.message, error.status)) {
      throw new Error(`Supabase user creation failed: ${error.message}`);
    }

    const existingId = await this.findUserIdByEmail(params.email);
    if (!existingId) {
      throw new Error(
        `Supabase user exists for ${params.email} but the id could not be resolved`,
      );
    }
    const { error: updateErr } = await client.auth.admin.updateUserById(existingId, {
      password: params.password,
      email_confirm: true,
    });
    if (updateErr) {
      throw new Error(`Supabase password update failed: ${updateErr.message}`);
    }
    return { supabaseId: existingId, created: false };
  }

  /**
   * Delete a Supabase Auth user. Idempotent — returns true if the user was
   * deleted or did not exist, false if the service is disabled.
   */
  async deleteUser(supabaseId: string): Promise<boolean> {
    if (!this.enabled) {
      logger.warn({ supabaseId }, 'Supabase deleteUser skipped — admin API not configured');
      return false;
    }
    const client = this.getClient();
    const { error } = await client.auth.admin.deleteUser(supabaseId);
    if (error) {
      if (error.status === 404) {
        // Already gone — treat as success.
        return true;
      }
      logger.error({ err: error, supabaseId }, 'Supabase user deletion failed');
      throw new Error(`Supabase user deletion failed: ${error.message}`);
    }
    logger.info({ supabaseId }, 'Supabase Auth user deleted');
    return true;
  }
}

export const supabaseAdminService = new SupabaseAdminService();
