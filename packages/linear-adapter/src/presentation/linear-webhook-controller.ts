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
import type { FastifyInstance } from 'fastify';
import { isWebhookTimestampFresh, verifyLinearWebhookSignature } from '../infrastructure/verify-linear-signature.js';
import type { LinearAdapterConfig } from '../application/options-schema.js';
import type { createLinearWebhookHandler } from '../application/webhook-handler.js';

const PLUGIN_TAG = '@agent-detective/linear-adapter';

type LinearWebhookHandler = ReturnType<typeof createLinearWebhookHandler>;

const LinearWebhookBody = z
  .object({
    action: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.string().optional(),
    webhookTimestamp: z.number().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    actor: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const LinearWebhookOk = z
  .object({
    status: z.enum(['success', 'ignored', 'error']),
    message: z.string().optional(),
  })
  .loose();

const LinearWebhookError = z.object({
  status: z.literal('error'),
  message: z.string(),
});

export type LinearRequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

export interface LinearWebhookRouteDeps {
  webhookHandler: LinearWebhookHandler;
  config: LinearAdapterConfig;
  logger?: Logger;
}

function getLinearSignature(req: FastifyRequest): string | undefined {
  const h = req.headers['linear-signature'];
  if (typeof h === 'string') return h;
  if (Array.isArray(h) && typeof h[0] === 'string') return h[0];
  return undefined;
}

export function registerLinearJsonWithRawBody(scope: FastifyScope): void {
  const app = scope as FastifyInstance;
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const buf = body as Buffer;
        (req as LinearRequestWithRawBody).rawBody = buf;
        const json = JSON.parse(buf.toString('utf8')) as unknown;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
}

export function buildLinearWebhookRoutes(deps: LinearWebhookRouteDeps): RouteDefinition[] {
  const { webhookHandler, config, logger } = deps;

  const webhookPost = defineRoute({
    method: 'POST',
    url: '/webhook/linear',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'Handle Linear webhook',
      description:
        'Receives Linear data-change webhooks (Issues, Comments, etc.). Verifies Linear-Signature when webhookSigningSecret is configured.',
      body: LinearWebhookBody,
      response: { 200: LinearWebhookOk, 400: LinearWebhookError, 401: LinearWebhookError, 500: LinearWebhookError },
    },
    async handler(req: FastifyRequest, reply: FastifyReply) {
      try {
        const raw = (req as LinearRequestWithRawBody).rawBody;
        if (!raw) {
          logger?.warn('linear-adapter: missing raw body (content-type parser not registered?)');
          return reply.code(400).send({ status: 'error', message: 'Could not read raw body for signature verification' });
        }

        const secret = config.webhookSigningSecret?.trim() ?? '';
        const mustVerify = secret.length > 0 && !config.skipWebhookSignatureVerification;

        if (mustVerify) {
          const sig = getLinearSignature(req);
          if (!verifyLinearWebhookSignature(sig, raw, secret)) {
            logger?.warn('linear-adapter: webhook signature verification failed');
            return reply.code(401).send({ status: 'error', message: 'Invalid Linear-Signature' });
          }
          const body = req.body as Record<string, unknown>;
          if (!isWebhookTimestampFresh(body.webhookTimestamp)) {
            logger?.warn('linear-adapter: webhook timestamp outside allowed window');
            return reply.code(401).send({ status: 'error', message: 'Stale webhookTimestamp' });
          }
        }

        const result = await webhookHandler.handleWebhook((req.body ?? {}) as Record<string, unknown>);
        return result;
      } catch (err) {
        logger?.error(`linear-adapter webhook error: ${(err as Error).message}`);
        return reply.code(500).send({ status: 'error', message: (err as Error).message });
      }
    },
  });

  const oauthCallback = defineRoute({
    method: 'GET',
    url: '/oauth/callback',
    schema: {
      tags: [PLUGIN_TAG],
      summary: 'OAuth callback (stub)',
      description: 'Reserved for Linear OAuth install flow; not implemented in Phase B scaffold.',
      querystring: z.object({ code: z.string().optional(), state: z.string().optional() }).loose(),
      response: {
        501: z.object({ status: z.literal('error'), message: z.string() }),
      },
    },
    async handler(_req: FastifyRequest, reply: FastifyReply) {
      return reply.code(501).send({
        status: 'error',
        message: 'Linear OAuth callback is not implemented yet',
      });
    },
  });

  return [webhookPost, oauthCallback];
}

export function registerLinearWebhookRoutes(app: FastifyScope, deps: LinearWebhookRouteDeps): void {
  registerRoutes(app, buildLinearWebhookRoutes(deps));
}
