import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { config } from '../config';
import { logger } from '../utils/logger';

const { Pool } = pg;

// Supabase Postgres requires TLS for remote connections; local test/dev
// databases (localhost) don't speak TLS at all.
const isLocal =
  config.database.url.includes('localhost') ||
  config.database.url.includes('127.0.0.1');

export const pool = new Pool({
  connectionString: config.database.url,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // Fail fast on bad/missing connection strings instead of hanging a
  // serverless function until the platform kills it.
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

export const db = drizzle(pool, { schema });

/** Alias for `db` — used in route handlers for consistency */
export function getDb() {
  return db;
}

/** Get the raw pool for direct queries */
export function getPool() {
  return pool;
}
