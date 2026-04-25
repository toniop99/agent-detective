# Agent Detective — documentation site (Starlight)

Astro + [Starlight](https://starlight.astro.build/) under **`apps/docs`**, next to the main app under the monorepo root. Build output: `dist/`.

- **Prerequisite:** the sync step copies and rewrites `../../docs/**` into `src/content/docs/**` (mirrors subfolders such as `operator/`, `config/`, `plugins/`, …). It skips `index.md` / `index.mdx` (the Starlight home). `prebuild` runs sync automatically. Mirrored content is [gitignored](.gitignore).

- **Local dev** (serves with base path `/agent-detective` to match [GitHub project Pages](https://docs.github.com/en/pages)):

  ```bash
  pnpm --filter agent-detective-docs dev
  # or from the repo root:
  pnpm run docs:site:dev
  ```

  Open the URL the CLI prints (e.g. `http://localhost:4321/agent-detective/`).

- **Build:**

  ```bash
  pnpm --filter agent-detective-docs build
  # or: pnpm run docs:site
  ```

- **Manual sync only (without build):** `pnpm run docs:site:sync` at the monorepo root.

`site` and `base` in `astro.config.mjs` are set for `https://toniop99.github.io/agent-detective/`. Change them if you fork or use a custom domain.
