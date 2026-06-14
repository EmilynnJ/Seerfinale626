import { PostHog } from 'posthog-node';
import { config } from '../config';

const posthog = new PostHog(config.posthog.apiKey, {
  host: config.posthog.host,
  disabled: !config.posthog.enabled,
});

export default posthog;
