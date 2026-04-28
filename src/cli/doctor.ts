import { loadConfig } from '../server.js';
import { importPluginModuleFromSpecifier } from '../core/plugin-system.js';
import { validatePluginConfig, validatePluginSchema } from '../core/schema-validator.js';
import type { Plugin } from '../core/types.js';
import { isAgentInstalled, normalizeAgent } from '../agents/index.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

type DoctorOptions = {
  installRoot?: string;
  argv: string[];
};

type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

function resolveConfigDirFromInstallRoot(installRoot: string | undefined): string | undefined {
  if (!installRoot) return undefined;
  if (installRoot.split(/[\\/]/).pop() === 'config') return installRoot;
  return resolve(installRoot, 'config');
}

function parseFlags(argv: string[]): { json: boolean; verbose: boolean } {
  const args = argv.slice(2);
  return {
    json: args.includes('--json'),
    verbose: args.includes('--verbose'),
  };
}

function hasExplicitConfigRootArg(argv: string[]): boolean {
  const args = argv.slice(2);
  return args.some((a) => a === '--config-root' || a.startsWith('--config-root='));
}

function hasExplicitConfigRootEnv(): boolean {
  return typeof process.env.AGENT_DETECTIVE_CONFIG_ROOT === 'string' && process.env.AGENT_DETECTIVE_CONFIG_ROOT.length > 0;
}

function coercePlugin(mod: unknown): Plugin {
  const m = mod as { default?: unknown };
  return ((m && typeof m === 'object' && 'default' in m ? m.default : m) ?? mod) as Plugin;
}

function applyPluginDefaults(plugin: Plugin, options: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...options };
  if (plugin.schema?.properties) {
    for (const [key, prop] of Object.entries(plugin.schema.properties)) {
      if (merged[key] === undefined && prop.default !== undefined) {
        merged[key] = prop.default;
      }
    }
  }
  return merged;
}

export async function runDoctor({ installRoot, argv }: DoctorOptions): Promise<void> {
  const { json, verbose } = parseFlags(argv);
  const checks: DoctorCheck[] = [];

  const configRoot = resolveConfigDirFromInstallRoot(installRoot);
  const configRootUsed = configRoot ?? resolve(process.cwd(), 'config');
  const resolutionRoot = installRoot ?? process.cwd();

  const explicitConfigRoot = hasExplicitConfigRootArg(argv) || hasExplicitConfigRootEnv();
  const configDirExists = existsSync(configRootUsed);
  const defaultJsonExists = existsSync(resolve(configRootUsed, 'default.json'));
  const localJsonExists = existsSync(resolve(configRootUsed, 'local.json'));

  // If the operator explicitly points us to a config root, it's useful to fail
  // fast when it doesn't exist or contains no config files.
  if (explicitConfigRoot) {
    const ok = configDirExists && (defaultJsonExists || localJsonExists);
    checks.push({
      id: 'config.files',
      ok,
      message: ok
        ? 'Config directory and files present'
        : `Config directory/files missing under ${configRootUsed} (expected default.json and/or local.json)`,
      details: verbose
        ? {
            configRootUsed,
            configDirExists,
            defaultJsonExists,
            localJsonExists,
          }
        : { configRootUsed },
    });
  }

  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = loadConfig({ configRoot });
    checks.push({
      id: 'config.load',
      ok: true,
      message: 'Config loaded and validated',
      details: { configRootUsed },
    });
  } catch (err) {
    checks.push({
      id: 'config.load',
      ok: false,
      message: `Config failed to load/validate: ${(err as Error).message}`,
      details: { configRootAttempted: configRoot, configRootUsed },
    });
  }

  if (config) {
    const agentId = normalizeAgent(config.agent);
    const installed = isAgentInstalled(agentId);
    checks.push({
      id: 'agent.installed',
      ok: installed,
      message: installed
        ? `Agent '${agentId}' is installed`
        : `Agent '${agentId}' is not installed or not on PATH`,
    });

    const pluginEntries = config.plugins ?? [];

    for (let idx = 0; idx < pluginEntries.length; idx++) {
      const entry = pluginEntries[idx];
      const spec = typeof entry === 'string' ? entry : entry.package;
      if (!spec) continue;

      try {
        const mod = await importPluginModuleFromSpecifier(spec, resolutionRoot);
        const plugin = coercePlugin(mod);
        validatePluginSchema(plugin);

        const options = typeof entry === 'object' && entry.options ? entry.options : {};
        const mergedOptions = applyPluginDefaults(plugin, options);
        validatePluginConfig(plugin, mergedOptions);

        checks.push({
          id: `plugin.${idx}`,
          ok: true,
          message: `Plugin OK: ${plugin.name}@${plugin.version}`,
          details: verbose
            ? {
                spec,
                resolutionRoot,
              }
            : undefined,
        });
      } catch (err) {
        checks.push({
          id: `plugin.${idx}`,
          ok: false,
          message: `Plugin failed (${spec}): ${(err as Error).message}`,
          details: verbose
            ? {
                spec,
                resolutionRoot,
              }
            : undefined,
        });
      }
    }
  }

  const ok = checks.every((c) => c.ok);

  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok, configRootUsed, resolutionRoot, checks }, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`agent-detective doctor: ${ok ? 'OK' : 'FAILED'}`);
    // eslint-disable-next-line no-console
    console.log(`Using configRoot: ${configRootUsed}`);
    for (const c of checks) {
      // eslint-disable-next-line no-console
      console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id} - ${c.message}`);
      if (verbose && c.details) {
        // eslint-disable-next-line no-console
        console.log(`  details: ${JSON.stringify(c.details)}`);
      }
    }
  }

  process.exitCode = ok ? 0 : 1;
}

export async function runValidateConfig({ installRoot, argv }: DoctorOptions): Promise<void> {
  const { json, verbose } = parseFlags(argv);
  const configRoot = resolveConfigDirFromInstallRoot(installRoot);
  const configRootUsed = configRoot ?? resolve(process.cwd(), 'config');
  const explicitConfigRoot = hasExplicitConfigRootArg(argv) || hasExplicitConfigRootEnv();

  const configDirExists = existsSync(configRootUsed);
  const defaultJsonExists = existsSync(resolve(configRootUsed, 'default.json'));
  const localJsonExists = existsSync(resolve(configRootUsed, 'local.json'));

  let ok = true;
  let message = 'Config loaded and validated';
  let details: Record<string, unknown> | undefined;

  if (explicitConfigRoot && (!configDirExists || (!defaultJsonExists && !localJsonExists))) {
    ok = false;
    message = `Config directory/files missing under ${configRootUsed} (expected default.json and/or local.json)`;
    details = verbose
      ? {
          configRootUsed,
          configDirExists,
          defaultJsonExists,
          localJsonExists,
        }
      : { configRootUsed };
  }

  try {
    if (ok) {
      loadConfig({ configRoot });
      details = { ...(details ?? {}), configRootUsed };
    }
  } catch (err) {
    ok = false;
    message = `Config failed to load/validate: ${(err as Error).message}`;
    details = { configRootAttempted: configRoot, configRootUsed };
  }

  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok, check: { id: 'config.load', ok, message, details } }, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`${ok ? 'PASS' : 'FAIL'} config.load - ${message}`);
    // eslint-disable-next-line no-console
    console.log(`Using configRoot: ${configRootUsed}`);
    if (verbose && details) {
      // eslint-disable-next-line no-console
      console.log(`  details: ${JSON.stringify(details)}`);
    }
  }

  process.exitCode = ok ? 0 : 1;
}

