# Agent Detective — documentation

AI-powered code analysis (Jira, webhooks, PR pipeline, local repos, and more). The root [README.md](../README.md) has a quick start; this page maps the **source tree** so you can jump to the right guide.

| Area | Path | For |
|------|------|-----|
| **Run the server** | [operator/](operator/) | Install, Docker, deployment, upgrade, observability |
| **Configuration** | [config/](config/) | Load order, env whitelist, long reference |
| **Plugins** | [plugins/](plugins/) | API guide, custom plugins, development template, publishing |
| **Contribute to the repo** | [development/](development/) | pnpm, Turbo, agents (Cursor), migration notes |
| **Design** | [architecture/](architecture/) | System view, layering, [ADR](architecture/adr/) |
| **Jira (manual E2E)** | [e2e/](e2e/) | Tunnel, webhooks, pr-pipeline walkthroughs |
| **Reference (generated + changelog)** | [reference/](reference/) | Zod-generated option schemas, [CHANGELOG](reference/CHANGELOG.md) |

## Pointers

- **Operator hubs (start here):** [configuration hub](config/configuration-hub.md) · [installation](operator/installation.md) · [upgrading](operator/upgrading.md)
- **Published doc site (Starlight):** built from this folder; see [apps/docs/README.md](../apps/docs/README.md) and `pnpm run docs:site` at the repo root
