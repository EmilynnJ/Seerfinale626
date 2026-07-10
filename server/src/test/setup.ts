/**
 * Vitest setup for server tests.
 * Runs before each test file.
 */

// Set test environment variables so config.ts doesn't exit the process
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/soulseer_test';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234';
process.env.CLOUDFLARE_REALTIME_APP_ID = 'test-realtime-app-id';
process.env.CLOUDFLARE_REALTIME_TOKEN = 'test-realtime-token';
process.env.CLOUDFLARE_TURN_KEY_ID = 'test-turn-key-id';
process.env.CLOUDFLARE_TURN_API_TOKEN = 'test-turn-api-token';
process.env.CLOUDFLARE_MOQ_RELAY_URL = 'https://relay.test.mediaoverquic.com';
process.env.STRIPE_SECRET_KEY = 'STRIPE_SECRET_KEY_TEST_PLACEHOLDER';
process.env.STRIPE_WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET_TEST_PLACEHOLDER';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.PORT = '5001';
