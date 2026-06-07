import { logger } from "../utils/logger";

const PENDO_TRACK_URL = "https://data.pendo.io/data/track";
const PENDO_INTEGRATION_KEY = "3e8ba4b6-557e-47a2-aec3-09ac7185088f";

/**
 * Fire-and-forget server-side Pendo Track Event.
 * Failures are logged but never block application flow.
 */
export function pendoTrack(
  event: string,
  visitorId: string | number,
  accountId: string | number,
  properties: Record<string, unknown> = {},
): void {
  const body = JSON.stringify({
    type: "track",
    event,
    visitorId: String(visitorId),
    accountId: String(accountId),
    timestamp: Date.now(),
    properties,
  });

  fetch(PENDO_TRACK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pendo-integration-key": PENDO_INTEGRATION_KEY,
    },
    body,
  }).catch((err) => {
    logger.warn({ err, event }, "Pendo track event failed");
  });
}
