const GH_API = 'https://api.github.com';

export interface CreateGithubPrParams {
  token: string;
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
}

export async function createGithubPullRequest(params: CreateGithubPrParams): Promise<{ htmlUrl: string; number: number }> {
  const { token, owner, repo, title, head, base, body } = params;
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title, head, base, body }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub create PR failed: ${res.status} ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as { html_url: string; number: number };
  return { htmlUrl: data.html_url, number: data.number };
}
