# Agent Detective — documentation site (Starlight)

Astro + [Starlight](https://starlight.astro.build/) under **`apps/docs`**, next to the main app under the monorepo root. Build output: `dist/` (then nested to `dist/docs/` for GitHub Pages).

- **Prerequisite:** the sync step copies and rewrites `../../docs/**` into `src/content/docs/**` (mirrors subfolders such as `operator/`, `config/`, `plugins/`, …). It skips `index.md` / `index.mdx` (the Starlight home). `prebuild` runs sync automatically. Mirrored content is [gitignored](.gitignore).

- **Published URL:** **https://agent-detective.chapascript.dev/docs/** — set the same hostname in **GitHub → Settings → Pages → Custom domain**, and in **Cloudflare** (or your DNS) point that name to GitHub Pages with a **CNAME** to `toniop99.github.io` (see [GitHub’s custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)). Use **GitHub Actions** as the Pages build source.

- **Path:** `site` + `base` in `astro.config.mjs` target that URL (`base: '/docs'`). After `astro build`, `stage-docs-dist.mjs` moves the built files into `dist/docs/`.

- **Local dev** (serves the same `base`):

  ```bash
  pnpm --filter agent-detective-docs dev
  # or from the repo root:
  pnpm run docs:site:dev
  ```

  Open **http://localhost:4321/docs/** (port may differ; check the terminal).

- **Build:**

  ```bash
  pnpm --filter agent-detective-docs build
  # or: pnpm run docs:site
  ```

- **Manual sync only (without build):** `pnpm run docs:site:sync` at the monorepo root.

Forks: set `site` in `astro.config.mjs` to your published URL and `BASE` in `scripts/sync-starlight-content.mjs` to match `base`.
