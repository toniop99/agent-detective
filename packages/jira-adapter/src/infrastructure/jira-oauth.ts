import crypto from 'node:crypto';

export interface JiraOAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

export interface JiraAccessibleResource {
  id: string;
  url?: string;
  name?: string;
  scopes?: string[];
  avatarUrl?: string;
}

const OAUTH_AUTHORIZE_BASE = 'https://auth.atlassian.com/authorize';
const OAUTH_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

function encodeQuery(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    usp.set(k, v);
  }
  return usp.toString();
}

export function buildJiraAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const qs = encodeQuery({
    audience: 'api.atlassian.com',
    client_id: args.clientId,
    scope: args.scope,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${OAUTH_AUTHORIZE_BASE}?${qs}`;
}

/**
 * Stateless OAuth state token: timestamp + random + HMAC signature.
 * Mirrors the Linear adapter pattern (signed state, no server persistence).
 */
export function createJiraOAuthState(clientSecret: string): string {
  const ts = Date.now().toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifyJiraOAuthState(
  state: string,
  clientSecret: string,
  opts?: { maxAgeMs?: number }
): boolean {
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts as [string, string, string];
  if (!ts || !nonce || !sig) return false;
  const payload = `${ts}.${nonce}`;
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }

  const maxAgeMs = opts?.maxAgeMs ?? 10 * 60_000;
  const tsMs = parseInt(ts, 36);
  if (!Number.isFinite(tsMs)) return false;
  return Date.now() - tsMs >= 0 && Date.now() - tsMs <= maxAgeMs;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function exchangeJiraAuthorizationCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<JiraOAuthTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new Error(`jira-adapter: OAuth token exchange failed (${res.status}) ${JSON.stringify(json)}`);
  }
  const t = json as Partial<JiraOAuthTokens>;
  if (!t.access_token) {
    throw new Error('jira-adapter: OAuth token exchange response missing access_token');
  }
  return t as JiraOAuthTokens;
}

export async function exchangeJiraRefreshToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<JiraOAuthTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new Error(`jira-adapter: OAuth refresh failed (${res.status}) ${JSON.stringify(json)}`);
  }
  const t = json as Partial<JiraOAuthTokens>;
  if (!t.access_token) {
    throw new Error('jira-adapter: OAuth refresh response missing access_token');
  }
  return t as JiraOAuthTokens;
}

export async function fetchJiraAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]> {
  const res = await fetch(ACCESSIBLE_RESOURCES_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new Error(
      `jira-adapter: accessible-resources fetch failed (${res.status}) ${JSON.stringify(json)}`
    );
  }
  if (!Array.isArray(json)) return [];
  return (json as unknown[]).filter(Boolean) as JiraAccessibleResource[];
}

