# Extending the app with custom plugins

Use a **Plugin** (see `Plugin` in [`@agent-detective/types`](../../packages/types/src/index.ts)) to add HTTP routes, services, and event handling. This page explains how to **install and wire** a plugin in your deployment. For the full API, patterns, and official bundles, see [plugins.md](plugins.md). For a **TypeScript project template** and long examples, see [plugin-development.md](plugin-development.md).

## How plugins are loaded

The core resolves each `plugins[]` entry’s `package` string at startup (see [`importPluginModuleFromSpecifier` in `src/core/plugin-system.ts`](../../src/core/plugin-system.ts)):

| Specifier | Resolution |
|-----------|------------|
| **npm-style name** (e.g. `@myorg/adapter`) | `import()` from **`node_modules`** at the app root (add the dependency to the **root** `package.json` with pnpm or npm, then run install). |
| **Relative or absolute file path** (starts with `./`, `../`, or `/`) | ES module import from a path on disk, resolved from **`process.cwd()`** (in the official image, **`/app`**). |
| **`@agent-detective/<short>` from this monorepo** | If a bare `import` fails, the loader tries **`packages/<short>/dist/index.js`**, else **`src/index.js`** (dev) — the normal **fork / workspace** layout. |

A failed import logs a warning and the plugin is skipped (other plugins still load). Fix paths, add dependencies, or ensure `cwd` is the app root (important in Docker: **`WORKDIR /app`**, mount paths under that tree when using absolute paths).

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

## Public npm (or GitHub Packages)

1. Build your package so **`dist/index.js`** is the ESM default export and **`default` exports the `Plugin` object.  
2. **Publish** (see [publishing.md](publishing.md#for-external-plugin-developers) for `npm` / `@agent-detective/types`).  
3. In the **agent-detective** app (clone or a thin wrapper repo), at the **repository root**:
   ```bash
   pnpm add @myorg/adapter@^1.0.0
   ```
4. Add the package name to `plugins` in `config` as above.

**Private registry:** use `.npmrc` in the app root (e.g. `@myorg:registry=…`, `//…:_authToken=…`) and the same `pnpm add` in CI or your image build; do not commit tokens — use env / CI secrets. **GitHub Packages** (and similar) use a scoped registry URL in `.npmrc` — follow your host’s docs; the app only needs the package installed into `node_modules` like any other dependency.

## Path-based install (no registry)

1. **Build** your plugin (output `dist/index.js` or a single `index.js` next to a `package.json` if you use a subfolder layout from [plugin-development.md](plugin-development.md)).  
2. **Copy** the built tree to a directory on the server or image context.  
3. Set **`"package": "/opt/plugins/my-adapter"`** (or `./plugins/my-adapter` relative to `cwd`).

Use **absolute** paths in Docker so they do not depend on `docker compose` context:

- Mount the directory into the container (compose files in this repo use **`./plugins:/app/plugins:ro`**) and set **`"package": "/app/plugins/my-adapter"`** (see [docker.md](../operator/docker.md), [docker-compose.prod.yml](../../docker-compose.prod.yml)).

The mounted folder must be importable as an ES module (e.g. `index.js` at the entry the path resolves to — match how you `import` a package root).

## Docker image without editing `package.json`

The volume approach above — mount **`plugins/`** and reference **`/app/plugins/...`** in config — is the usual way to ship a **proprietary** plugin without republishing a base image. Rebuild the image if you need the dependency inside **`node_modules`** instead.

## After changing code in this monorepo

If you add a new workspace package under `packages/*`, add it to the root `config.plugins` with **`"@agent-detective/your-pkg"`** (or a relative path) and run **`pnpm install`** / **`pnpm run build`** as in [development.md](../development/development.md).

## See also

- [plugin-development.md](plugin-development.md) — build, `package.json`, decorators, long examples  
- [plugins.md](plugins.md#9-publishing-a-plugin-as-an-npm-package) — publishing a plugin as an npm package (in-guide)  
- [configuration.md](../config/configuration.md) — env merging into `plugins`  
- [installation.md](../operator/installation.md) — Docker mounts and deploy paths
