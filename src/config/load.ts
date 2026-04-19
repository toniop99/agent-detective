import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { deepMerge } from './deep-merge.js';
import * as z from 'zod';
import { appConfigSchema, type AppConfig } from './schema.js';
import {
  applyCoreEnvWhitelist,
  applyPluginEnvWhitelist,
} from './env-whitelist.js';

export type { AppConfig } from './schema.js';

export interface LoadConfigOptions {
  /** Override config directory (default: `resolve(process.cwd(), 'config')`). */
  configRoot?: string;
}

/**
 * Load `default.json` + `local.json`, apply env whitelist, validate with Zod.
 */
export function loadConfig(options?: LoadConfigOptions): AppConfig {
  const configDir = options?.configRoot ?? resolve(process.cwd(), 'config');

  let config: Record<string, unknown> = {};

  const defaultConfigPath = resolve(configDir, 'default.json');
  if (existsSync(defaultConfigPath)) {
    try {
      config = JSON.parse(readFileSync(defaultConfigPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      console.warn('Failed to load config/default.json, using defaults:', (err as Error).message);
    }
  }

  const localConfigPath = resolve(configDir, 'local.json');
  if (existsSync(localConfigPath)) {
    try {
      const localConfig = JSON.parse(readFileSync(localConfigPath, 'utf8')) as Record<string, unknown>;
      config = deepMerge(config, localConfig);
    } catch (err) {
      console.warn('Failed to load config/local.json:', (err as Error).message);
    }
  }

  const merged = config as AppConfig;
  applyCoreEnvWhitelist(merged);
  applyPluginEnvWhitelist(merged);

  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid application config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
  }
  return parsed.data;
}
