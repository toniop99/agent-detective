# Documentation IA and Starlight — implementation checklist

Branch: `docs/ia-reorganization` (suggested; create from `main`).

Use this list for reviewable PRs. Step IDs match the project plan; merge top to bottom, or group adjacent steps.

| Step | ID | Deliverable |
|------|-----|-------------|
| 1 | `step-01-installation-overview` | Installation / deployment hub page; fix placeholder clone URL in `deployment.md` **(done — review)** |
| 2 | `step-02-configuration-hub` | Configuration index (precedence, links to `configuration.md`, `generated/plugin-options.md`, `pnpm docs:plugins`) **(done — review)** |
| 3 | `step-03-upgrading` | New `upgrading.md` (image tags, releases, CHANGELOG, migration, runbook) **(done — review)** |
| 4 | `step-04-cross-links` | Cross-link hub pages; dedupe "see also" for nginx/systemd where duplicated **(done — review)** |
| 5 | `step-05-external-plugins-guide` | Single "extending with custom plugins" doc (loader: npm path vs `plugins/` mount) **(done — review)** |
| 6 | `step-06-dedupe-plugin-docs` | Trim `plugins.md` §13, `publishing.md`, `plugin-development.md`; point to step 5 **(done in step 5 — review)** |
| 7 | `step-07-readme-index` | `docs/README.md` + root `README`; optional `docs/e2e/` for Jira manuals **(done — review)** |
| 8 | `step-08-starlight-scaffold` | `apps/docs` + workspace, Astro + Starlight, `astro build` locally **(done — review)** |
| 9 | `step-09-starlight-nav-content` | Sidebar = IA, content copy/sync from `docs/`, dev script **(done — review)** |
| 10 | `step-10-starlight-ci` | GitHub Actions → GitHub Pages; README link to live docs **(done — review)** |
| 11 | `step-11-optional-config-gen` | Optional: `docs:config-table` from `src/config/schema.ts` |

**Suggested groupings for PRs:** 1–4 (operators) · 5–6 (plugin authors) · 7 (index) · 8–10 (site) · 11 (optional).

Remove this file when the work is done or keep it as a short pointer to the published doc site.
