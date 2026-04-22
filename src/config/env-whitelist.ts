import type { AppConfig } from './schema.js';

const JIRA_PACKAGE = '@agent-detective/jira-adapter';
const LOCAL_REPOS_PACKAGE = '@agent-detective/local-repos-plugin';
const PR_PIPELINE_PACKAGE = '@agent-detective/pr-pipeline';

function getExistingPluginOptions(
  config: AppConfig,
  packageName: string
): Record<string, unknown> | null {
  if (!Array.isArray(config.plugins)) {
    return null;
  }
  const entry = config.plugins.find((p) => p.package === packageName);
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

  const agentModelEnvVars = ['AGENTS_OPENCODE_MODEL', 'AGENTS_CLAUDE_MODEL', 'AGENTS_GEMINI_MODEL'] as const;
  for (const envVar of agentModelEnvVars) {
    const raw = process.env[envVar];
    if (!raw) continue;
    const agentId = envVar.replace('AGENTS_', '').replace('_MODEL', '').toLowerCase();
    if (agentId === 'runner') continue;
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents[agentId]) {
      config.agents[agentId] = { defaultModel: raw };
    } else {
      (config.agents[agentId] as { defaultModel?: string }).defaultModel = raw;
    }
  }

  // Optional: any AGENTS_<id>_MODEL where <id> is uppercase letters/digits
  for (const [key, value] of Object.entries(process.env)) {
    const m = /^AGENTS_([A-Z0-9]+)_MODEL$/.exec(key);
    if (!m || !value) continue;
    const agentId = m[1]!.toLowerCase();
    if (agentId === 'runner') continue;
    if (agentModelEnvVars.includes(key as (typeof agentModelEnvVars)[number])) continue;
    if (!config.agents) {
      config.agents = {};
    }
    if (!config.agents[agentId]) {
      config.agents[agentId] = { defaultModel: value };
    } else {
      (config.agents[agentId] as { defaultModel?: string }).defaultModel = value;
    }
  }

  if (process.env.DOCS_AUTH_REQUIRED === 'true' || process.env.DOCS_AUTH_REQUIRED === 'false') {
    config.docsAuthRequired = process.env.DOCS_AUTH_REQUIRED === 'true';
  }
  if (process.env.DOCS_API_KEY) {
    config.docsApiKey = process.env.DOCS_API_KEY;
  }

  const parseMs = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw === '') return undefined;
    const n = parseInt(raw, 10);
    return !Number.isNaN(n) && n >= 0 ? n : undefined;
  };
  const parseBytes = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw === '') return undefined;
    const n = parseInt(raw, 10);
    return !Number.isNaN(n) && n > 0 ? n : undefined;
  };

  const t = parseMs(process.env.AGENTS_RUNNER_TIMEOUT_MS);
  const buf = parseBytes(process.env.AGENTS_RUNNER_MAX_BUFFER_BYTES);
  const grace = parseMs(process.env.AGENTS_RUNNER_POST_FINAL_GRACE_MS);
  const forceKill = parseMs(process.env.AGENTS_RUNNER_FORCE_KILL_DELAY_MS);
  if (t !== undefined || buf !== undefined || grace !== undefined || forceKill !== undefined) {
    if (!config.agents) {
      config.agents = {};
    }
    const runnerPath = 'runner' as const;
    if (!config.agents[runnerPath]) {
      (config.agents as Record<string, unknown>)[runnerPath] = {};
    }
    const runner = config.agents[runnerPath] as Record<string, number | undefined>;
    if (t !== undefined) runner.timeoutMs = t;
    if (buf !== undefined) runner.maxBufferBytes = buf;
    if (grace !== undefined) runner.postFinalGraceMs = grace;
    if (forceKill !== undefined) runner.forceKillDelayMs = forceKill;
  }

  const obsExclude = process.env.OBSERVABILITY_REQUEST_LOGGER_EXCLUDE_PATHS;
  if (obsExclude !== undefined && obsExclude !== '') {
    if (!config.observability) {
      config.observability = {};
    }
    const obs = config.observability as Record<string, unknown>;
    if (!obs.requestLogger) {
      obs.requestLogger = {};
    }
    (obs.requestLogger as { excludePaths: string[] }).excludePaths = obsExclude
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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

  const gitTimeout = process.env.REPO_CONTEXT_GIT_COMMAND_TIMEOUT_MS;
  if (gitTimeout !== undefined && gitTimeout !== '') {
    const n = parseInt(gitTimeout, 10);
    if (!Number.isNaN(n) && n > 0) {
      const opts = getExistingPluginOptions(config, LOCAL_REPOS_PACKAGE);
      if (opts) {
        setNested(opts, ['repoContext', 'gitCommandTimeoutMs'], n);
      }
    }
  }

  const gitMaxBuf = process.env.REPO_CONTEXT_GIT_MAX_BUFFER_BYTES;
  if (gitMaxBuf !== undefined && gitMaxBuf !== '') {
    const n = parseInt(gitMaxBuf, 10);
    if (!Number.isNaN(n) && n > 0) {
      const opts = getExistingPluginOptions(config, LOCAL_REPOS_PACKAGE);
      if (opts) {
        setNested(opts, ['repoContext', 'gitMaxBufferBytes'], n);
      }
    }
  }

  const diffFromRef = process.env.REPO_CONTEXT_DIFF_FROM_REF;
  if (diffFromRef && diffFromRef.trim()) {
    const opts = getExistingPluginOptions(config, LOCAL_REPOS_PACKAGE);
    if (opts) {
      setNested(opts, ['repoContext', 'diffFromRef'], diffFromRef.trim());
    }
  }

  const maxOut = process.env.SUMMARY_MAX_OUTPUT_CHARS;
  if (maxOut !== undefined && maxOut !== '') {
    const n = parseInt(maxOut, 10);
    if (!Number.isNaN(n) && n > 0) {
      const opts = getExistingPluginOptions(config, LOCAL_REPOS_PACKAGE);
      if (opts) {
        setNested(opts, ['summaryGeneration', 'maxOutputChars'], n);
      }
    }
  }

  const jiraAutoCd = process.env.JIRA_AUTO_ANALYSIS_COOLDOWN_MS;
  if (jiraAutoCd !== undefined && jiraAutoCd !== '') {
    const n = parseInt(jiraAutoCd, 10);
    if (!Number.isNaN(n) && n >= 0) {
      const opts = getExistingPluginOptions(config, JIRA_PACKAGE);
      if (opts) {
        opts.autoAnalysisCooldownMs = n;
      }
    }
  }

  const jiraRemCd = process.env.JIRA_MISSING_LABELS_REMINDER_COOLDOWN_MS;
  if (jiraRemCd !== undefined && jiraRemCd !== '') {
    const n = parseInt(jiraRemCd, 10);
    if (!Number.isNaN(n) && n >= 0) {
      const opts = getExistingPluginOptions(config, JIRA_PACKAGE);
      if (opts) {
        opts.missingLabelsReminderCooldownMs = n;
      }
    }
  }

  const prPipelineOpts = getExistingPluginOptions(config, PR_PIPELINE_PACKAGE);
  if (prPipelineOpts) {
    if (process.env.GITHUB_TOKEN) {
      prPipelineOpts.githubToken = process.env.GITHUB_TOKEN;
    } else if (process.env.GH_TOKEN) {
      prPipelineOpts.githubToken = process.env.GH_TOKEN;
    }
    if (process.env.BITBUCKET_TOKEN) {
      prPipelineOpts.bitbucketToken = process.env.BITBUCKET_TOKEN;
    }
    if (process.env.BITBUCKET_USERNAME) {
      prPipelineOpts.bitbucketUsername = process.env.BITBUCKET_USERNAME;
    }
    if (process.env.BITBUCKET_APP_PASSWORD) {
      prPipelineOpts.bitbucketAppPassword = process.env.BITBUCKET_APP_PASSWORD;
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
