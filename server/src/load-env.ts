import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// In tests, env comes exclusively from the vitest setup file. Skip loading
// local .env files so a developer's .env can't leak into (and flake) tests.
if (process.env.NODE_ENV !== 'test') {
  // Monorepo root .env (npm run dev -w server uses server/ as cwd).
  loadEnv({ path: resolve(__dirname, '../../.env') });
  loadEnv({ path: resolve(__dirname, '../.env') });
}
