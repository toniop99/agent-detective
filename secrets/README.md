# Secrets Directory

This directory contains sensitive configuration files for production deployment.

## Files

Place your secret files here:

| File | Description |
|------|-------------|
| `jira_api_token.txt` | Jira API token |
| `jira_email.txt` | Jira account email |

## Format

Secret files should contain only the raw value with **no trailing newline**.

```bash
# Correct (no trailing newline)
echo -n "your-secret-value" > jira_api_token.txt

# Incorrect (has trailing newline)
echo "your-secret-value" > jira_api_token.txt
```

## Security

```bash
# Secure the secrets directory
chmod 700 secrets

# Secure the secret files
chmod 600 secrets/*.txt

# Add to .gitignore (already ignored)
echo "secrets/*" >> ../.gitignore
echo "!secrets/.gitkeep" >> ../.gitignore
```

## Wiring secrets into the process

Point the app at this directory or copy values into **`config/local.json`** / env vars the app reads (see [configuration.md](../docs/config/configuration.md)). With **systemd**, you can use **`EnvironmentFile=`** pointing at a root-only file, or **`Environment=`** for individual keys.

```bash
# Create secret files (example: Jira)
echo -n "your-api-token" > secrets/jira_api_token.txt
echo -n "bot@example.com" > secrets/jira_email.txt
chmod 600 secrets/*.txt
```

## Environment variables

You can skip files and export variables instead (same names the Jira adapter expects, e.g. `JIRA_API_TOKEN`, `JIRA_EMAIL`):

```bash
export JIRA_API_TOKEN=your-api-token
export JIRA_EMAIL=bot@example.com
pnpm start
```

Environment variables take precedence over overlapping JSON config when covered by the whitelist in [configuration.md](../docs/config/configuration.md).
