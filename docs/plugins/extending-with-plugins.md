---
title: "Extending with plugins"
description: Install custom plugins from npm, local paths, or read-only directories.
sidebar:
  order: 1
---

# Extending the app with custom plugins

Use a **Plugin** (see `Plugin` in [`@agent-detective/types`](../../packages/types/src/index.ts)) to add HTTP routes, services, and event handling. This page explains how to **install and wire** a plugin in your deployment. For the full API, patterns, and official bundles, see [plugins.md](plugins.md). For a **TypeScript project template** and long examples, see [plugin-development.md](plugin-development.md).

## How plugins are loaded

The core resolves each `plugins[]` entry’s `package` string at startup (see [`importPluginModuleFromSpecifier` in `src/core/plugin-system.ts`](../../src/core/plugin-system.ts)):

| Specifier | Resolution |
|-----------|------------|
| **npm-style name** (e.g. `@myorg/adapter`) | `import()` from **`node_modules`** at the app root (add the dependency to the **root** `package.json` with pnpm or npm, then run install). |
| **Relative or absolute file path** (starts with `./`, `../`, or `/`) | ES module import from a path on disk, resolved from **`process.cwd()`** (use **`--config-root`** so relative plugin paths resolve predictably). |
| **`@agent-detective/<short>` from this monorepo** | If a bare `import` fails, the loader tries **`packages/<short>/dist/index.js`**. If that does not exist, it only falls back to **`packages/<short>/src/index.js`** when that file exists (plain JS sources). In a TypeScript workspace you typically need to run **`pnpm run build`** (or a watch build) so `dist/` exists. |

A failed import logs a warning and the plugin is skipped (other plugins still load). Fix paths, add dependencies, or ensure `cwd` / **`--config-root`** matches where you placed plugin files.

## `config` entry

List plugins in `config/default.json` (and overrides), as described in [configuration-hub.md](../config/configuration-hub.md):

```json
{
  "plugins": [
    {
      "package": "@myorg/adapter",
      "options": { "enabled": true }
    }
  ]
}
```

- **`package`:** one of the specifiers in the table above.  
- **`options`:** merged with your plugin’s JSON `schema` defaults and validated; bundled plugins also use Zod in code — see [generated/plugin-options.md](../reference/generated/plugin-options.md) for first-party packages only.

## `dependsOn`

If your plugin’s `name` is `@myorg/b` and it calls `getService` from another plugin, set **`dependsOn: ['@myorg/a']`** on the plugin object (use the **Plugin `name`**, not necessarily the package string). The core orders loads topologically. First-party example: [AGENTS.md](../../AGENTS.md) (`dependsOn` in practice).

## `requiresCapabilities`

Use `requiresCapabilities` when you don’t care *which* plugin provides a feature, only that the feature exists.

- Prefer SDK constants from `@agent-detective/sdk` (`StandardCapabilities.*`).
- If you define a custom capability in a third-party plugin, use a stable **namespaced** string like `acme.example/my-feature`.

## Public npm (or GitHub Packages)

1. Build your package so **`dist/index.js`** is the ESM default export and **`default` exports the `Plugin` object.  
2. **Publish** (see [publishing.md](publishing.md#for-external-plugin-developers) for `npm` / `@agent-detective/types`).  
3. In the **agent-detective** app (clone or a thin wrapper repo), at the **repository root**:
   ```bash
   pnpm add @myorg/adapter@^1.0.0
   ```
4. Add the package name to `plugins` in `config` as above.

**Private registry:** use `.npmrc` in the app root (e.g. `@myorg:registry=…`, `//…:_authToken=…`) and the same `pnpm add` in CI or your deploy host; do not commit tokens — use env / CI secrets. **GitHub Packages** (and similar) use a scoped registry URL in `.npmrc` — follow your host’s docs; the app only needs the package installed into `node_modules` like any other dependency.

## Path-based install (no registry)

1. **Build** your plugin (output `dist/index.js` or a single `index.js` next to a `package.json` if you use a subfolder layout from [plugin-development.md](plugin-development.md)).  
2. **Copy** the built tree to a directory on the server or image context.  
3. Set **`"package": "/opt/plugins/my-adapter"`** (or `./plugins/my-adapter` relative to `cwd`).

Use **absolute** paths when the process `cwd` might differ from where plugins live (typical for systemd **`WorkingDirectory=`** plus a separate read-only tree):

- Example: install tree `/opt/agent-detective/plugins/my-adapter` and set **`"package": "/opt/agent-detective/plugins/my-adapter"`** in `config`.

The directory must be importable as an ES module (e.g. `index.js` at the entry the path resolves to — match how you `import` a package root).

## Plugins without editing root `package.json`

The path approach above — ship a built plugin directory next to `config/` and reference it by **absolute path** — is the usual way to add a **proprietary** plugin without publishing it to npm. If you need the dependency only as a package name, add it to the root **`package.json`** and run **`pnpm install`** instead.

## After changing code in this monorepo

If you add a new workspace package under `packages/*`, add it to the root `config.plugins` with **`"@agent-detective/your-pkg"`** (or a relative path) and run **`pnpm install`** / **`pnpm run build`** as in [development.md](../development/development.md).

## See also

- [plugin-development.md](plugin-development.md) — build, `package.json`, `defineRoute` examples  
- [plugins.md](plugins.md#9-publishing-a-plugin-as-an-npm-package) — publishing a plugin as an npm package (in-guide)  
- [configuration.md](../config/configuration.md) — env merging into `plugins`  
- [installation.md](../operator/installation.md) — deploy paths and install layout
