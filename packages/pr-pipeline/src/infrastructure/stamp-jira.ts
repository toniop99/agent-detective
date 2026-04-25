/**
 * Human-readable footer so Jira can identify adapter-owned comments. Must stay
 * consistent with jira-adapter’s marker for loop protection when both post.
 */
const FOOTER = '\n\n---\n_— Posted by pr-pipeline (agent-detective)_';

export function stampJiraPr(body: string): string {
  if (!body) return FOOTER.trimStart();
  if (body.includes('Posted by pr-pipeline (agent-detective)')) return body;
  return `${body}${FOOTER}`;
}
