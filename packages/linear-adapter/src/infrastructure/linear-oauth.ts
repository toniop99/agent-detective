import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const LINEAR_AUTHORIZE = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN = 'https://api.linear.app/oauth/token';

export interface LinearOAuthStatePayload {
  exp: number;
  nonce: string;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signPayload(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/**
 * Build OAuth `state` (payload + HMAC) using the app client secret.
 * Valid for 15 minutes.
 */
export function createLinearOAuthState(clientSecret: string): string {
  const body: LinearOAuthStatePayload = {
    exp: Date.now() + 15 * 60_000,
    nonce: randomBytes(16).toString('hex'),
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
  const sig = signPayload(payloadB64, clientSecret);
  return `${payloadB64}.${sig}`;
}

export function verifyLinearOAuthState(state: string, clientSecret: string): LinearOAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64, clientSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: LinearOAuthStatePayload;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as LinearOAuthStatePayload;
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as LinearOAuthStatePayload;
    } catch {
      return null;
    }
  }
  if (typeof parsed.exp !== 'number' || typeof parsed.nonce !== 'string') return null;
  if (Date.now() > parsed.exp) return null;
  return parsed;
}

export function buildLinearAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  /** When `app`, Linear issues tokens where mutations are attributed to the OAuth app (see Linear “OAuth actor authorization”). */
  actor?: 'user' | 'app';
}): string {
  const u = new URL(LINEAR_AUTHORIZE);
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', params.scope);
  u.searchParams.set('state', params.state);
  if (params.actor === 'app') {
    u.searchParams.set('actor', 'app');
  }
  return u.toString();
}

export interface LinearTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Exchange an authorization code for tokens (application/x-www-form-urlencoded).
 */
export async function exchangeLinearAuthorizationCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<LinearTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const res = await fetch(LINEAR_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`linear-oauth: token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  if (!access_token) {
    throw new Error('linear-oauth: token response missing access_token');
  }
  return {
    access_token,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
  };
}

/**
 * Rotate access token using a refresh token (application/x-www-form-urlencoded).
 * Linear may return a new `refresh_token`; callers should persist it when present.
 */
export async function exchangeLinearRefreshToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<LinearTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  });
  const res = await fetch(LINEAR_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`linear-oauth: token refresh failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  if (!access_token) {
    throw new Error('linear-oauth: refresh response missing access_token');
  }
  return {
    access_token,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    expires_in: typeof json.expires_in === 'number' ? json.expires_in : undefined,
  };
}
