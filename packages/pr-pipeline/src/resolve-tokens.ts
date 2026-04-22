import type { PrPipelineOptions } from './options-schema.js';

function firstNonEmpty(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Host credentials: **environment first**, then plugin options (JSON).
 * - GitHub: `GITHUB_TOKEN` → `GH_TOKEN` → `options.githubToken`
 * - Bitbucket access token: `BITBUCKET_TOKEN` → `options.bitbucketToken` (over app password)
 * - Bitbucket app password: `BITBUCKET_USERNAME` / `BITBUCKET_APP_PASSWORD` → `options.*`
 */
export function resolveGithubToken(options: PrPipelineOptions): string | undefined {
  return firstNonEmpty(
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    options.githubToken
  );
}

export type BitbucketAuth =
  | { mode: 'token'; token: string }
  | { mode: 'appPassword'; username: string; appPassword: string };

/**
 * Prefer **access token** (env or file) for Bearer API + `x-token-auth` Git URL;
 * otherwise **app password** (username + password) for Basic + embedded credentials in URL.
 */
export function resolveBitbucketAuth(options: PrPipelineOptions): BitbucketAuth | undefined {
  const token = firstNonEmpty(process.env.BITBUCKET_TOKEN, options.bitbucketToken);
  if (token) {
    return { mode: 'token', token };
  }
  const username = firstNonEmpty(process.env.BITBUCKET_USERNAME, options.bitbucketUsername);
  const appPassword = firstNonEmpty(
    process.env.BITBUCKET_APP_PASSWORD,
    options.bitbucketAppPassword
  );
  if (username && appPassword) {
    return { mode: 'appPassword', username, appPassword };
  }
  return undefined;
}
