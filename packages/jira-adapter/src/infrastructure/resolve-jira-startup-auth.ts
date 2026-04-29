import type { Logger } from '@agent-detective/sdk';
import type { JiraAdapterConfig } from '../domain/types.js';
import { exchangeJiraRefreshToken } from './jira-oauth.js';

export type JiraStartupAuth =
  | {
      mode: 'basic';
      baseUrl: string;
      email: string;
      apiToken: string;
    }
  | {
      mode: 'oauth';
      cloudId: string;
      accessToken: string;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      /** When known (from token response `expires_in`), used for proactive refresh. */
      expiresAtMs?: number;
    };

function normalizeBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

function hasOAuthRefreshBundle(cfg: JiraAdapterConfig): boolean {
  return Boolean(cfg.oauthClientId?.trim() && cfg.oauthClientSecret?.trim() && cfg.oauthRefreshToken?.trim());
}

export async function resolveJiraStartupAuth(
  cfg: JiraAdapterConfig,
  logger?: Logger
): Promise<JiraStartupAuth | null> {
  const cloudId = cfg.cloudId?.trim() ?? '';

  if (hasOAuthRefreshBundle(cfg)) {
    if (!cloudId) {
      // Config validation should already catch this, but keep runtime friendly.
      throw new Error('jira-adapter: OAuth configured but cloudId is missing (set JIRA_CLOUD_ID).');
    }
    const clientId = cfg.oauthClientId!.trim();
    const clientSecret = cfg.oauthClientSecret!.trim();
    let refreshToken = cfg.oauthRefreshToken!.trim();
    // When OAuth is configured, treat apiToken (if present) as the current access token
    // to avoid a startup refresh, mirroring Linear's pattern.
    let accessToken = cfg.apiToken?.trim() ?? '';
    let expiresAtMs: number | undefined;

    if (!accessToken) {
      logger?.info('jira-adapter: obtaining initial OAuth access token via refresh_token grant');
      const tokens = await exchangeJiraRefreshToken({
        clientId,
        clientSecret,
        refreshToken,
      });
      accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        refreshToken = tokens.refresh_token;
        logger?.warn(
          'jira-adapter: OAuth refresh returned a new refresh_token — persist it (e.g. JIRA_OAUTH_REFRESH_TOKEN) so restarts keep working'
        );
      }
      if (typeof tokens.expires_in === 'number') {
        expiresAtMs = Date.now() + tokens.expires_in * 1000;
      }
    }

    return {
      mode: 'oauth',
      cloudId,
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      expiresAtMs,
    };
  }

  const baseUrl = normalizeBaseUrl(cfg.baseUrl ?? '');
  const email = cfg.email?.trim() ?? '';
  const apiToken = cfg.apiToken?.trim() ?? '';
  if (!baseUrl || !email || !apiToken) return null;
  return { mode: 'basic', baseUrl, email, apiToken };
}

