/**
 * Extracts the set of labels that were *added* in a Jira `issue_updated`
 * webhook's `changelog`. Jira represents label changes as a single item with
 * `field: "labels"`, where both `fromString` and `toString` are space-separated
 * label lists (or `null`/missing when empty).
 *
 * Returns a de-duplicated, order-preserving array of added labels. Returns an
 * empty array when the payload has no changelog, no labels change, or the
 * field is malformed.
 *
 * Accepts both the canonical envelope (`{ changelog: { items: [...] }, ... }`)
 * and Automation's "bare-issue" shape (`{ changelog: { items: [...] }, ... }`
 * at the top level, no `issue` wrapper) since both place `changelog` at the
 * payload root.
 */
export function extractAddedLabelsFromChangelog(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const changelog = p.changelog as Record<string, unknown> | undefined;
  if (!changelog || typeof changelog !== 'object') return [];
  const items = changelog.items;
  if (!Array.isArray(items)) return [];

  const added = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.field !== 'labels') continue;
    const before = parseLabels(item.fromString);
    const after = parseLabels(item.toString);
    for (const label of after) {
      if (!before.has(label)) added.add(label);
    }
  }
  return Array.from(added);
}

function parseLabels(value: unknown): Set<string> {
  if (typeof value !== 'string' || !value.trim()) return new Set();
  return new Set(value.split(/\s+/).filter(Boolean));
}

/**
 * Extracts the set of labels the issue had *before* this update, using the
 * `fromString` of any `labels` changelog item. Order-preserving and
 * de-duplicated.
 *
 * Used to detect whether an issue was already in a "matchable" state prior to
 * the current `jira:issue_updated` webhook — if it was, the adapter assumes
 * the analysis already ran (either on `issue_created` or on an earlier label
 * add) and stays silent to avoid re-analyzing the same ticket every time
 * somebody touches its labels.
 *
 * Returns an empty array when there is no `labels` changelog item (i.e. the
 * update didn't touch labels), so callers should combine this with
 * `extractAddedLabelsFromChangelog` to reason about label transitions.
 */
export function extractLabelsBeforeUpdate(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const changelog = p.changelog as Record<string, unknown> | undefined;
  if (!changelog || typeof changelog !== 'object') return [];
  const items = changelog.items;
  if (!Array.isArray(items)) return [];

  const before = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.field !== 'labels') continue;
    for (const label of parseLabels(item.fromString)) before.add(label);
  }
  return Array.from(before);
}
