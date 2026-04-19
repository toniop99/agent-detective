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
  requiresCapabilities?: string[];
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
  debug?(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Matches @agent-detective/observability child naming (string or key/value map). */
  child?(component: string | Record<string, string>): Logger;
  setLevel?(level: string): void;
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

export type EnqueueFn = (queueKey: string, fn: () => Promise<void>) => Promise<void>;

/**
 * Pluggable task execution backend. The default implementation serializes work
 * per `queueKey` in memory; plugins may register alternatives (e.g. Redis-backed workers).
 */
export interface TaskQueue {
  enqueue: EnqueueFn;
  /**
   * Called when another queue replaces this one. Use to close connections or drain workers.
   */
  shutdown?: () => void | Promise<void>;
}

export interface PluginContext {
  agentRunner: AgentRunner;
  /** Stable delegate; calls the active {@link TaskQueue} (memory by default, or set via `registerTaskQueue`). */
  enqueue: EnqueueFn;
  config: Record<string, unknown>;
  logger: Logger;
  controllers: object[];
  /**
   * Event bus for inter-plugin communication and task lifecycle.
   */
  events: EventBus;
  /**
   * Register a service that other plugins can consume.
   */
  registerService<T>(name: string, service: T): void;
  /**
   * Get a service registered by another plugin.
   * Throws an error if the service is not found.
   */
  getService<T>(name: string): T;
  /**
   * Register an AI agent.
   */
  registerAgent(agent: Agent): void;
  /**
   * Register a capability provided by this plugin (e.g. 'code-analysis').
   */
  registerCapability(capability: string): void;
  /**
   * Check if a capability has been registered by any loaded plugin.
   */
  hasCapability(capability: string): boolean;
  /**
   * Replace the process-wide task queue. The orchestrator and core API use the same
   * `context.enqueue` delegate, so switching the backend affects all task execution.
   */
  registerTaskQueue(queue: TaskQueue): void;
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
  registerAgent(agent: Agent): void;
  listAgents(): Promise<AgentInfo[]>;
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
  /**
   * Check if the agent's requirements (binaries, API keys) are met.
   */
  checkAvailable?(): boolean | Promise<boolean>;
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

/**
 * Listener for `on` / `off`; may be sync or async for `invokeAsync` collectors.
 * Intentionally permissive so plugins can register `(task: TaskEvent) => ...` without wrappers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventBusHandler = (...args: any[]) => any;

export interface EventBus {
  on(event: string, handler: EventBusHandler): void;
  off(event: string, handler: EventBusHandler): void;
  emit(event: string, ...args: unknown[]): void;
  invokeAsync<T>(event: string, ...args: unknown[]): Promise<T[]>;
}

export const StandardEvents = {
  TASK_CREATED: 'task:created',
  TASK_GATHER_CONTEXT: 'task:gather_context',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
} as const;

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