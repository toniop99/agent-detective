import { LinearClient } from '@linear/sdk';
import type { Logger } from '@agent-detective/sdk';

/**
 * GraphQL client for real Linear API calls. Task routing and mutations are
 * wired incrementally; constructing the client validates credentials early.
 */
export function createRealLinearClient(apiKey: string, logger?: Logger): LinearClient {
  if (!apiKey.trim()) {
    throw new Error('linear-adapter: apiKey is required when mockMode is false');
  }
  logger?.info('linear-adapter: LinearClient initialized (GraphQL mutations not yet wired to webhooks)');
  return new LinearClient({ apiKey });
}
