/**
 * Same marker string as jira-adapter (`AGENT_DETECTIVE_MARKER`) so loop
 * protection and “own comment” detection behave consistently across trackers.
 */
export const AGENT_DETECTIVE_MARKER = 'agent-detective · ad-v1';

const MARKER_FOOTER_MARKDOWN = `\n\n---\n_— Posted by ${AGENT_DETECTIVE_MARKER}_`;

export function stampComment(body: string): string {
  if (!body) return MARKER_FOOTER_MARKDOWN.trimStart();
  if (body.includes(AGENT_DETECTIVE_MARKER)) return body;
  return `${body}${MARKER_FOOTER_MARKDOWN}`;
}
