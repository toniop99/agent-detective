# Deployment Guide

Single-server deployment guide for agent-detective.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 24+ | LTS recommended |
| pnpm | 8+ | As specified in `packageManager` field |
| git | Any recent | For cloning the repository |
| OS | Ubuntu 22.04+ / Debian 12+ / macOS 13+ | Any Unix with systemd |

## Docker Deployment

Docker is the recommended way to run agent-detective, both for local development and production.

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/agent-detective.git
cd agent-detective

# Start development environment (hot reload enabled)
docker-compose up
```

### File Structure

```
agent-detective/
├── Dockerfile              # Multi-stage: dev + production
├── docker-compose.yml     # Development environment
├── docker-compose.prod.yml # Production deployment
├── .dockerignore
└── config/
    └── default.json       # Configuration
```

---

## Docker Development

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+

### Starting Development

```bash
# Build and start the development container
docker-compose up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### How It Works

| Feature | How |
|---------|-----|
| Hot reload | Volumes mount `./src` and `./packages` into container |
| Config | Mounted read-only from `./config` |
| Agents | Run on **host machine**, not in container |
| Ports | `localhost:3001` → container port `3001` |
| Repos | Optional: mount repos directory |

### Agent Setup (Host)

Agents run on the host machine. Install them on your host:

```bash
# opencode (recommended)
npm install -g opencode

# claude (optional)
npm install -g @anthropic-ai/claude

# gemini (optional)
npm install -g gemini-cli
```

Agents are invoked via the host's PATH when the container spawns the Node.js process.

### Mounting Repos Directory

Uncomment the volume in `docker-compose.yml`:

```yaml
volumes:
  - ./config:/app/config:ro
  # Mount repos directory for repository analysis
  - /path/to/your/repos:/repos:ro
```

---

## Docker Production

### Building the Image

```bash
# Build with default agents (opencode only)
docker build --target production -t agent-detective:latest .

# Build with specific agents
docker build --target production \
  --build-arg AGENTS="opencode,claude,gemini" \
  -t agent-detective:latest .

# Available agents: opencode, claude, gemini
# Note: codex is not available in Docker due to its installation method
```

### Running the Container

```bash
# Basic run
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/config:/app/config:ro \
  agent-detective:latest

# With environment variables
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/config:/app/config:ro \
  -e NODE_ENV=production \
  -e AGENT=opencode \
  -e JIRA_API_TOKEN=your-token \
  agent-detective:latest
```

### Production docker-compose

Use `docker-compose.prod.yml` for production:

```bash
# Set environment variables
export AGENTS=opencode,claude,gemini
export PORT=3001
export LOG_LEVEL=info

# Start production stack
docker-compose -f docker-compose.prod.yml up -d
```

### Docker Secrets

For sensitive data in production, use Docker secrets:

```bash
# Create secrets directory
mkdir -p secrets

# Create secret files (no trailing newline in file)
echo -n "your-jira-api-token" > secrets/jira_api_token.txt
echo -n "bot@example.com" > secrets/jira_email.txt

# Secure the secrets
chmod 600 secrets/*.txt

# Start with secrets
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS` | `opencode` | Agents to install in container (comma-separated) |
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `production` | Environment mode |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AGENT` | `opencode` | Default agent to use |
| `MODEL` | - | Global default model for all agents |
| `AGENTS_OPENCODE_MODEL` | `opencode/gpt-5-nano` | opencode default model |
| `AGENTS_CLAUDE_MODEL` | `claude-sonnet-4-20250514` | claude default model |
| `AGENTS_GEMINI_MODEL` | `gemini-2.5-pro-preview-06-05` | gemini default model |
| `REPO_CONTEXT_GIT_LOG_MAX_COMMITS` | `50` | Max commits for repo context |
| `JIRA_API_TOKEN` | - | Jira API token |
| `JIRA_EMAIL` | - | Jira account email |
| `JIRA_BASE_URL` | - | Jira instance URL |
| `REPOS_PATH` | - | Path to repos directory |

### Configuration Loading (12-Factor App)

Environment variables take precedence over `config/default.json`:

```
config/default.json  <-- Base config
         |
         v
Environment variables override values
         |
         v
   Final config
```

Example - override Jira settings via environment:
```bash
docker run -e JIRA_API_TOKEN=xxx -e JIRA_EMAIL=bot@example.com ...
```

### Agent Model Configuration

Models can be configured at three levels (highest to lowest precedence):

1. **Per-request** - Set `model` in `RunAgentOptions` when calling `runAgentForChat`
2. **Environment variable** - `AGENTS_OPENCODE_MODEL`, `AGENTS_CLAUDE_MODEL`, `AGENTS_GEMINI_MODEL`
3. **Config file** - `config/default.json` under `agents[].defaultModel`
4. **Hardcoded default** - Built into each agent

Example - change opencode model via environment:
```bash
docker run -e AGENTS_OPENCODE_MODEL=opencode/gpt-4 ...
```

Example - change default agent and model:
```bash
docker run -e AGENT=claude -e AGENTS_CLAUDE_MODEL=claude-opus-4 ...
```

---

## Production Distribution (Docker Hub / ghcr.io)

The recommended way to run agent-detective in production is to pull the official Docker image from GitHub Container Registry.

### Pulling the Image

```bash
# Pull the latest version
docker pull ghcr.io/toniop99/agent-detective:latest

# Pull a specific version
docker pull ghcr.io/toniop99/agent-detective:1.0.0

# Pull the stable version
docker pull ghcr.io/toniop99/agent-detective:stable
```

### Available Image Tags

| Tag | Description | When Updated |
|-----|-------------|--------------|
| `latest` | Most recent build from main | Every push to main |
| `stable` | Most recent release | On version tag |
| `1` | Latest v1.x.x | On minor release |
| `1.0` | Latest v1.0.x | On patch release |
| `1.0.0` | Specific version | On version tag |

### Minimal Production Run

No source code or config file needed:

```bash
docker run -d \
  -p 3001:3001 \
  -e AGENT=opencode \
  -e NODE_ENV=production \
  ghcr.io/toniop99/agent-detective:latest
```

### Production Run with Configuration

```bash
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/config:/app/config:ro \
  -e JIRA_API_TOKEN=your-token \
  -e JIRA_EMAIL=bot@example.com \
  ghcr.io/toniop99/agent-detective:latest
```

### Production Run with docker-compose

Create `docker-compose.yml`:

```yaml
services:
  agent-detective:
    image: ghcr.io/toniop99/agent-detective:latest
    ports:
      - "3001:3001"
    volumes:
      - ./config:/app/config:ro
    environment:
      - NODE_ENV=production
      - JIRA_API_TOKEN=${JIRA_API_TOKEN}
      - JIRA_EMAIL=${JIRA_EMAIL}
    restart: unless-stopped
```

### Bundled Plugins

The official image includes these plugins (can be disabled in config):

| Plugin | Description |
|--------|-------------|
| `@agent-detective/local-repos-plugin` | Local repository configuration |
| `@agent-detective/jira-adapter` | Jira webhook integration |

### Installing Third-Party Plugins

Third-party plugins can be installed via volume mount:

```bash
# Assume you have a plugin in ./plugins/my-plugin/
# Structure: ./plugins/my-plugin/index.js

docker run -d \
  -p 3001:3001 \
  -v $(pwd)/plugins:/app/plugins:ro \
  ghcr.io/toniop99/agent-detective:latest
```

Then enable in `config/default.json`:

```json
{
  "plugins": [
    {
      "package": "/app/plugins/my-plugin",
      "options": {
        "enabled": true
      }
    }
  ]
}
```

For more details, see [docs/plugin-development.md](plugin-development.md).

---

## Server Sizing

| Tier | CPU | RAM | Disk | Use Case |
|------|-----|-----|------|----------|
| Minimal | 1 core | 1 GB | 10 GB | Development / testing |
| Recommended | 2 cores | 4 GB | 20 GB | Production workloads |

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/your-org/agent-detective.git
cd agent-detective
pnpm install
```

### 2. Build the Application

```bash
pnpm run build
```

This builds all packages in the monorepo:
- `@agent-detective/types`
- `@agent-detective/local-repos-plugin`
- `@agent-detective/jira-adapter`
- `agent-detective` (main app)

### 3. Configure

Edit `config/default.json` with your settings. See [Configuration Reference](#configuration-reference) below.

### 4. Start the Server

```bash
# Development mode (with hot reload via tsx)
pnpm run dev

# Production mode
pnpm start
```

## Configuration Reference

All configuration is in `config/default.json`:

```json
{
  "port": 3001,
  "agent": "opencode",
  "repoContext": {
    "gitLogMaxCommits": 50
  },
  "plugins": [
    {
      "package": "@agent-detective/local-repos-plugin",
      "options": {
        "repos": [...],
        "techStackDetection": {...},
        "summaryGeneration": {...},
        "validation": {...}
      }
    },
    {
      "package": "@agent-detective/jira-adapter",
      "options": {
        "enabled": true,
        "webhookPath": "/plugins/agent-detective-jira-adapter/webhook/jira",
        "mockMode": true,
        "discovery": {...},
        "discoveryContext": {...},
        "analysis": {...}
      }
    }
  ]
}
```

### Core Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `port` | number | `3001` | HTTP server port |
| `agent` | string | `"opencode"` | Default agent to use |

### repoContext

Settings for repository analysis:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `gitLogMaxCommits` | number | `50` | Max commits to retrieve for context |

> **Note:** `searchPatterns` was removed in v0.2.0.

### local-repos-plugin Options

```json
{
  "repos": [
    {
      "name": "my-project",
      "path": "/path/to/project",
      "description": "Backend principal en Node.js",
      "techStack": ["nodejs", "typescript"]
    }
  ],
  "techStackDetection": {
    "enabled": true,
    "patterns": {
      "nodejs": ["package.json"],
      "python": ["requirements.txt", "pyproject.toml"],
      "java": ["pom.xml", "build.gradle"]
    }
  },
  "summaryGeneration": {
    "enabled": true,
    "source": "both",
    "maxReadmeLines": 3,
    "commitCount": 10
  },
  "validation": {
    "validateOnStartup": true,
    "failOnMissing": false
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `repos` | array | `[]` | List of configured repositories |
| `repos[].name` | string | required | Unique repository identifier |
| `repos[].path` | string | required | Absolute path to repository |
| `repos[].description` | string | - | Human-readable description |
| `repos[].techStack` | string[] | auto-detect | Manual tech stack override |
| `techStackDetection.enabled` | boolean | `true` | Enable auto-detection |
| `summaryGeneration.enabled` | boolean | `true` | Generate repo summaries |
| `summaryGeneration.source` | string | `"both"` | Source for summary: `"readme"`, `"commits"`, or `"both"` |
| `validation.validateOnStartup` | boolean | `true` | Validate paths on server start |
| `validation.failOnMissing` | boolean | `false` | Fail startup if repos missing |

### jira-adapter Options

```json
{
  "enabled": true,
  "webhookPath": "/plugins/agent-detective-jira-adapter/webhook/jira",
  "mockMode": true,
  "webhookBehavior": {
    "defaults": { "action": "ignore" },
    "events": {
      "jira.issue.created": { "action": "analyze" },
      "jira.issue.updated": { "action": "analyze" },
      "jira.issue.acknowledged": { "action": "acknowledge", "acknowledgmentMessage": "Our team is investigating this issue." }
    }
  },
  "discovery": {
    "enabled": true,
    "useAgentForDiscovery": true,
    "directMatchOnly": false,
    "fallbackOnNoMatch": "ask-agent"
  },
  "analysis": {
    "maxCommits": 50
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `webhookPath` | string | `"/plugins/agent-detective-jira-adapter/webhook/jira"` | Webhook endpoint path |
| `mockMode` | boolean | `false` | Use mock Jira client |
| `webhookBehavior.defaults.action` | string | `"ignore"` | Default action for unconfigured events |
| `webhookBehavior.events.*.action` | string | - | Per-event action: `"analyze"`, `"acknowledge"`, `"ignore"` |
| `webhookBehavior.events.*.acknowledgmentMessage` | string | - | Message for `acknowledge` action |
| `discovery.enabled` | boolean | `true` | Enable repo discovery |
| `discovery.useAgentForDiscovery` | boolean | `true` | Use AI for discovery |
| `discovery.directMatchOnly` | boolean | `false` | Skip agent discovery |
| `discovery.fallbackOnNoMatch` | string | `"ask-agent"` | Fallback strategy |
| `analysis.maxCommits` | number | `50` | Max commits for analysis |

## Process Management

### systemd Unit File

Create `/etc/systemd/system/agent-detective.service`:

```ini
[Unit]
Description=Code Detective AI Agent
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

### Setup Commands

```bash
# Create dedicated user
sudo useradd -r -s /usr/sbin/nologin agent-detective

# Create installation directory
sudo mkdir -p /opt/agent-detective
sudo cp -r . /opt/agent-detective
sudo chown -R agent-detective:agent-detective /opt/agent-detective

# Install dependencies and build
cd /opt/agent-detective
sudo -u agent-detective pnpm install
sudo -u agent-detective pnpm run build

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable agent-detective
sudo systemctl start agent-detective
```

### Managing the Service

```bash
# Check status
sudo systemctl status agent-detective

# View logs
sudo journalctl -u agent-detective -f

# Restart
sudo systemctl restart agent-detective

# Stop
sudo systemctl stop agent-detective
```

## Reverse Proxy

### nginx Configuration

For HTTPS + SSE/WebSocket support:

```nginx
server {
    listen 443 ssl;
    server_name agent-detective.example.com;

    ssl_certificate /etc/ssl/certs/example.com.pem;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    # SSE/WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;

    # General proxy settings
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Timeouts for long-running agent sessions
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;

    # Buffering for SSE
    proxy_buffering off;
    chunked_transfer_encoding on;
}
```

## Security

### Firewall

```bash
# Allow SSH and HTTP/HTTPS only
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Webhook Security

For Jira webhooks, verify the webhook secret in your Jira webhook configuration.

### Environment Variables

Sensitive values can be overridden via environment variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port |
| `NODE_ENV` | `development` or `production` |
| `JIRA_API_TOKEN` | Jira API token (override config) |

## Health Checks

### Endpoint

```
GET /health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "plugins": {
    "local-repos-plugin": "loaded",
    "jira-adapter": "loaded"
  }
}
```

### Monitoring with curl

```bash
# Check health
curl http://localhost:3001/health

# Check agent availability
curl http://localhost:3001/agent/list
```

## Log Management

### Log Location

Logs are written to stdout/stderr (captured by systemd journal):

```bash
sudo journalctl -u agent-detective -n 100
```

### Log Levels

The server uses pino logger. Set `LOG_LEVEL` environment variable:

```bash
Environment=LOG_LEVEL=debug
```

## Troubleshooting

### Server Won't Start

```bash
# Check syntax in config
node -e "JSON.parse(require('fs').readFileSync('config/default.json'))"

# Check port availability
sudo lsof -i :3001
```

### Plugin Fails to Load

```bash
# Verify plugin paths exist
ls -la node_modules/@agent-detective/*/dist/

# Check plugin schema validation
pnpm run lint
```

### Jira Webhooks Not Working

1. Verify `mockMode: false` in config
2. Check `baseUrl`, `email`, `apiToken` are set
3. Ensure webhook URL is accessible from internet
4. Check logs: `sudo journalctl -u agent-detective | grep jira`

### Agent Not Responding

1. Verify agent is installed: `which opencode` (or codex, claude, etc.)
2. Check agent availability: `curl http://localhost:3001/agent/list`
3. Check agent logs for errors

### Docker Dev: Agent Not Found

For development with Docker, agents must be installed on the **host machine**, not in the container. The container runs agents via the host's PATH.

```bash
# Verify agents are installed on host
which opencode
which claude

# If not found, install on host
npm install -g opencode
```

### High Memory Usage

Reduce `gitLogMaxCommits` in config to limit repository analysis scope.

### Docker Build Fails

```bash
# Clean Docker build cache
docker builder prune

# Rebuild without cache
docker build --no-cache --target production -t agent-detective:latest .

# Check available disk space
docker system df
```

### Docker: codex Agent Not Available

The `codex` agent is not available in Docker due to its installation method (requires VS Code extension). Use `opencode`, `claude`, or `gemini` instead.

```bash
# Build with available agents
docker build --target production \
  --build-arg AGENTS="opencode,claude,gemini" \
  -t agent-detective:latest .
```
