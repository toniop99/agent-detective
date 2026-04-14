import type { AgentRunner, EnqueueFn } from '@agent-detective/types';
import type { MockJiraClient } from '../mock-jira-client.js';
import type { JiraAdapterConfig, JiraTaskInfo, RepoInfo } from '../types.js';
import { formatTemplate, getDefaultAnalysisPrompt } from '../types.js';
import { findDirectMatch, buildDiscoveryPrompt, parseAgentDiscoveryResponse } from '../discovery.js';

export interface AnalyzeHandlerDeps {
  jiraClient: MockJiraClient;
  config: JiraAdapterConfig;
  agentRunner: AgentRunner;
  enqueue: EnqueueFn;
  getAvailableRepos: () => RepoInfo[];
  buildRepoContext: (repoPath: string, options?: unknown) => Promise<unknown>;
  formatRepoContextForPrompt: (context: unknown) => string;
}

export async function handleAnalyze(
  payload: unknown,
  taskInfo: JiraTaskInfo,
  deps: AnalyzeHandlerDeps
): Promise<void> {
  const {
    jiraClient,
    config,
    agentRunner,
    enqueue,
    getAvailableRepos,
    buildRepoContext,
    formatRepoContextForPrompt,
  } = deps;

  const labels = (payload as { issue?: { fields?: { labels?: string[] } } })?.issue?.fields?.labels || [];

  console.warn(`Jira webhook: ${taskInfo.id} labels: [${labels.join(', ')}]`);

  const queueKey = taskInfo.id;

  enqueue(queueKey, async () => {
    const repos = getAvailableRepos();
    const discoveryConfig = config.discovery || {};
    const discoveryContext = config.discoveryContext || {};

    let selectedRepo = findDirectMatch(labels, repos);

    if (!selectedRepo && !discoveryConfig.directMatchOnly) {
      const discoveryPrompt = buildDiscoveryPrompt(
        taskInfo,
        repos,
        discoveryConfig,
        discoveryContext
      );

      const discoveryAgentId = discoveryConfig.discoveryAgentId || 'opencode';

      const discoveryResponse = await agentRunner.runAgentForChat(
        taskInfo.id,
        discoveryPrompt,
        {
          agentId: discoveryAgentId,
          onFinal: () => {},
        }
      );

      const repoName = parseAgentDiscoveryResponse(discoveryResponse);
      if (repoName) {
        selectedRepo = repos.find((r) => r.name.toLowerCase() === repoName.toLowerCase()) || null;
      }
    }

    if (!selectedRepo) {
      console.warn(`No repo found for task ${taskInfo.id}`);
      await jiraClient.addComment(taskInfo.key, 'Could not determine which repository is related to this issue.');
      return;
    }

    let repoContextText = '';

    try {
      const repoContext = await buildRepoContext(selectedRepo.path, {
        maxCommits: config.analysis?.maxCommits || 50,
      }) as { repoName: string; recentCommits: Array<{ hash: string; message: string }> };

      repoContextText = formatRepoContextForPrompt(repoContext);
    } catch (err) {
      console.warn(`Failed to build repo context: ${(err as Error).message}`);
    }

    const analysisPromptTemplate = config.analysisPrompt || getDefaultAnalysisPrompt();

    const analysisPrompt = formatTemplate(analysisPromptTemplate, {
      task_key: taskInfo.key,
      task_summary: taskInfo.summary,
      task_description: taskInfo.description,
      task_labels: taskInfo.labels.join(', ') || '(no labels)',
      repo_name: selectedRepo.name,
      repo_path: selectedRepo.path,
      repo_tech_stack: selectedRepo.techStack.join(', ') || '(unknown)',
      repo_summary: selectedRepo.summary || '(no summary)',
      repo_commits: repoContextText,
    });

    await agentRunner.runAgentForChat(taskInfo.id, analysisPrompt, {
      contextKey: taskInfo.id,
      repoPath: selectedRepo.path,
      onFinal: async (commentText: string) => {
        await jiraClient.addComment(taskInfo.key, commentText);
        console.warn(`Comment added to ${taskInfo.key}`);
      },
    });
  });
}
