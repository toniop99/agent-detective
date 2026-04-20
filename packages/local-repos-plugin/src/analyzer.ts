import type { PluginContext, TaskEvent } from '@agent-detective/types';
import { StandardEvents } from '@agent-detective/types';
import type {
  LocalReposContext,
  ValidatedRepo,
  LocalReposService,
} from './types.js';
import { formatTemplate, getDefaultAnalysisPrompt } from './types.js';

/**
 * Builds the repository context and final analysis prompt for an incoming
 * `TASK_GATHER_CONTEXT` event. Repository selection is no longer done here —
 * the event source (e.g. the Jira adapter) is expected to have pre-matched
 * labels and set `task.context.repoPath` before emitting `TASK_CREATED`.
 *
 * If `repoPath` is missing or not recognized, this handler returns `null` and
 * contributes nothing to the prompt. There is intentionally no agent-driven
 * fallback — the contract is strict and deterministic.
 */
export function createRepoAnalyzer(
  context: PluginContext,
  localRepos: LocalReposContext,
  localReposService: LocalReposService
) {
  const { events, logger } = context;

  async function handleGatherContext(task: TaskEvent): Promise<string | null> {
    if (task.metadata.requiresCodeContext === false) {
      return null;
    }

    const repoPath = task.context.repoPath;
    if (!repoPath) {
      logger.debug?.(
        `local-repos-plugin: Skipping task ${task.id} — no repoPath set on context (source should pre-match labels).`
      );
      return null;
    }

    const selectedRepo: ValidatedRepo | null =
      localRepos.getAllRepos().find((r) => r.path === repoPath) ?? null;

    if (!selectedRepo) {
      logger.warn(
        `local-repos-plugin: Task ${task.id} has repoPath="${repoPath}" but no configured repo matches that path.`
      );
      return null;
    }

    task.context.cwd = selectedRepo.path;

    try {
      const repoContext = await localReposService.buildRepoContext(selectedRepo.path);
      const formattedContext = localReposService.formatRepoContextForPrompt(repoContext);

      const analysisPromptTemplate =
        (task.metadata.analysisPrompt as string) || getDefaultAnalysisPrompt();

      const variables = {
        task_id: task.id,
        task_summary: task.message.split('\n')[0],
        task_description: task.message,
        task_labels: ((task.metadata.labels as string[]) || []).join(', ') || '(no labels)',
        repo_name: selectedRepo.name,
        repo_path: selectedRepo.path,
        repo_tech_stack: selectedRepo.techStack.join(', '),
        repo_summary: selectedRepo.summary,
        repo_commits: formattedContext,
      };

      return formatTemplate(analysisPromptTemplate, variables);
    } catch (err) {
      logger.error(
        `Analysis context building failed for ${selectedRepo.name}: ${(err as Error).message}`
      );
      return null;
    }
  }

  return {
    start() {
      events.on(StandardEvents.TASK_GATHER_CONTEXT, handleGatherContext);
      logger.info('Repository analyzer started and listening for tasks');
    },
  };
}
