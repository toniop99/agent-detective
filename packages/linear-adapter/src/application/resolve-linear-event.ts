/**
 * Maps Linear webhook `type` + `action` to a canonical event name used in
 * `webhookBehavior.events` (e.g. `linear:Issue:create`).
 */
export function linearCanonicalWebhookEvent(type: unknown, action: unknown): string {
  const t = typeof type === 'string' ? type : '';
  const a = typeof action === 'string' ? action.toLowerCase() : '';
  if (t === 'Issue' && a === 'create') return 'linear:Issue:create';
  if (t === 'Comment' && a === 'create') return 'linear:Comment:create';
  return `linear:${t}:${a}`;
}
