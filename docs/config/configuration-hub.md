# Configuration overview

:::caution[Secrets]
Prefer environment variables on the **whitelist** for production; see the tables in [configuration.md](configuration.md).
:::

This page is the **index**: how settings are loaded, in what order they win, and where the full reference lives. For every switch and table, use **[configuration.md](configuration.md)**; for fields on bundled plugins only, use the **[generated plugin options](../reference/generated/plugin-options.md)**.

**Other operator hubs:** [installation.md](../operator/installation.md) (where to run the app) · [upgrading.md](../operator/upgrading.md) (releases and image tags).

## Where configuration lives

| Source | Location |
|--------|----------|
| Base JSON | `config/default.json` (usually committed) |
| Overrides | `config/local.json` (optional; often gitignored) |
| Process env | Small **whitelist** only — see [configuration.md](configuration.md) (not generic `FOO__bar__baz` mapping) |

Files are read from **`config/`** relative to the process **current working directory** (e.g. app root, or `/app` in the Docker image).

## Precedence (highest last)

1. **`config/default.json`** — baseline.
2. **`config/local.json`** — deep-merged on top. **Arrays replace**; they are not concatenated.
3. **Core env whitelist** — overrides or augments the merged JSON (e.g. `PORT`, `AGENT`, `AGENTS_RUNNER_*`). See the tables in [configuration.md](configuration.md#core-env-whitelist).
4. **Plugin env whitelist (first-party)** — merged **only** into an existing `plugins[]` entry with the same `package` name (plugins are not created from env alone). See [configuration.md](configuration.md#plugin-env-whitelist-first-party).

If the same value is set in both JSON and env, **env wins** for the keys covered by the whitelist (see [configuration.md](configuration.md#pr-pipeline-agent-detectivepr-pipeline) on precedence for some secrets at runtime too).

## Top-level application shape (Zod)

The server validates the merged result with [`src/config/schema.ts`](../../src/config/schema.ts). **Known** top-level fields include:

| Key | Role |
|-----|------|
| `port` | HTTP port (overridable with `PORT`). |
| `agent` | Default agent id (overridable with `AGENT`). |
| `agents` | Per-agent settings: a map of agent id → `{ "defaultModel": "…" }`, plus a special key **`runner`** for child-process limits (`timeoutMs`, `maxBufferBytes`, `postFinalGraceMs`, `forceKillDelayMs`). |
| `plugins` | List of `{ "package": "…", "options": { … } }` entries; each plugin validates its own `options` (Zod in the plugin package). |
| `pluginSystem` | Plugin-system behavior flags (strict boot). |
| `observability` | Passed into `@agent-detective/observability` (e.g. `requestLogger.excludePaths`). |
| `docsAuthRequired` / `docsApiKey` | Protect `/docs` with an API key; overridable via `DOCS_AUTH_REQUIRED` / `DOCS_API_KEY`. |

The schema rejects **unknown top-level keys** (strict validation).

A **table and full JSON Schema (draft-7) kept in sync with Zod** are in **[generated/app-config.md](../reference/generated/app-config.md)** — regenerate with `pnpm docs:config` after changing `src/config/schema.ts` (the same way `pnpm docs:plugins` updates plugin options).

**Plugin `options`:** not listed in the table above — each plugin’s keys are defined in that plugin’s Zod schema and in **[generated/plugin-options.md](../reference/generated/plugin-options.md)**.

## Regenerating generated references

When you change Zod in `packages/*/src/application/options-schema.ts` (bundled plugins), regenerate the markdown reference and commit the diff:

```bash
pnpm docs:plugins
```

When you change the top-level app schema in `src/config/schema.ts`:

```bash
pnpm docs:config
```

In CI, `pnpm docs:plugins:check` and `pnpm docs:config:check` fail if the generated files are out of date. Paths: [architecture-layering.md](../architecture/architecture-layering.md).

## Read next

| Need | Document |
|------|----------|
| Full env reference, Jira, Linear, pr-pipeline, local-repos, validation | [configuration.md](configuration.md) |
| Field-by-field plugin options (bundled plugins) | [generated/plugin-options.md](../reference/generated/plugin-options.md) |
| Top-level app config table + JSON Schema (from Zod) | [generated/app-config.md](../reference/generated/app-config.md) |
| Plugin system and `schema` in code | [plugins.md](../plugins/plugins.md) (e.g. schema system) |
| Custom plugins (npm, path, `plugins/` mount) | [extending-with-plugins.md](../plugins/extending-with-plugins.md) |
| Install paths and `config` mounts | [installation.md](../operator/installation.md) |
| New releases, GHCR tags, git pull | [upgrading.md](../operator/upgrading.md) |
| Docker-specific env | [docker.md](../operator/docker.md#production-style-run-single-host) |