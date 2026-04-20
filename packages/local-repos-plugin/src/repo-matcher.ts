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
