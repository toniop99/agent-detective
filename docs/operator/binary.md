---
title: "Native binary"
description: Install and run agent-detective as a single executable (SEA).
sidebar:
  order: 2.5
---

# Native binary

This deployment path downloads a **native executable** from GitHub Releases and runs it directly (no system Node.js or pnpm required).

## Install layout

Recommended layout:

- `/opt/agent-detective/agent-detective` (the executable)
- `/opt/agent-detective/config/default.json` (and optional `config/local.json`)
- `/opt/agent-detective/plugins/` (optional third-party plugins)

## Download

Download the binary from GitHub Releases for your platform (for example `agent-detective-linux-x64`) and place it at `/opt/agent-detective/agent-detective`.

Make it executable:

```bash
chmod +x /opt/agent-detective/agent-detective
```

## Configuration

Configuration is still JSON in `config/` and uses the same merge/override rules as other deployments:

- `config/default.json` (base)
- `config/local.json` (optional overrides)
- environment variable whitelist overrides (see [configuration.md](../config/configuration.md))

To make config resolution deterministic, run with:

```bash
/opt/agent-detective/agent-detective --config-root /opt/agent-detective
```

You can also set `AGENT_DETECTIVE_CONFIG_ROOT=/opt/agent-detective`.

## API docs in the native binary

The native binary build exposes the OpenAPI JSON at:

- `GET /docs/openapi.json`

The interactive `/docs` UI is **disabled** in the native binary build (SEA) because the Scalar Fastify integration expects runtime static assets on disk. Instead:

- `GET /docs` returns a small JSON response pointing you to the OpenAPI endpoint.
- Use `GET /docs/openapi.json` with your preferred OpenAPI viewer (or import it into Postman/Insomnia/etc).

In non-binary deployments (Docker / from-source), the interactive docs UI is available at `/docs`.

## Custom plugins

For third-party plugins, prefer **path-based** plugin entries in `config/default.json`:

```json
{
  "plugins": [
    {
      "package": "./plugins/my-plugin/dist/index.js",
      "options": {}
    }
  ]
}
```

When you pass `--config-root`, relative paths like `./plugins/...` are resolved relative to that root.

## First-party plugins

The native binary **includes first-party plugins** (for example `@agent-detective/local-repos-plugin`, `@agent-detective/jira-adapter`, `@agent-detective/linear-adapter`, `@agent-detective/pr-pipeline`). You still enable/disable them via `config.plugins[]` options (e.g. `enabled: false`), but you do not need `node_modules/` for them when using the native binary.

## Doctor

Before starting the service, validate the host:

```bash
/opt/agent-detective/agent-detective doctor --config-root /opt/agent-detective
```

Use `--json` for machine-readable output.

## validate-config

If you only want to validate the configuration (without checking tools/plugins):

```bash
/opt/agent-detective/agent-detective validate-config --config-root /opt/agent-detective
```

## Verifying signatures (cosign)

Release assets are signed with **Cosign v3** keyless signing. Each binary, checksum file, and SBOM has a matching **`.sigstore.json`** bundle (signature + certificate + transparency metadata).

Install [Cosign v3](https://docs.sigstore.dev/cosign/system_config/installation/) or newer, download the artifact and its bundle from the same release, then verify (example for linux-x64):

```bash
cosign verify-blob agent-detective-linux-x64 \
  --bundle agent-detective-linux-x64.sigstore.json \
  --certificate-identity-regexp 'https://github.com/[^/]+/[^/]+/\.github/workflows/binary\.yml@refs/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Use a broader `--certificate-identity-regexp '.*'` only if you need a quick check and accept a weaker identity binding.

## SBOM

Each release includes a CycloneDX SBOM:

- `sbom-<target>.cdx.json`

This is a dependency inventory that helps with vulnerability scanning and compliance.

## Maintainers: cutting a new release

If you maintain this repository and need to publish new binaries, see [releasing.md](releasing.md).

## Maintainers: building a SEA binary locally

CI pins a concrete **Node 25.x** (see `node-version` in `.github/workflows/binary.yml`) and uses `node --build-sea`. Use the same major locally, or follow the Node 24 flow in the [Single executable applications](https://nodejs.org/api/single-executable-applications.html) docs if you cannot upgrade yet.

## systemd

Create `/etc/systemd/system/agent-detective.service`:

```ini
[Unit]
Description=Agent Detective
After=network.target

[Service]
Type=simple
User=agent-detective
WorkingDirectory=/opt/agent-detective
ExecStart=/opt/agent-detective/agent-detective --config-root /opt/agent-detective
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable agent-detective
sudo systemctl start agent-detective
sudo journalctl -u agent-detective -f
```

