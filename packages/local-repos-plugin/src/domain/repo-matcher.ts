import type { ValidatedRepo } from './types.js';

/**
 * Case-insensitive, deterministic match between an issue's labels and the
 * plugin's configured repos. Returns the first configured repo whose `name`
 * matches any of the supplied labels.
 *
 * Labels and repo names are normalized via `toLowerCase()` only; no fuzzy
 * matching is performed — by design, this layer is fully predictable.
 */
export function matchRepoByLabels(
  labels: readonly string[],
  repos: readonly ValidatedRepo[]
): ValidatedRepo | null {
  if (!labels?.length || !repos?.length) return null;
  for (const label of labels) {
    if (typeof label !== 'string' || !label) continue;
    const normalized = label.toLowerCase();
    const match = repos.find((repo) => repo.name.toLowerCase() === normalized);
    if (match) return match;
  }
  return null;
}

/**
 * Case-insensitive match against *every* configured repo, for issues whose
 * labels touch multiple repos (fan-out analysis).
 *
 * Output order follows the configured-repos order (not the label order) so the
 * caller sees a stable list regardless of how the user typed the labels on
 * the issue. Duplicates from repeated labels are silently collapsed.
 */
export function matchAllReposByLabels(
  labels: readonly string[],
  repos: readonly ValidatedRepo[]
): ValidatedRepo[] {
  if (!labels?.length || !repos?.length) return [];
  const normalizedLabels = new Set<string>();
  for (const label of labels) {
    if (typeof label !== 'string' || !label) continue;
    normalizedLabels.add(label.toLowerCase());
  }
  if (normalizedLabels.size === 0) return [];
  return repos.filter((repo) => normalizedLabels.has(repo.name.toLowerCase()));
}
