import { normalizeJiraPayload } from './normalizer.js';
import type { AgentRunner, EnqueueFn } from '@agent-detective/types';
import type { MockJiraClient } from './mock-jira-client.js';
import type { JiraAdapterConfig, JiraTaskInfo, RepoInfo } from './types.js';
import { formatTemplate, getDefaultAnalysisPrompt } from './types.js';
import { findDirectMatch, buildDiscoveryPrompt, parseAgentDiscoveryResponse } from './discovery.js';

interface JiraWebhookHandlerOptions {
  jiraClient: MockJiraClient;
  config: JiraAdapterConfig;
  agentRunner: AgentRunner;
  enqueue: EnqueueFn;
  getAvailableRepos: () => RepoInfo[];
  buildRepoContext: (repoPath: string, options?: unknown) => Promise<unknown>;
  formatRepoContextForPrompt: (context: unknown) => string;
}

export function createJiraWebhookHandler(options: JiraWebhookHandlerOptions) {
  const {
    jiraClient,
    config,
    agentRunner,
    enqueue,
    getAvailableRepos,
    buildRepoContext,
    formatRepoContextForPrompt,
  } = options;

  async function handleWebhook(payload: unknown): Promise<{ status: string; taskId: string }> {
    const taskEvent = normalizeJiraPayload(payload as Parameters<typeof normalizeJiraPayload>[0]);

    const labels: string[] = (payload as { issue?: { fields?: { labels?: string[] } } })?.issue?.fields?.labels || [];
    const projectKey: string = (payload as { issue?: { fields?: { project?: { key?: string } } } })?.issue?.fields?.project?.key || '';

    const taskInfo: JiraTaskInfo = {
      id: taskEvent.id,
      key: projectKey,
      summary: taskEvent.message,
      description: '', 
      labels,
      projectKey,
    };

    console.info(`Jira webhook: ${taskEvent.id} labels: [${labels.join(', ')}]`);

    const queueKey = taskEvent.id;

    enqueue(queueKey, async () => {
      const repos = getAvailableRepos();
      let selectedRepo: RepoInfo | null = null;

      const discoveryConfig = config.discovery || {};
      const discoveryContext = config.discoveryContext || {};

      selectedRepo = findDirectMatch(labels, repos);

      if (!selectedRepo && !discoveryConfig.directMatchOnly) {
        const discoveryPrompt = buildDiscoveryPrompt(
          taskInfo,
          repos,
          discoveryConfig,
          discoveryContext
        );

        const discoveryAgentId = discoveryConfig.discoveryAgentId || 'opencode';

        const discoveryResponse = await agentRunner.runAgentForChat(
          taskEvent.id,
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
        console.warn(`No repo found for task ${taskEvent.id}`);
        await jiraClient.addComment(taskEvent.replyTo.id, 'Could not determine which repository is related to this issue.');
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

      await agentRunner.runAgentForChat(taskEvent.id, analysisPrompt, {
        contextKey: taskEvent.id,
        repoPath: selectedRepo.path,
        onFinal: async (commentText: string) => {
          await jiraClient.addComment(taskEvent.replyTo.id, commentText);
          console.info(`Comment added to ${taskEvent.replyTo.id}`);
        },
      });
    });

    return { status: 'queued', taskId: taskEvent.id };
  }

  return { handleWebhook };
}
