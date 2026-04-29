---
title: "Threat model and operator security"
description: Abuse cases for webhooks, ticket content, and agent execution — with mitigations and owner actions.
sidebar:
  order: 3
---

# Threat model and operator security

Agent Detective is a **self-hosted HTTP service** that accepts **webhooks**, runs a **configured agent** (subprocess) with access to **local repos**, and may **write back** to issue trackers (Jira, Linear, …). Treat inbound HTTP and ticket bodies as **untrusted** unless your deployment adds stronger controls.

This is not a formal penetration-test report; it is an **operator checklist** aligned with how the product is built today.

## Assumptions

- You control the **host**, **config**, **network path** to trackers, and **which repos** are mounted.
- **Agent CLI and model endpoints** obey your org’s policies (keys, egress, retention).
- Plugins are **first-party or reviewed** before load (supply chain is your responsibility for third-party packages).

## Risk register

| Risk | Likelihood | Impact | Mitigation | Owner action |
|------|------------|--------|------------|----------------|
| **Forged or replayed webhooks** | Medium (internet-exposed URL) | Unauthorized agent runs, noisy queue, token burn | Use **signature verification** where the adapter supports it (Linear signing secret; Jira Automation should not expose shared secrets). Prefer **TLS** end-to-end; restrict ingress (firewall, VPN, allowlisted IPs if Jira IPs are stable enough for your model). | Configure signing secrets; do not use `skipWebhookSignatureVerification` in production ([linear-adapter.md](../plugins/linear-adapter.md)). |
| **Webhook volume / DoS** | Medium | CPU/memory pressure, queue depth, cost | Rate-limit at **reverse proxy**; run with **`tasks.maxConcurrent`** (see [configuration.md](../config/configuration.md)); monitor **`/api/metrics`** and logs. | Add nginx/ingress limits; set concurrency caps. |
| **HTML / Markdown / prompt injection in tickets** | Medium | Misleading analysis, exfiltration via agent “reading” crafted instructions | Jira path converts Markdown to ADF with **limited** element support; treat output as **untrusted** for downstream automation. Prompt hardening is **adapter/agent** dependent. | Review comments before acting; use **read-only** analysis where possible (`analysisReadOnly` / PR dry-run). |
| **Agent subprocess abuse** | Medium (misconfig) | File read outside intended repo, shell execution | **Least privilege OS user**, restrict **`repos[].path`**, do not run as root; use **`doctor`** to verify layout. Agent tools follow **CLI vendor** behavior. | Dedicated service account; minimal filesystem ACLs. |
| **Secret leakage via logs or comments** | Low–Medium | Credential exposure in Jira/Linear or log sinks | Never log raw tokens; use **`config/local.json`** + env whitelist ([configuration.md](../config/configuration.md)); avoid pasting secrets into issues. | Audit log redaction; restrict log access. |
| **MITM on outbound Jira/Linear/API** | Low (typical cloud) | Token theft | **HTTPS** only; pin corporate proxy policies if used. | TLS everywhere. |
| **Compromised plugin package** | Low (first-party) / higher (arbitrary npm) | Code execution at server privilege | Prefer **pinned versions**; review custom plugins ([extending-with-plugins.md](../plugins/extending-with-plugins.md)). | Lockfile discipline; internal registry for forks. |
| **SQLite file tampering / exfiltration** | Low (local disk) | Forged idempotency rows, leaked spawn metadata | Restrict filesystem permissions on the DB path; mount on encrypted volumes; backup access is operator-controlled. Cap Jira subtask volume via `taskSpawnMaxPerCompletion` ([jira-adapter.md](../plugins/jira-adapter.md)). | Run the app as a dedicated user; limit backup retention; use `taskSpawnAllowedProjectKeys` when projects must be constrained. |

## Webhook authenticity (detail)

- **Linear:** HMAC signature with **`webhookSigningSecret`** — verify enabled in production.
- **Jira:** Native webhooks and Automation use **your** URL; authenticity is often **network + obscurity** unless you add mutual TLS or IP allowlists. Reduce blast radius with **mockMode** in staging and tight **repo label** matching.

## Agent and data residency

- **Prompts and file reads** stay in **your** process boundary when using local agents and local repos — that is the product’s trust story vs SaaS sandboxes.
- **Model providers** still receive whatever the agent sends; govern that with your **AI usage** policies.

## Related docs

- [configuration.md](../config/configuration.md) — env whitelist, secrets, `tasks.*`, `runRecords`, `persistence`
- [golden-path.md](golden-path.md) — safe first install
- [deployment.md](deployment.md) — nginx, systemd, health checks
- Run **`agent-detective doctor`** before upgrades — validates tools and plugin contract surfaces.
