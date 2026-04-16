import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunner, Logger } from '@agent-detective/types';
import type { SummaryGenerationConfig } from './types.js';
import { execLocal } from '@agent-detective/process-utils';

const DEFAULT_CONFIG: SummaryGenerationConfig = {
  enabled: true,
  source: 'both',
  maxReadmeLines: 3,
  commitCount: 10,
  useAgent: false,
  agentId: 'opencode',
  summaryPrompt: 'Summarize this repository in 2-3 sentences based on the provided context.',
};

export async function generateSummary(
  repoPath: string,
  config: SummaryGenerationConfig = DEFAULT_CONFIG,
  agentRunner?: AgentRunner,
  logger?: Logger
): Promise<string> {
  if (config.enabled === false) {
    return '';
  }

  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };

  if (resolvedConfig.useAgent && agentRunner) {
    try {
      return await generateSummaryWithAgent(repoPath, resolvedConfig, agentRunner);
    } catch (err) {
      logger?.warn(`Agent summary failed for ${repoPath}, falling back to pattern-based: ${(err as Error).message}`);
    }
  }

  switch (resolvedConfig.source) {
    case 'readme':
      return generateFromReadme(repoPath, resolvedConfig.maxReadmeLines || 3);
    case 'commits':
      return generateFromCommits(repoPath, resolvedConfig.commitCount || 10);
    case 'both':
    default: {
      const readmeSummary = await generateFromReadme(repoPath, resolvedConfig.maxReadmeLines || 3);
      if (readmeSummary) {
        return readmeSummary;
      }
      return generateFromCommits(repoPath, resolvedConfig.commitCount || 10);
    }
  }
}

async function generateSummaryWithAgent(
  repoPath: string,
  config: SummaryGenerationConfig,
  agentRunner: AgentRunner
): Promise<string> {
  const prompt = config.summaryPrompt || DEFAULT_CONFIG.summaryPrompt;
  const taskId = `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const response = await agentRunner.runAgentForChat(taskId, `${prompt}\n\nRepository path: ${repoPath}`, {
    agentId: config.agentId,
    model: config.model,
    repoPath,
    cwd: repoPath,
  });

  return response.trim().slice(0, 500);
}

async function generateFromReadme(repoPath: string, maxLines: number): Promise<string> {
  const readmePaths = [
    join(repoPath, 'README.md'),
    join(repoPath, 'README.txt'),
    join(repoPath, 'README'),
  ];

  for (const readmePath of readmePaths) {
    if (existsSync(readmePath)) {
      try {
        const content = readFileSync(readmePath, 'utf8');
        const lines = content.split('\n').filter((line: string) => line.trim() !== '');
        const firstLines = lines.slice(0, maxLines);
        return firstLines.join(' ').trim().slice(0, 500);
      } catch {
        // Continue to next readme
      }
    }
  }

  return '';
}

async function generateFromCommits(repoPath: string, commitCount: number): Promise<string> {
  try {
    const output = await execLocal('bash', [
      '-lc',
      `git log --oneline -n ${commitCount} --format="%s"`,
    ], {
      cwd: repoPath,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });

    const lines = output.split('\n').filter((l: string) => l.trim());
    if (lines.length === 0) {
      return '';
    }

    const commitSummary = lines.slice(0, 5).join('. ');
    return `Recent commits: ${commitSummary}`.slice(0, 500);
  } catch {
    return '';
  }
}

export async function generateQuickSummary(repoPath: string): Promise<string> {
  return generateFromReadme(repoPath, 2);
}
