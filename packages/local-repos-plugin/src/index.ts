import type {
  Plugin,
  BuildRepoContextOptions,
  AgentRunner,
  PluginContext,
  Logger,
  RepoMatcher,
} from '@agent-detective/types';
import { REPO_MATCHER_SERVICE } from '@agent-detective/types';
import type {
  LocalReposPluginOptions,
  ValidatedRepo,
  LocalReposContext,
  LocalReposService,
  TechStackDetectionConfig,
  SummaryGenerationConfig,
} from './types.js';
import { matchRepoByLabels } from './repo-matcher.js';
import { validateRepos, hasValidationErrors } from './validate.js';
import { detectTechStack } from './tech-stack-detector.js';
import { generateSummary } from './summary-generator.js';
import { gitLog } from './repo-context/git-log.js';
import { buildRepoContext, formatRepoContextForPrompt } from './repo-context/index.js';
import { registerController } from '@agent-detective/core';
import { ReposController } from './repos-controller.js';
import { createRepoAnalyzer } from './analyzer.js';
import * as z from 'zod';
import { localReposPluginOptionsSchema } from './options-schema.js';
import { zodToPluginSchema } from './zod-to-plugin-schema.js';

export { localReposPluginOptionsSchema } from './options-schema.js';

const localReposPluginSchema = zodToPluginSchema(localReposPluginOptionsSchema);

type LocalReposPluginContext = PluginContext;

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

const localReposPlugin: Plugin = {
  name: '@agent-detective/local-repos-plugin',
  version: '0.1.0',
  schemaVersion: '1.0',
  schema: localReposPluginSchema,
  dependsOn: [],

  async register(app, context) {
    const extContext = context as LocalReposPluginContext;

    const parsed = localReposPluginOptionsSchema.safeParse(context.config ?? {});
    if (!parsed.success) {
      extContext.logger?.error(`Invalid local-repos-plugin config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
      return;
    }
    const options = parsed.data as LocalReposPluginOptions;

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

    const repoMatcher: RepoMatcher = {
      matchByLabels(labels) {
        const match = matchRepoByLabels(labels, validatedRepos);
        return match ? { name: match.name, path: match.path } : null;
      },
      listConfiguredLabels() {
        return validatedRepos.map((r) => r.name);
      },
    };
    context.registerService<RepoMatcher>(REPO_MATCHER_SERVICE, repoMatcher);

    context.registerCapability('code-analysis');

    const analyzer = createRepoAnalyzer(context, localRepos, localReposService);
    analyzer.start();

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
  LocalReposService,
  TechStackDetectionConfig,
  SummaryGenerationConfig,
};