/** `Linear-Delivery` id → last processed time (ms). */
const recentLinearDeliveries = new Map<string, number>();

/**
 * Linear sends a unique `Linear-Delivery` header per HTTP delivery; retries reuse the same id.
 * When {@link windowMs} > 0 and {@link deliveryId} is non-empty, a second request within the window
 * is treated as a duplicate (return `true` and do not process again).
 */
export function shouldSkipLinearWebhookDelivery(
  deliveryId: string | undefined,
  windowMs: number,
  now: number = Date.now()
): boolean {
  if (!deliveryId?.trim() || windowMs <= 0) return false;
  pruneLinearDeliveries(now, windowMs);
  const id = deliveryId.trim();
  const prev = recentLinearDeliveries.get(id);
  if (prev !== undefined && now - prev < windowMs) {
    return true;
  }
  recentLinearDeliveries.set(id, now);
  return false;
}

function pruneLinearDeliveries(now: number, windowMs: number): void {
  const maxAge = Math.max(windowMs * 3, 120_000);
  for (const [k, t] of recentLinearDeliveries) {
    if (now - t > maxAge) recentLinearDeliveries.delete(k);
  }
}

export function __resetLinearWebhookDedupForTests(): void {
  recentLinearDeliveries.clear();
}
