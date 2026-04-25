# Agent Detective — documentation site (Starlight)

Astro + [Starlight](https://starlight.astro.build/) under `website/`, separate from the Express app. Build output goes to `dist/`.

- **Local dev** (serves with base path `/agent-detective` to match GitHub Pages):

  ```bash
  pnpm --filter agent-detective-docs dev
  ```

  Open the URL the CLI prints (typically `http://localhost:4321/agent-detective/`).

- **Production build:**

  ```bash
  pnpm --filter agent-detective-docs build
  ```

`site` and `base` in `astro.config.mjs` target `https://toniop99.github.io/agent-detective`. Forks should change these when enabling Pages.

Integrating the main repo `../docs` content is a separate step (see project documentation checklist).
