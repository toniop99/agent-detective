import type { PluginContext, TaskEvent } from '@agent-detective/types';
import { StandardEvents } from '@agent-detective/types';
import type {
  LocalReposContext,
  LocalReposPluginOptions,
  ValidatedRepo,
  LocalReposService,
  TaskInfoForDiscovery,
} from './types.js';
import { findDirectMatch, buildDiscoveryPrompt, parseAgentDiscoveryResponse } from './discovery.js';
import { formatTemplate, getDefaultAnalysisPrompt } from './types.js';

export function createRepoAnalyzer(
  context: PluginContext,
  localRepos: LocalReposContext,
  localReposService: LocalReposService
) {
  const { events, agentRunner, logger, config } = context;
  const options = config as unknown as LocalReposPluginOptions;

  async function handleGatherContext(task: TaskEvent): Promise<string | null> {
    // Only process if metadata indicates it needs code context
    if (task.metadata.requiresCodeContext === false) {
      return null;
    }

    const repos = localRepos.getAllRepos();
    if (repos.length === 0) {
      logger.warn('No repositories available for analysis');
      return null;
    }

    let selectedRepo: ValidatedRepo | null = null;

    // 1. Try to find repo in task context if already provided
    if (task.context.repoPath) {
      selectedRepo = repos.find(r => r.path === task.context.repoPath) || null;
    }

    // 2. Perform Discovery if no repo selected
    if (!selectedRepo) {
      const taskInfo: TaskInfoForDiscovery = {
        id: task.id,
        summary: task.message.split('\n')[0], // Use first line as summary
        description: task.message,
        labels: (task.metadata.labels as string[]) || [],
      };

      const discoveryConfig = options.discovery || {};
      const discoveryContext = options.discoveryContext || {};

      selectedRepo = findDirectMatch(taskInfo.labels, repos);

      if (!selectedRepo && discoveryConfig.enabled !== false && !discoveryConfig.directMatchOnly) {
        const discoveryPrompt = buildDiscoveryPrompt(
          taskInfo,
          repos,
          discoveryConfig,
          discoveryContext
        );

        const discoveryAgentId = discoveryConfig.discoveryAgentId || 'opencode';
        const discoveryModel = discoveryConfig.discoveryModel;

        try {
          const discoveryResponse = await agentRunner.runAgentForChat(
            `discovery-${task.id}`,
            discoveryPrompt,
            { agentId: discoveryAgentId, model: discoveryModel }
          );

          const repoName = parseAgentDiscoveryResponse(discoveryResponse, repos);
          if (repoName) {
            selectedRepo = repos.find((r) => r.name.toLowerCase() === repoName.toLowerCase()) || null;
          }
        } catch (err) {
          logger.error(`Discovery failed for task ${task.id}: ${(err as Error).message}`);
        }
      }
    }

    if (!selectedRepo) {
      return null;
    }

    // Propagate the selected repo to the task context so the orchestrator runs
    // the agent with it as cwd. Without this, the agent is spawned in the
    // agent-detective workspace and has to rediscover the repo from prose,
    // which burns time budget and can trigger the post-final kill timer.
    task.context.repoPath = selectedRepo.path;
    task.context.cwd = selectedRepo.path;

    // 3. Build Repo Context
    try {
      const repoContext = await localReposService.buildRepoContext(selectedRepo.path);
      const formattedContext = localReposService.formatRepoContextForPrompt(repoContext);

      // 4. Return the formatted context string
      // We also include a summary of the task to help the agent
      const analysisPromptTemplate = (task.metadata.analysisPrompt as string) || getDefaultAnalysisPrompt();
      
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
      logger.error(`Analysis context building failed for ${selectedRepo.name}: ${(err as Error).message}`);
      return null;
    }
  }

  return {
    start() {
      events.on(StandardEvents.TASK_GATHER_CONTEXT, handleGatherContext);
      logger.info('Repository analyzer started and listening for tasks');
    }
  };
}
