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
import type { LinearAdapterConfig } from '../application/options-schema.js';
import {
  buildLinearAuthorizeUrl,
  createLinearOAuthState,
  exchangeLinearAuthorizationCode,
  verifyLinearOAuthState,
} from '../infrastructure/linear-oauth.js';

const PLUGIN_TAG = '@agent-detective/linear-adapter';

/** Fastify scope prefix is `/plugins/agent-detective-linear-adapter` for this package. */
export const LINEAR_PLUGIN_URL_SEGMENT = 'agent-detective-linear-adapter';

function oauthCallbackPath(): string {
  return `/plugins/${LINEAR_PLUGIN_URL_SEGMENT}/oauth/callback`;
}

function buildRedirectUri(base: string): string {
  const origin = base.replace(/\/$/, '');
  return `${origin}${oauthCallbackPath()}`;
}

function oauthConfigured(cfg: LinearAdapterConfig): boolean {
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
  })
  .loose();

export interface LinearOAuthRouteDeps {
  config: LinearAdapterConfig;
  logger?: Logger;
}

export function buildLinearOAuthRoutes(deps: LinearOAuthRouteDeps): RouteDefinition[] {
  const { config, logger } = deps;
  if (!oauthConfigured(config)) {
    return [];
  }

  const clientId = config.oauthClientId!.trim();
  const clientSecret = config.oauthClientSecret!.trim();
  const redirectUri = buildRedirectUri(config.oauthRedirectBaseUrl!.trim());
  const scope = (config.oauthScopes ?? 'read,write').trim();

  const start = defineRoute({
    method: 'GET',
    url: '/oauth/start',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Start Linear OAuth',
      description: 'Redirects the browser to Linear’s authorize URL (requires oauthClientId, oauthClientSecret, oauthRedirectBaseUrl).',
      querystring: OAuthStartQuery,
      response: {
        302: z.object({}).loose(),
      },
    },
    async handler(_req: FastifyRequest, reply: FastifyReply) {
      const state = createLinearOAuthState(clientSecret);
      const url = buildLinearAuthorizeUrl({
        clientId,
        redirectUri,
        scope,
        state,
        actor: config.oauthActor === 'app' ? 'app' : undefined,
      });
      logger?.info('linear-adapter: redirecting to Linear OAuth authorize URL');
      return reply.redirect(url, 302);
    },
  });

  const callback = defineRoute({
    method: 'GET',
    url: '/oauth/callback',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Linear OAuth callback',
      description: 'Exchanges `code` for access/refresh tokens. Response is JSON with Cache-Control: no-store.',
      querystring: OAuthCallbackQuery,
      response: {
        200: OAuthTokenJson,
        400: z.object({ status: z.literal('error'), message: z.string() }),
        401: z.object({ status: z.literal('error'), message: z.string() }),
      },
    },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      const q = (req.query ?? {}) as Record<string, string | undefined>;
      if (typeof q.error === 'string' && q.error) {
        const desc = typeof q.error_description === 'string' ? q.error_description : '';
        logger?.warn(`linear-adapter: OAuth error from Linear: ${q.error} ${desc}`);
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
      const verified = verifyLinearOAuthState(state, clientSecret);
      if (!verified) {
        logger?.warn('linear-adapter: OAuth callback rejected invalid or expired state');
        return reply
          .header('Cache-Control', 'no-store')
          .code(401)
          .send({ status: 'error', message: 'Invalid or expired state' });
      }
      try {
        const tokens = await exchangeLinearAuthorizationCode({
          clientId,
          clientSecret,
          code,
          redirectUri,
        });
        logger?.info(
          `linear-adapter: OAuth token exchange succeeded (expires_in=${tokens.expires_in ?? 'n/a'}, has_refresh=${Boolean(tokens.refresh_token)})`
        );
        return reply
          .header('Cache-Control', 'no-store')
          .send({
            access_token: tokens.access_token,
            ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
            token_type: tokens.token_type,
            ...(tokens.expires_in !== undefined ? { expires_in: tokens.expires_in } : {}),
          });
      } catch (err) {
        logger?.error(`linear-adapter: OAuth token exchange failed: ${(err as Error).message}`);
        return reply
          .header('Cache-Control', 'no-store')
          .code(400)
          .send({ status: 'error', message: (err as Error).message });
      }
    },
  });

  return [start, callback];
}

export function registerLinearOAuthRoutes(scope: FastifyScope, deps: LinearOAuthRouteDeps): void {
  const routes = buildLinearOAuthRoutes(deps);
  if (routes.length === 0) return;
  registerRoutes(scope, routes);
}
