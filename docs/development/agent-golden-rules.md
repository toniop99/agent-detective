# Golden rules (humans & agents)

These rules keep the monorepo buildable, type-safe, and easy for agents to navigate. **`AGENTS.md` at the repo root stays short** — this file is the expanded checklist.

## Do

- **Plugin authors:** import everything from **`@agent-detective/sdk`** (types, runtime helpers, service constants — single dependency). **Host code only:** `@agent-detective/types` is the type-only contract, used inside `src/` and the host-facing workspace packages.
- Use **`.ts`** for source and **`.test.ts`** for tests.
- Use **ESM** with **`.js` extensions** in import specifiers (e.g. `from './foo.js'`) so emitted JS resolves.
- Run **`pnpm run build`** before publishing packages; run **`pnpm run build:app`** for the root **`dist/index.js`** used by **`pnpm start`** and Docker.

## Do not

- Edit generated **`dist/`** output by hand.
- Import the root app with deep relatives from **`packages/*`** (e.g. `../../../src/core/...`) — CI rejects this; use workspace packages instead.
- **Compile-import another plugin** from a plugin package (e.g. `pr-pipeline` importing `@agent-detective/local-repos-plugin` in `src/`) — use **`@agent-detective/sdk`** for shared ports (re-exported from the type-only `@agent-detective/types`) and **`getService()`** at runtime ([ADR 0001](../architecture/adr/0001-layering-and-plugin-boundaries.md)); `pnpm run lint` runs **`scripts/check-plugin-cross-imports.mjs`**.
- Create **`.js`** files next to **`.ts`** sources.
- Set **`rootDir`** in a package `tsconfig` to span multiple unrelated trees.

## Plugin HTTP and loading

- Routes are auto-prefixed with **`/plugins/{sanitized-name}`**; register plugins with **relative** paths via `defineRoute()` + `registerRoutes(scope, ...)` on the Fastify scope passed to **`register`**.
- Use **`dependsOn`** so services load before dependents.
- **`Plugin`** uses **`schemaVersion: '1.0'`** and **`register(scope: FastifyInstance, context: PluginContext)`** — see [Plugins guide](../plugins/plugins.md), [ADR 0001: layering and plugin boundaries](../architecture/adr/0001-layering-and-plugin-boundaries.md), and [ADR 0002: HTTP framework](../architecture/adr/0002-http-framework.md).

| Plugin name | HTTP prefix |
|-------------|----------------|
| `@agent-detective/jira-adapter` | `/plugins/agent-detective-jira-adapter` |
| `my-plugin` | `/plugins/my-plugin` |

### Example: `dependsOn`

```typescript
{
  name: '@agent-detective/my-adapter',
  dependsOn: ['@agent-detective/local-repos-plugin'],
  register(app, context) {
    const localReposService = context.getService<LocalReposService>(
      '@agent-detective/local-repos-plugin',
    );
    // localReposService.localRepos, localReposService.buildRepoContext
  },
}
```

## Types reference

Full definitions: [`packages/types/src/index.ts`](../../packages/types/src/index.ts). Shapes you touch most often:

- **`Plugin`** — `name`, `version`, **`schemaVersion: '1.0'`**, optional `schema`, `dependsOn`, **`register(app, context)`** (may return controller objects for OpenAPI).
- **`PluginContext`** — `agentRunner`, `enqueue`, `config`, `logger`, `controllers`, `events`, `registerService` / `getService`, agents and capabilities, `registerTaskQueue`, `onShutdown`.
- **`TaskEvent`** — `source`, `type`, `payload`, optional `timestamp`.

## Common failures

### `Cannot find module '@agent-detective/sdk'`

**Cause:** Used a deep relative path into another folder instead of the workspace package.  
**Fix:** `import { … } from '@agent-detective/sdk'`. Plugins should never depend on `@agent-detective/types` directly; the sdk re-exports every plugin-facing type.

### Plugin build / `rootDir is outside rootDir`

**Cause:** Package imports from **`../../../src/core/...`** (root app).  
**Fix:** Same as above — only workspace imports from `packages/*`.

### Tests not running / duplicate output

**Cause:** Stray **`.js`** tests next to **`.ts`**.  
**Fix:** Delete the **`.js`** tests; keep **`*.test.ts`**.

### Module not found after build

**Cause:** Missing **`.js`** suffix in ESM imports or missing **`"type": "module"`** in `package.json`.  
**Fix:** Align imports and `package.json` with sibling packages.

## Where to read next

- [Agent harness](./agent-harness.md) — boot, test, lint, smoke, logs.
- [Agent workflow](./agent-workflow.md) — suggested loop before opening a PR.
- [Development guide](./development.md) — pnpm, Turbo, layout.
- [Plugins](../plugins/plugins.md) — full plugin guide.
- [Publishing](../plugins/publishing.md) — package release workflow.
