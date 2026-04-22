const BB_API = 'https://api.bitbucket.org/2.0';

export type BitbucketPrAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; appPassword: string };

export interface CreateBitbucketPrParams {
  auth: BitbucketPrAuth;
  workspace: string;
  repoSlug: string;
  title: string;
  description: string;
  /** Source branch name (exists on the remote after push). */
  sourceBranch: string;
  /** Destination / base branch name. */
  destinationBranch: string;
}

function authHeader(a: BitbucketPrAuth): string {
  if (a.type === 'bearer') {
    return `Bearer ${a.token}`;
  }
  const enc = Buffer.from(`${a.username}:${a.appPassword}`).toString('base64');
  return `Basic ${enc}`;
}

/**
 * Bitbucket Cloud — **Bearer** (repository/workspace access token) or **Basic** (app password).
 * @see https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/
 * @see https://support.atlassian.com/bitbucket-cloud/docs/using-access-tokens
 */
export async function createBitbucketPullRequest(
  params: CreateBitbucketPrParams
): Promise<{ htmlUrl: string; id: number }> {
  const { auth, workspace, repoSlug, title, description, sourceBranch, destinationBranch } = params;
  const res = await fetch(
    `${BB_API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: authHeader(auth),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title,
        description,
        source: { branch: { name: sourceBranch } },
        destination: { branch: { name: destinationBranch } },
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Bitbucket create PR failed: ${res.status} ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: number; links?: { html?: { href?: string } } };
  const htmlUrl = data.links?.html?.href;
  if (!htmlUrl) {
    throw new Error('Bitbucket create PR: response missing links.html.href');
  }
  return { htmlUrl, id: data.id };
}
