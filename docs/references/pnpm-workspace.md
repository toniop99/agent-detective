# pnpm workspace (cheat sheet)

- **Root** is the main app; **`packages/*`** are workspace packages. Declared in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml).
- **Depends on a package:** in that package’s `package.json`, use `"@agent-detective/foo": "workspace:*"`.
- **`catalog:`** — shared versions live in `pnpm-workspace.yaml` `catalog`; depend with `"zod": "catalog:"` etc.
- **Install:** from repo root, `pnpm install` (use **`--frozen-lockfile`** in CI).

More: [Development guide](../development/development.md).
