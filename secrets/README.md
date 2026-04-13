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

## Usage with Docker Compose

```bash
# Create secrets
echo -n "your-api-token" > secrets/jira_api_token.txt
echo -n "bot@example.com" > secrets/jira_email.txt

# Start production stack
docker-compose -f docker-compose.prod.yml up -d
```

## Alternative: Environment Variables

Instead of Docker secrets, you can use environment variables:

```bash
export JIRA_API_TOKEN=your-api-token
export JIRA_EMAIL=bot@example.com

docker-compose -f docker-compose.prod.yml up -d
```

Environment variables take precedence over secrets if both are set.
