import { AGENT_DETECTIVE_MARKER } from './comment-mark.js';

export function hasTriggerPhrase(body: string, phrase: string): boolean {
  if (!body || !phrase) return false;
  return body.toLowerCase().includes(phrase.toLowerCase());
}

export function extraTextOutsideTriggerPhrase(body: string, triggerPhrase: string): string {
  if (!body?.trim() || !triggerPhrase) return '';
  const lowerBody = body.toLowerCase();
  const lowerPhrase = triggerPhrase.toLowerCase();
  const idx = lowerBody.indexOf(lowerPhrase);
  if (idx < 0) return '';
  const rest = body.slice(0, idx) + body.slice(idx + triggerPhrase.length);
  return rest.replace(/\s+/g, ' ').trim();
}

export function isOwnLinearComment(
  body: string | undefined,
  actorId: string | undefined,
  botActorIds: readonly string[] | undefined
): boolean {
  if (typeof body === 'string' && body.includes(AGENT_DETECTIVE_MARKER)) return true;
  if (actorId && botActorIds?.includes(actorId)) return true;
  return false;
}

export function extractLinearCommentFromWebhook(
  body: Record<string, unknown>
): { id?: string; body: string; actorId?: string } | null {
  if (body.type !== 'Comment') return null;
  const d = body.data;
  if (!d || typeof d !== 'object') return null;
  const data = d as Record<string, unknown>;
  const text = typeof data.body === 'string' ? data.body : '';
  const id = typeof data.id === 'string' ? data.id : undefined;
  const actor = body.actor && typeof body.actor === 'object' ? (body.actor as Record<string, unknown>) : null;
  const actorId = actor && typeof actor.id === 'string' ? actor.id : undefined;
  return { id, body: text, actorId };
}

export function extractIssueIdFromLinearWebhook(body: Record<string, unknown>): string | null {
  const d = body.data;
  if (!d || typeof d !== 'object') return null;
  const data = d as Record<string, unknown>;
  if (body.type === 'Comment' && typeof data.issueId === 'string') return data.issueId;
  if (body.type === 'Issue' && typeof data.id === 'string') return data.id;
  return null;
}
