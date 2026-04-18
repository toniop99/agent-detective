import type { Plugin, BuildRepoContextOptions, AgentRunner, PluginContext, PluginSchema, Logger } from '@agent-detective/types';
import type {
  LocalReposPluginOptions,
  ValidatedRepo,
  LocalReposContext,
  TechStackDetectionConfig,
  SummaryGenerationConfig,
} from './types.js';
import { validateRepos, hasValidationErrors } from './validate.js';
import { detectTechStack } from './tech-stack-detector.js';
import { generateSummary } from './summary-generator.js';
import { gitLog } from './repo-context/git-log.js';
import { buildRepoContext, formatRepoContextForPrompt } from './repo-context/index.js';
import { registerController } from '@agent-detective/core';
import { ReposController } from './repos-controller.js';

const localReposPluginSchema: PluginSchema = {
  type: 'object',
  properties: {
    repos: {
      type: 'array',
      description: 'Array of repository configurations (each with name, path, description, techStack)',
    },
    techStackDetection: {
      type: 'object',
      description: 'Configuration for technology stack detection (enabled, patterns)',
    },
    summaryGeneration: {
      type: 'object',
      description: 'Configuration for repository summary generation (enabled, source, maxReadmeLines, commitCount, useAgent, agentId, model, summaryPrompt)',
    },
    validation: {
      type: 'object',
      description: 'Configuration for repository validation (validateOnStartup, failOnMissing)',
    },
    repoContext: {
      type: 'object',
      description: 'Configuration for repository context generation (gitLogMaxCommits)',
    },
  },
  required: ['repos'],
};

type LocalReposPluginContext = PluginContext;

// Config is cast through unknown since PluginContext.config is generic (Record<string, unknown>).
// The plugin schema validation ensures the config matches LocalReposPluginOptions at runtime.
function asLocalReposConfig(context: PluginContext): LocalReposPluginOptions {
  return context.config as unknown as LocalReposPluginOptions;
}

async function processRepos(options: LocalReposPluginOptions, agentRunner?: AgentRunner, logger?: Logger): Promise<ValidatedRepo[]> {
  const { repos, techStackDetection, summaryGeneration, validation, repoContext } = options;

  const validationResults = validateRepos(repos, validation || {});

  const results: ValidatedRepo[] = [];

  for (const repo of repos) {
    const validationResult = validationResults.find((v) => v.name === repo.name)!;

    if (validationResult.exists) {
      const techStack = repo.techStack && repo.techStack.length > 0
        ? repo.techStack
        : detectTechStack(repo.path, techStackDetection);

      const summary = await generateSummary(repo.path, summaryGeneration || {}, agentRunner, logger);

      const commits = await gitLog(repo.path, { maxCommits: repoContext?.gitLogMaxCommits });

      results.push({
        name: repo.name,
        path: repo.path,
        exists: validationResult.exists,
        description: repo.description,
        techStack,
        summary,
        commits,
        lastChecked: new Date(),
      });
    } else {
      results.push({
        name: repo.name,
        path: repo.path,
        exists: validationResult.exists,
        description: repo.description,
        techStack: [],
        summary: '',
        commits: [],
        lastChecked: new Date(),
      });
    }
  }

  return results;
}

export interface LocalReposService {
  localRepos: LocalReposContext;
  buildRepoContext: (repoPath: string, options?: any) => Promise<unknown>;
  formatRepoContextForPrompt: (context: unknown) => string;
}

const localReposPlugin: Plugin = {
  name: '@agent-detective/local-repos-plugin',
  version: '0.1.0',
  schemaVersion: '1.0',
  schema: localReposPluginSchema,
  dependsOn: [],

  async register(app, context) {
    const extContext = context as LocalReposPluginContext;
    const options = asLocalReposConfig(context);

    if (!options.repos || !Array.isArray(options.repos)) {
      extContext.logger?.warn('local-repos-plugin: No repos configured');
      return;
    }

    const validatedRepos = await processRepos(options, extContext.agentRunner, extContext.logger);

    if (options.validation?.failOnMissing) {
      const validationResults = validateRepos(options.repos, options.validation || {});
      if (hasValidationErrors(validationResults)) {
        extContext.logger?.error('local-repos-plugin: Repository validation failed (failOnMissing=true)');
        throw new Error('local-repos-plugin: One or more repository paths do not exist');
      }
    }

    const repoContextOptions = options.repoContext;

    const localRepos: LocalReposContext = {
      repos: validatedRepos,
      getRepo(name: string) {
        return validatedRepos.find((r) => r.name === name) ?? null;
      },
      getAllRepos() {
        return [...validatedRepos];
      },
    };

    const localReposService: LocalReposService = {
      localRepos,
      buildRepoContext: (repoPath: string, opts?: BuildRepoContextOptions) => {
        return buildRepoContext(repoPath, {
          ...opts,
          maxCommits: repoContextOptions?.gitLogMaxCommits ?? opts?.maxCommits,
        });
      },
      formatRepoContextForPrompt: formatRepoContextForPrompt as (context: unknown) => string,
    };

    context.registerService<LocalReposService>('@agent-detective/local-repos-plugin', localReposService);

    extContext.logger?.info(
      `local-repos-plugin: Loaded ${validatedRepos.length} repos: ${validatedRepos.map((r) => r.name).join(', ')}`
    );

    extContext.logger?.info('local-repos-plugin: Registering HTTP endpoints');

    const reposController = new ReposController(localRepos);
    registerController(app, reposController);

    return [reposController];
  },
};

export default localReposPlugin;

export type {
  LocalReposPluginOptions,
  ValidatedRepo,
  LocalReposContext,
  TechStackDetectionConfig,
  SummaryGenerationConfig,
};