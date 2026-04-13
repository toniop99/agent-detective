import type { Plugin, BuildRepoContextOptions, Commit, AgentRunner } from '@code-detective/types';
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

interface ExtendedContext {
  localRepos?: LocalReposContext;
  buildRepoContext?: (repoPath: string, options?: BuildRepoContextOptions) => ReturnType<typeof buildRepoContext>;
  formatRepoContextForPrompt?: typeof formatRepoContextForPrompt;
  config: Record<string, unknown>;
  agentRunner?: AgentRunner;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

async function processRepos(options: LocalReposPluginOptions, agentRunner?: AgentRunner): Promise<ValidatedRepo[]> {
  const { repos, techStackDetection, summaryGeneration, validation, repoContext } = options;

  const validationResults = validateRepos(repos, validation || {});

  const results: ValidatedRepo[] = [];

  for (const repo of repos) {
    const validationResult = validationResults.find((v) => v.name === repo.name)!;

    let techStack: string[] = [];
    let summary = '';
    let commits: Commit[] = [];

    if (validationResult.exists) {
      techStack = repo.techStack && repo.techStack.length > 0
        ? repo.techStack
        : detectTechStack(repo.path, techStackDetection);

      summary = await generateSummary(repo.path, summaryGeneration || {}, agentRunner);

      commits = await gitLog(repo.path, { maxCommits: repoContext?.gitLogMaxCommits });
    } else {
      techStack = [];
      summary = '';
      commits = [];
    }

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
  }

  return results;
}

const localReposPlugin: Plugin = {
  name: '@code-detective/local-repos-plugin',
  version: '0.1.0',
  dependsOn: [],

  async register(app, context) {
    const extContext = context as unknown as ExtendedContext;
    const options = extContext.config as unknown as LocalReposPluginOptions;

    if (!options.repos || !Array.isArray(options.repos)) {
      extContext.logger?.warn('local-repos-plugin: No repos configured');
      return;
    }

    const validatedRepos = await processRepos(options, extContext.agentRunner);

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

    extContext.localRepos = localRepos;
    extContext.buildRepoContext = (repoPath: string, opts?: BuildRepoContextOptions) => {
      return buildRepoContext(repoPath, {
        ...opts,
        maxCommits: repoContextOptions?.gitLogMaxCommits ?? opts?.maxCommits,
      });
    };
    extContext.formatRepoContextForPrompt = formatRepoContextForPrompt;

    extContext.logger?.info(
      `local-repos-plugin: Loaded ${validatedRepos.length} repos: ${validatedRepos.map((r) => r.name).join(', ')}`
    );

    extContext.logger?.info('local-repos-plugin: Registering HTTP endpoints');

    app.get('/repos', (_req, res) => {
      res.json(localRepos.getAllRepos());
    });

    app.get('/repos/:name', (req, res) => {
      const repo = localRepos.getRepo(req.params.name);
      if (!repo) {
        res.status(404).json({ error: 'Repo not found' });
        return;
      }
      res.json(repo);
    });
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