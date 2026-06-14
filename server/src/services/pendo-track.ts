import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Fire-and-forget server-side Pendo Track Event.
 * Failures are logged but never block application flow.
 *
 * F-009: integration key is now read from config. If not configured, the
 * function short-circuits so a missing key doesn't generate failed network
 * calls (or worse, leak the absence to monitoring).
 */
export function pendoTrack(
  event: string,
  visitorId: string | number,
  accountId: string | number,
  properties: Record<string, unknown> = {},
): void {
  if (!config.pendo.enabled) {
    return;
  }

  const body = JSON.stringify({
    type: 'track',
    event,
    visitorId: String(visitorId),
    accountId: String(accountId),
    timestamp: Date.now(),
    properties,
  });

  fetch('https://data.pendo.io/data/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pendo-integration-key': config.pendo.integrationKey,
    },
    body,
    // F-047: bound the request so a slow Pendo endpoint cannot hold sockets
    // open on the event loop.
    signal: AbortSignal.timeout(2000),
  }).catch((err) => {
    // F-090: only log the event name + error message, never the full body,
    // so future PII additions to `properties` don't get persisted to logs.
    logger.warn(
      { event, err: (err as Error).message },
      'Pendo track event failed',
    );
  });
}
