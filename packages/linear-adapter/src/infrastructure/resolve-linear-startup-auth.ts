import type { Logger } from '@agent-detective/sdk';
import type { LinearAdapterConfig } from '../application/options-schema.js';
import { exchangeLinearRefreshToken } from './linear-oauth.js';

/** How the GraphQL client authenticates to Linear. */
export type LinearGraphAuth =
  | { mode: 'pat'; token: string }
  | {
      mode: 'oauth';
      accessToken: string;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      /** When known (from token response `expires_in`), used for proactive refresh. */
      expiresAtMs?: number;
    };

function hasOAuthRefreshBundle(cfg: LinearAdapterConfig): boolean {
  return Boolean(
    cfg.oauthClientId?.trim() && cfg.oauthClientSecret?.trim() && cfg.oauthRefreshToken?.trim()
  );
}

/**
 * Resolve PAT vs OAuth credentials for {@link createLinearGraph}.
 *
 * - **PAT:** `apiKey` only (no refresh bundle) → `LinearClient` with `apiKey`.
 * - **OAuth:** `oauthClientId`, `oauthClientSecret`, and `oauthRefreshToken` set.
 *   - If `apiKey` is set, it is treated as the current **access token** (e.g. `LINEAR_API_KEY`).
 *   - If `apiKey` is empty, the access token is obtained once via refresh_token grant at startup.
 */
export async function resolveLinearStartupAuth(
  cfg: LinearAdapterConfig,
  logger?: Logger
): Promise<LinearGraphAuth | null> {
  const api = cfg.apiKey?.trim() ?? '';
  if (hasOAuthRefreshBundle(cfg)) {
    const clientId = cfg.oauthClientId!.trim();
    const clientSecret = cfg.oauthClientSecret!.trim();
    let refreshToken = cfg.oauthRefreshToken!.trim();
    let accessToken = api;
    let expiresAtMs: number | undefined;

    if (!accessToken) {
      logger?.info('linear-adapter: obtaining initial OAuth access token via refresh_token grant');
      const tokens = await exchangeLinearRefreshToken({
        clientId,
        clientSecret,
        refreshToken,
      });
      accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        refreshToken = tokens.refresh_token;
        logger?.warn(
          'linear-adapter: OAuth refresh returned a new refresh_token — persist it (e.g. LINEAR_OAUTH_REFRESH_TOKEN) so restarts keep working'
        );
      }
      if (typeof tokens.expires_in === 'number') {
        expiresAtMs = Date.now() + tokens.expires_in * 1000;
      }
    }

    return {
      mode: 'oauth',
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      expiresAtMs,
    };
  }

  if (!api) return null;
  return { mode: 'pat', token: api };
}
