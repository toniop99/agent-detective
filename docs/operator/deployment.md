---
title: "Deployment guide"
description: Single-server bare-metal deployment with systemd, reverse proxy, and sizing.
sidebar:
  order: 3
---

# Deployment guide

Single-server **bare‑metal** deployment: systemd, reverse proxy, and sizing. Unsure which path to use? Start with **[installation.md](installation.md)** (binary vs from source). For **config and env**, see [configuration-hub.md](../config/configuration-hub.md) and [configuration.md](../config/configuration.md). When you’ve deployed before and need **new releases or git pulls**, see [upgrading.md](upgrading.md).

## Prerequisites

:::note[System requirements]
All versions below are **minimum** requirements. Using older versions may work but is not tested or supported.
:::

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 24+ | LTS recommended |
| pnpm | 10+ | As in `packageManager` in root `package.json` |
| git | Any recent | For cloning the repository |
| OS | Ubuntu 22.04+ / Debian 12+ / macOS 13+ | Any Unix with systemd (optional) |

## Server sizing

| Tier | CPU | RAM | Disk | Use case |
|------|-----|-----|------|----------|
| Minimal | 1 core | 1 GB | 10 GB | Development / testing |
| Recommended | 2 cores | 4 GB | 20 GB | Production workloads |

## Installation (from source)

```bash title="Clone, install, and build"
git clone https://github.com/toniop99/agent-detective.git
cd agent-detective
pnpm install
pnpm run build
pnpm run build:app
```

Use your own fork’s `https://github.com/<owner>/<repo>.git` URL if you are not building from the upstream repository.

Edit `config/default.json` (and optional `config/local.json`). See [configuration.md](../config/configuration.md).

```bash title="Start the server"
pnpm start
```

For development with hot reload: `pnpm run dev`. See [development.md](../development/development.md).

## Configuration reference (summary)

[configuration-hub.md](../config/configuration-hub.md) documents merge order and top-level keys. **Repository context** (e.g. `gitLogMaxCommits`) belongs under **local-repos-plugin** `options`, not as a root `repoContext` key.

**Example** `config/default.json` skeleton for a bare-metal install (full plugin fields: [generated/plugin-options.md](../reference/generated/plugin-options.md)):

```json title="config/default.json"
{
  "port": 3001,
  "agent": "opencode",
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [],
        "repoContext": { "gitLogMaxCommits": 50 },
        "techStackDetection": { "enabled": true },
        "summaryGeneration": {},
        "validation": { "failOnMissing": false }
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "mockMode": true,
        "webhookBehavior": {}
      }
    }
  ]
}
```

Full options: [generated/plugin-options.md](../reference/generated/plugin-options.md), [plugins.md](../plugins/plugins.md#14-official-bundled-plugins).

## Process management (systemd)

Create `/etc/systemd/system/agent-detective.service`:

```ini title="/etc/systemd/system/agent-detective.service"
[Unit]
Description=Agent Detective
After=network.target

[Service]
Type=simple
User=agent-detective
WorkingDirectory=/opt/agent-detective
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

```bash title="Set up systemd service"
sudo useradd -r -s /usr/sbin/nologin agent-detective
sudo mkdir -p /opt/agent-detective
sudo cp -r . /opt/agent-detective
sudo chown -R agent-detective:agent-detective /opt/agent-detective
cd /opt/agent-detective
sudo -u agent-detective pnpm install
sudo -u agent-detective pnpm run build
sudo -u agent-detective pnpm run build:app
sudo systemctl daemon-reload
sudo systemctl enable agent-detective
sudo systemctl start agent-detective
```

View logs: `sudo journalctl -u agent-detective -f`.

## Reverse proxy (nginx)

**Canonical** HTTPS example in this repo (use this; do not maintain a second copy in other docs). Point `proxy_pass` at the port the app listens on (default **3001** unless overridden by `PORT` / config).

```nginx title="nginx reverse proxy"
server {
    listen 443 ssl;
    server_name agent-detective.example.com;

    ssl_certificate /etc/ssl/certs/example.com.pem;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
    chunked_transfer_encoding on;
}
```

## Security

:::caution[Production hardening]
Never store API tokens or credentials in `config/*.json` files that may be committed to version control. Use environment variables or `config/local.json` (gitignored) for secrets.
:::

- Restrict firewall to SSH, HTTP, HTTPS as needed: `sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable`
- Jira: configure webhook URL and, if used, shared secrets in Jira; prefer `JIRA_API_TOKEN` / `JIRA_EMAIL` / `JIRA_BASE_URL` from the environment (see [configuration.md](../config/configuration.md)) instead of tokens in config files.

## Health checks

The HTTP API is under **`/api`**.

- **`GET /api/health`** — JSON includes `"status"`: `ok` | `degraded` | `unhealthy` (see [observability.md](observability.md)).
- **`GET /api/agent/list`** — agent availability

```bash title="Health and agent checks"
curl -sS http://localhost:3001/api/health
curl -sS http://localhost:3001/api/agent/list
```

## API docs

- Interactive docs UI: `GET /docs` (from-source / `pnpm start` on built `dist/`)
- Native binary (SEA): UI is disabled; use `GET /docs/openapi.json` (see [binary.md](binary.md))

## Log management

Structured logs go to **stdout/stderr** (captured by journald under systemd). Set log level via `observability` / `LOG_LEVEL` / `OBSERVABILITY_LOG_LEVEL` (see [configuration.md](../config/configuration.md)).

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Server won't start | Valid JSON in `config/*.json`, port free: `sudo lsof -i :3001` |
| Plugin load failure | `node_modules/@agent-detective/*/dist/`, `pnpm run lint` |
| Jira webhooks | `mockMode: false`, env `JIRA_*`, webhook URL reachable from Atlassian |
| Agent unavailable | `which opencode` (or your agent) in the same environment as the process; `GET /api/agent/list` |
| High memory | Lower `repoContext.gitLogMaxCommits` in local-repos options |

## See also

- [installation.md](installation.md) — choose binary vs from source first
- [configuration-hub.md](../config/configuration-hub.md) — config load order
- [upgrading.md](upgrading.md) — releases and upgrade runbooks
