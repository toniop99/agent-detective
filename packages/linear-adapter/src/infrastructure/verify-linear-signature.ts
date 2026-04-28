import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_WEBHOOK_AGE_MS = 60_000;

/**
 * Verifies `Linear-Signature` (hex HMAC-SHA256 of raw body) per
 * https://linear.app/developers/webhooks#securing-webhooks
 */
export function verifyLinearWebhookSignature(
  headerSignature: string | undefined,
  rawBody: Buffer,
  secret: string
): boolean {
  if (typeof headerSignature !== 'string' || !headerSignature.trim()) {
    return false;
  }
  const trimmed = headerSignature.trim().toLowerCase();
  const hex = trimmed.startsWith('sha256=') ? trimmed.slice('sha256='.length) : trimmed;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return false;
  }
  let headerBuf: Buffer;
  try {
    headerBuf = Buffer.from(hex, 'hex');
  } catch {
    return false;
  }
  const computed = createHmac('sha256', secret).update(rawBody).digest();
  if (headerBuf.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(headerBuf, computed);
}

export function isWebhookTimestampFresh(webhookTimestamp: unknown, nowMs: number = Date.now()): boolean {
  if (typeof webhookTimestamp !== 'number' || !Number.isFinite(webhookTimestamp)) {
    return false;
  }
  return Math.abs(nowMs - webhookTimestamp) <= MAX_WEBHOOK_AGE_MS;
}
