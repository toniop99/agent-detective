import type { ChildProcess } from 'node:child_process';
export type { ChildProcess } from 'node:child_process';

export interface TaskEvent {
  id: string;
  type: 'incident' | 'question' | 'command';
  source: string;
  message: string;
  context: TaskContext;
  replyTo: ReplyTarget;
  metadata: Record<string, unknown>;
}

export interface TaskContext {
  repoPath: string | null;
  threadId: string | null;
  cwd: string;
  model?: string;
}

export interface ReplyTarget {
  type: 'issue' | 'channel' | 'user';
  id: string;
}

export interface PluginSchemaProperty {
  type: 'string' | 'boolean' | 'number' | 'array' | 'object';
  default?: unknown;
  description?: string;
}

export interface PluginSchema {
  type: 'object';
  properties: Record<string, PluginSchemaProperty>;
  required?: string[];
}

export interface Plugin {
  name: string;
  version: string;
  schemaVersion?: '1.0';
  schema?: PluginSchema;
  dependsOn?: string[];
  register(app: import('express').Application, context: PluginContext): Promise<object[] | void> | object[] | void;
}

export interface PathOperation {
  summary?: string;
  description?: string;
  responses?: Record<string, { description: string; content?: Record<string, unknown> }>;
  parameters?: unknown[];
  [key: string]: unknown;
}

export interface LoadedPlugin {
  name: string;
  version: string;
  config: Record<string, unknown>;
  dependsOn: string[];
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child?(metadata: Record<string, unknown>): Logger;
}

export interface BuildRepoContextOptions {
  maxCommits?: number;
}

export interface Commit {
  hash: string;
  message: string;
  author?: string;
  email?: string;
  date?: string;
}

export interface RepoContext {
  repoName: string;
  repoPath: string;
  recentCommits: Commit[];
  stats: {
    commitCount: number;
  };
}

export interface PluginContext {
  agentRunner: AgentRunner;
  repoMapping?: RepoMapping;
  buildRepoContext?: (repoPath: string, options?: BuildRepoContextOptions) => Promise<RepoContext>;
  formatRepoContextForPrompt?: (context: RepoContext) => string;
  enqueue?: EnqueueFn;
  config: Record<string, unknown>;
  logger: Logger;
  controllers: object[];
  plugins: Record<string, Record<string, unknown>>;
}

export interface RunAgentOptions {
  contextKey?: string;
  repoPath?: string | null;
  cwd?: string;
  agentId?: string;
  model?: string;
  onProgress?: (messages: string[]) => void;
  onFinal?: (text: string) => void | Promise<void>;
}

export interface StopRunResult {
  status: 'idle' | 'stopping';
}

export interface AgentRunner {
  runAgentForChat(taskId: string, prompt: string, options?: RunAgentOptions): Promise<string>;
  stopActiveRun(taskId: string, contextKey?: string): Promise<StopRunResult>;
}

export interface ResolveRepoOptions {
  labels?: string[];
  projectKey?: string;
  projectName?: string;
}

export interface RepoMappingEntry {
  labels?: string[];
  projectKey?: string;
  repoPath: string;
}

export interface RepoMapping {
  resolveRepoFromMapping(options: ResolveRepoOptions): string | null;
  resolveProjectFromName(projectName: string): string | null;
}

export interface RepoMappingConfig {
  mappings: RepoMappingEntry[];
  projects?: Record<string, string>;
  default?: {
    repoPath: string;
  };
}

export interface BuildCommandOptions {
  prompt: string;
  promptExpression: string;
  threadId?: string;
  model?: string;
  thinking?: string;
}

export interface AgentOutput {
  text: string;
  threadId?: string;
  sawJson: boolean;
}

export interface StreamingOutput extends AgentOutput {
  sawFinal: boolean;
  commentaryMessages: string[];
}

export interface Agent {
  id: string;
  label: string;
  backend?: 'app-server';
  needsPty?: boolean;
  mergeStderr?: boolean;
  command?: string;
  buildCommand?(opts: BuildCommandOptions): string;
  parseOutput?(output: string): AgentOutput;
  parseStreamingOutput?(output: string): StreamingOutput;
  listModelsCommand?(): string;
  parseModelList?(output: string): string;
  listSessionsCommand?(): string;
  parseSessionList?(output: string): string | undefined;
  defaultModel?: string;
}

export interface ExecLocalOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  [key: string]: unknown;
}

export interface ExecLocalStreamingOptions extends ExecLocalOptions {
  onSpawn?: (child: ChildProcess) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ProcessUtils {
  shellQuote(value: string): string;
  wrapCommandWithPty(command: string): string;
  terminateChildProcess(child: ChildProcess, signal?: string): void;
  execLocal(cmd: string, args: string[], options?: ExecLocalOptions): Promise<string>;
  execLocalStreaming(cmd: string, args: string[], options?: ExecLocalStreamingOptions): Promise<string>;
}

export type EnqueueFn = (queueKey: string, fn: () => Promise<void>) => Promise<void>;

export interface AgentRunRequest {
  agentId: string;
  prompt: string;
  options?: {
    model?: string;
    repoPath?: string | null;
    cwd?: string;
  };
}

export interface AgentRunResponse {
  taskId: string;
  output: string;
  sawJson: boolean;
  threadId?: string;
}

export interface AgentProgressEvent {
  type: 'progress' | 'final';
  content: string;
}

export interface AgentInfo {
  id: string;
  label: string;
  defaultModel?: string;
  available: boolean;
  needsPty?: boolean;
  mergeStderr?: boolean;
}