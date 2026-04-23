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
 * - Bitbucket access token (old workspace/repo tokens, x-token-auth): `BITBUCKET_TOKEN` → `options.bitbucketToken`
 * - Bitbucket new API token: `BITBUCKET_USERNAME` (for Git) + `BITBUCKET_EMAIL` (for REST) + `BITBUCKET_APP_PASSWORD` (token value)
 * - Bitbucket old app password: `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` (email falls back to username)
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
  | { mode: 'appPassword'; username: string; email: string; appPassword: string };

/**
 * Prefer **access token** (env or file) for Bearer API + `x-token-auth` Git URL;
 * otherwise **username + credential** for Basic auth. `email` is used for REST API calls
 * (required by new Bitbucket API tokens); falls back to `username` if unset (old app passwords).
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
    const email = firstNonEmpty(process.env.BITBUCKET_EMAIL, options.bitbucketEmail) ?? username;
    return { mode: 'appPassword', username, email, appPassword };
  }
  return undefined;
}
