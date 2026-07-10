/**
 * Config smoke tests -- verify environment config loads properly.
 */
import { describe, it, expect } from 'vitest';
import { config } from '../config';

describe('Server Config', () => {
  it('loads config from environment variables', () => {
    expect(config).toBeDefined();
    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(5001);
    expect(config.corsOrigin).toBe('http://localhost:3000');
  });

  it('has supabase configuration', () => {
    expect(config.supabase).toBeDefined();
    expect(config.supabase.url).toBe('https://test-project.supabase.co');
    expect(config.supabase.issuer).toBe('https://test-project.supabase.co/auth/v1');
    expect(config.supabase.jwksUrl).toBe(
      'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
    );
    expect(config.supabase.adminEnabled).toBe(true);
  });

  it('has cloudflare realtime configuration', () => {
    expect(config.realtime).toBeDefined();
    expect(config.realtime.appId).toBeTruthy();
    expect(config.realtime.enabled).toBe(true);
    expect(config.realtime.baseUrl).toBe('https://rtc.live.cloudflare.com/v1');
    expect(config.realtime.tokenExpiration).toBe(3600);
  });

  it('has stripe configuration', () => {
    expect(config.stripe).toBeDefined();
    expect(config.stripe.secretKey).toBeTruthy();
    expect(config.stripe.webhookSecret).toBeTruthy();
  });

  it('has database configuration', () => {
    expect(config.database).toBeDefined();
    expect(config.database.url).toBeTruthy();
  });
});
