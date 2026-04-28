# Agent Detective — documentation

AI-powered code analysis (Jira, webhooks, PR pipeline, local repos, and more). The root [README.md](../README.md) has a quick start; this page maps the **source tree** so you can jump to the right guide.

| Area | Path | For |
|------|------|-----|
| **Run the server** | [operator/](operator/) | Install, Docker, deployment, upgrade, observability |
| **Configuration** | [config/](config/) | Load order, env whitelist, long reference |
| **Plugins** | [plugins/](plugins/) | API guide, custom plugins, development template, publishing |
| **Contribute to the repo** | [development/](development/) | pnpm, Turbo, agents (Cursor), migration notes |
| **Agent harness (boot, verify, logs)** | [development/agent-harness.md](development/agent-harness.md) | Runbook for humans + coding agents |
| **Agent workflow (PR loop)** | [development/agent-workflow.md](development/agent-workflow.md) | Suggested steps before/during/after changes |
| **Execution plans & tech debt** | [exec-plans/](exec-plans/) | Versioned multi-step intent; rolling debt notes |
| **Short tool references** | [references/](references/) | pnpm, Turbo, ESM — low-token entry |
| **Agent golden rules** | [development/agent-golden-rules.md](development/agent-golden-rules.md) | Do / don’t, plugins, common failures |
| **Design** | [architecture/](architecture/) | System view, layering, [ADR](architecture/adr/) |
| **Jira / Linear (manual E2E)** | [e2e/](e2e/) | Tunnel, webhooks, pr-pipeline walkthroughs; [Linear](e2e/linear-manual-e2e.md) |
| **Reference (generated)** | [reference/](reference/) | Zod-generated option schemas under `reference/generated/` |

## Pointers

- **Operator hubs (start here):** [configuration hub](config/configuration-hub.md) · [installation](operator/installation.md) · [upgrading](operator/upgrading.md)
- **Published doc site (Starlight):** built from this folder; see [apps/docs/README.md](../apps/docs/README.md) and `pnpm run docs:site` at the repo root
