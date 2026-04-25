import { existsSync } from 'node:fs';
import type { RepoConfig, ValidationConfig } from './types.js';

export interface ValidationResult {
  name: string;
  path: string;
  exists: boolean;
  error?: string;
}

export function validateRepos(
  repos: RepoConfig[],
  config: ValidationConfig = {}
): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const repo of repos) {
    const result: ValidationResult = {
      name: repo.name,
      path: repo.path,
      exists: existsSync(repo.path),
    };

    if (!result.exists && config.failOnMissing) {
      result.error = `Path does not exist: ${repo.path}`;
    }

    results.push(result);
  }

  return results;
}

export function hasValidationErrors(results: ValidationResult[]): boolean {
  return results.some((r) => r.error !== undefined);
}
