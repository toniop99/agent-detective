import type { AppConfig } from './schema.js';

const JIRA_PACKAGE = '@agent-detective/jira-adapter';
const LOCAL_REPOS_PACKAGE = '@agent-detective/local-repos-plugin';

function getExistingPluginOptions(
  config: AppConfig,
  packageName: string
): Record<string, unknown> | null {
  const entry = config.plugins?.find((p) => p.package === packageName);
  if (!entry) return null;
  if (!entry.options) {
    entry.options = {};
  }
  return entry.options as Record<string, unknown>;
}

function setNested(options: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = options;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    const next = cur[k];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

/**
 * Map `process.env` into `config` for core app and first-party plugins (explicit whitelist only).
 */
export function applyCoreEnvWhitelist(config: AppConfig): void {
  if (process.env.PORT) {
    const n = parseInt(process.env.PORT, 10);
    if (!Number.isNaN(n)) {
      config.port = n;
    }
  }
  if (process.env.AGENT) {
    config.agent = process.env.AGENT;
  }
  if (process.env.MODEL) {
    config.model = process.env.MODEL;
  }

  const agentModelEnvVars = ['AGENTS_OPENCODE_MODEL', 'AGENTS_CLAUDE_MODEL', 'AGENTS_GEMINI_MODEL'] as const;
  for (const envVar of agentModelEnvVars) {
    const raw = process.env[envVar];
    if (!raw) continue;
    const agentId = envVar.replace('AGENTS_', '').replace('_MODEL', '').toLowerCase();
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents[agentId]) {
      config.agents[agentId] = {};
    }
    config.agents[agentId].defaultModel = raw;
  }

  // Optional: any AGENTS_<id>_MODEL where <id> is uppercase letters/digits
  for (const [key, value] of Object.entries(process.env)) {
    const m = /^AGENTS_([A-Z0-9]+)_MODEL$/.exec(key);
    if (!m || !value) continue;
    const agentId = m[1]!.toLowerCase();
    if (agentModelEnvVars.includes(key as (typeof agentModelEnvVars)[number])) continue;
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents[agentId]) {
      config.agents[agentId] = {};
    }
    config.agents[agentId].defaultModel = value;
  }

  if (process.env.DOCS_AUTH_REQUIRED === 'true' || process.env.DOCS_AUTH_REQUIRED === 'false') {
    config.docsAuthRequired = process.env.DOCS_AUTH_REQUIRED === 'true';
  }
  if (process.env.DOCS_API_KEY) {
    config.docsApiKey = process.env.DOCS_API_KEY;
  }
}

/**
 * Merge Jira / local-repos credentials and tuning from env into existing plugin entries (or create Jira entry when creds are set).
 */
export function applyPluginEnvWhitelist(config: AppConfig): void {
  const jiraToken = process.env.JIRA_API_TOKEN;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraBase = process.env.JIRA_BASE_URL;
  if (jiraToken || jiraEmail || jiraBase) {
    const opts = getExistingPluginOptions(config, JIRA_PACKAGE);
    if (opts) {
      if (jiraToken) opts.apiToken = jiraToken;
      if (jiraEmail) opts.email = jiraEmail;
      if (jiraBase) opts.baseUrl = jiraBase;
    }
  }

  const maxCommitsRaw = process.env.REPO_CONTEXT_GIT_LOG_MAX_COMMITS;
  if (maxCommitsRaw !== undefined && maxCommitsRaw !== '') {
    const n = parseInt(maxCommitsRaw, 10);
    if (!Number.isNaN(n) && n > 0) {
      const opts = getExistingPluginOptions(config, LOCAL_REPOS_PACKAGE);
      if (opts) {
        setNested(opts, ['repoContext', 'gitLogMaxCommits'], n);
      }
    }
  }
}

/**
 * If `LOG_LEVEL` is set and `OBSERVABILITY_LOG_LEVEL` is not, mirror it for @agent-detective/observability.
 */
export function applyLogLevelAliasForObservability(): void {
  const log = process.env.LOG_LEVEL;
  if (!log || process.env.OBSERVABILITY_LOG_LEVEL) return;
  if (['debug', 'info', 'warn', 'error'].includes(log)) {
    process.env.OBSERVABILITY_LOG_LEVEL = log;
  }
}
