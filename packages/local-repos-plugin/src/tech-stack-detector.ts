import { readdirSync } from 'node:fs';
import type { TechStackDetectionConfig } from './types.js';

const DEFAULT_PATTERNS: Record<string, string[]> = {
  node: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
  python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'Pipfile.lock'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile'],
  go: ['go.mod', 'go.sum'],
  ruby: ['Gemfile', 'Gemfile.lock'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  dotnet: ['*.csproj', '*.sln', '*.fsproj'],
  php: ['composer.json', 'composer.lock'],
  typescript: ['tsconfig.json'],
  react: ['package.json'],
  vue: ['package.json', 'vite.config.ts'],
  next: ['package.json', 'next.config.js', 'next.config.mjs'],
  angular: ['package.json', 'angular.json'],
  django: ['manage.py', 'requirements.txt'],
  flask: ['app.py', 'requirements.txt'],
  spring: ['pom.xml', 'build.gradle'],
  rails: ['Gemfile', 'config.ru'],
  laravel: ['composer.json', 'artisan'],
};

export function detectTechStack(
  repoPath: string,
  config: TechStackDetectionConfig = {}
): string[] {
  const patterns = { ...DEFAULT_PATTERNS, ...(config.patterns || {}) };

  if (config.enabled === false) {
    return [];
  }

  let files: string[] = [];

  try {
    const entries = readdirSync(repoPath, { withFileTypes: true });
    files = entries.map((e) => e.name);
  } catch {
    return [];
  }

  const detected: string[] = [];

  for (const [tech, techPatterns] of Object.entries(patterns)) {
    for (const pattern of techPatterns) {
      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        if (files.some((f) => f.endsWith(ext))) {
          if (!detected.includes(tech)) {
            detected.push(tech);
          }
          break;
        }
      } else {
        if (files.includes(pattern)) {
          if (!detected.includes(tech)) {
            detected.push(tech);
          }
          break;
        }
      }
    }
  }

  return detected;
}
