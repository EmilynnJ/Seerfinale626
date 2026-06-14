import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Monorepo root .env (npm run dev -w server uses server/ as cwd).
loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '../.env') });
