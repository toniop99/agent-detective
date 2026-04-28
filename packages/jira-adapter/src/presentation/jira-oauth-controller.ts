import { z } from 'zod';
import {
  defineRoute,
  registerRoutes,
  type RouteDefinition,
  type FastifyScope,
  type FastifyRequest,
  type FastifyReply,
  type Logger,
} from '@agent-detective/sdk';
import type { JiraAdapterOptions } from '../application/options-schema.js';
import {
  buildJiraAuthorizeUrl,
  createJiraOAuthState,
  exchangeJiraAuthorizationCode,
  fetchJiraAccessibleResources,
  verifyJiraOAuthState,
} from '../infrastructure/jira-oauth.js';

const PLUGIN_TAG = '@agent-detective/jira-adapter';
export const JIRA_PLUGIN_URL_SEGMENT = 'agent-detective-jira-adapter';

function oauthCallbackPath(): string {
  return `/plugins/${JIRA_PLUGIN_URL_SEGMENT}/oauth/callback`;
}

function buildRedirectUri(base: string): string {
  const origin = base.replace(/\/$/, '');
  return `${origin}${oauthCallbackPath()}`;
}

function oauthConfigured(cfg: JiraAdapterOptions): boolean {
  return Boolean(
    cfg.oauthClientId?.trim() &&
      cfg.oauthClientSecret?.trim() &&
      cfg.oauthRedirectBaseUrl?.trim()
  );
}

const OAuthStartQuery = z.object({}).loose();

const OAuthCallbackQuery = z
  .object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .loose();

const OAuthTokenJson = z
  .object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    token_type: z.string().optional(),
    expires_in: z.number().optional(),
    cloud_id: z.string().optional(),
    resources: z.array(z.object({ id: z.string() }).loose()).optional(),
  })
  .loose();

const OAuthErrorJson = z.object({ status: z.literal('error'), message: z.string() });

export interface JiraOAuthRouteDeps {
  config: JiraAdapterOptions;
  logger?: Logger;
}

function defaultJiraOAuthScope(): string {
  // Classic scopes where possible, plus offline_access for refresh tokens and read:me for identity inspection.
  return [
    'read:jira-work',
    'write:jira-work',
    'read:jira-user',
    'manage:jira-webhook',
    'offline_access',
    'read:me',
  ].join(' ');
}

export function buildJiraOAuthRoutes(deps: JiraOAuthRouteDeps): RouteDefinition[] {
  const { config, logger } = deps;
  const scope = defaultJiraOAuthScope();

  const start = defineRoute({
    method: 'GET',
    url: '/oauth/start',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Start Jira OAuth (3LO)',
      description:
        'Redirects the browser to Atlassian’s authorize URL (requires oauthClientId, oauthClientSecret, oauthRedirectBaseUrl).',
      querystring: OAuthStartQuery,
      response: { 302: z.object({}).loose(), 501: OAuthErrorJson },
    },
    async handler(_req: FastifyRequest, reply: FastifyReply) {
      if (!oauthConfigured(config)) {
        return reply
          .header('Cache-Control', 'no-store')
          .code(501)
          .send({
            status: 'error',
            message:
              'Jira OAuth is not configured. Set oauthClientId, oauthClientSecret, oauthRedirectBaseUrl (or JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REDIRECT_BASE_URL).',
          });
      }
      const clientId = config.oauthClientId!.trim();
      const clientSecret = config.oauthClientSecret!.trim();
      const redirectUri = buildRedirectUri(config.oauthRedirectBaseUrl!.trim());

      const state = createJiraOAuthState(clientSecret);
      const url = buildJiraAuthorizeUrl({
        clientId,
        redirectUri,
        scope,
        state,
      });
      logger?.info('jira-adapter: redirecting to Atlassian OAuth authorize URL');
      return reply.redirect(url, 302);
    },
  });

  const callback = defineRoute({
    method: 'GET',
    url: '/oauth/callback',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Jira OAuth callback',
      description:
        'Exchanges `code` for access/refresh tokens, then fetches accessible resources to resolve cloudId. Response is JSON with Cache-Control: no-store.',
      querystring: OAuthCallbackQuery,
      response: {
        200: OAuthTokenJson,
        400: OAuthErrorJson,
        401: OAuthErrorJson,
        501: OAuthErrorJson,
      },
    },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      if (!oauthConfigured(config)) {
        return reply
          .header('Cache-Control', 'no-store')
          .code(501)
          .send({
            status: 'error',
            message:
              'Jira OAuth is not configured. Set oauthClientId, oauthClientSecret, oauthRedirectBaseUrl (or JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REDIRECT_BASE_URL).',
          });
      }

      const clientId = config.oauthClientId!.trim();
      const clientSecret = config.oauthClientSecret!.trim();
      const redirectUri = buildRedirectUri(config.oauthRedirectBaseUrl!.trim());

      const q = (req.query ?? {}) as Record<string, string | undefined>;
      if (typeof q.error === 'string' && q.error) {
        const desc = typeof q.error_description === 'string' ? q.error_description : '';
        logger?.warn(`jira-adapter: OAuth error from Atlassian: ${q.error} ${desc}`);
        return reply
          .header('Cache-Control', 'no-store')
          .code(400)
          .send({ status: 'error', message: `OAuth error: ${q.error}${desc ? ` — ${desc}` : ''}` });
      }
      const code = q.code;
      const state = q.state;
      if (!code || !state) {
        return reply
          .header('Cache-Control', 'no-store')
          .code(400)
          .send({ status: 'error', message: 'Missing code or state' });
      }
      const verified = verifyJiraOAuthState(state, clientSecret);
      if (!verified) {
        logger?.warn('jira-adapter: OAuth callback rejected invalid or expired state');
        return reply
          .header('Cache-Control', 'no-store')
          .code(401)
          .send({ status: 'error', message: 'Invalid or expired state' });
      }
      try {
        const tokens = await exchangeJiraAuthorizationCode({
          clientId,
          clientSecret,
          code,
          redirectUri,
        });
        const resources = await fetchJiraAccessibleResources(tokens.access_token);
        const cloudId =
          config.cloudId?.trim() ||
          (resources.length === 1 ? resources[0]!.id : undefined);
        logger?.info(
          `jira-adapter: OAuth token exchange succeeded (expires_in=${tokens.expires_in ?? 'n/a'}, has_refresh=${Boolean(tokens.refresh_token)}, resources=${resources.length})`
        );
        return reply
          .header('Cache-Control', 'no-store')
          .send({
            access_token: tokens.access_token,
            ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
            token_type: tokens.token_type,
            ...(tokens.expires_in !== undefined ? { expires_in: tokens.expires_in } : {}),
            ...(cloudId ? { cloud_id: cloudId } : {}),
            resources: resources.map((r) => ({ id: r.id, url: r.url, name: r.name, scopes: r.scopes })),
          });
      } catch (err) {
        logger?.error(`jira-adapter: OAuth token exchange failed: ${(err as Error).message}`);
        return reply
          .header('Cache-Control', 'no-store')
          .code(400)
          .send({ status: 'error', message: (err as Error).message });
      }
    },
  });

  return [start, callback];
}

export function registerJiraOAuthRoutes(scope: FastifyScope, deps: JiraOAuthRouteDeps): void {
  const routes = buildJiraOAuthRoutes(deps);
  registerRoutes(scope, routes);
}

