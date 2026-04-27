import type { ChildProcess } from 'node:child_process';
export type { ChildProcess } from 'node:child_process';

export type {
  HttpMethod,
  RouteSchema,
  RouteDefinition,
  FastifyScope,
  FastifyRequest,
  FastifyReply,
  TagGroup,
  ApplyTagGroupsOptions,
} from './http.js';

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
  schemaVersion: '1.0';
  schema?: PluginSchema;
  dependsOn?: string[];
  requiresCapabilities?: string[];
  /**
   * Called once per plugin during boot. Receives an encapsulated Fastify
   * scope (already prefixed under `/plugins/{sanitized-name}`) and the
   * shared {@link PluginContext}. Register routes via
   * `registerRoutes(scope, [...])` from `@agent-detective/sdk`, or call
   * `scope.route(...)` / `scope.get(...)` directly. Plugins may register
   * Fastify hooks (`onRequest`, `preHandler`, `setErrorHandler`) on this
   * scope; encapsulation keeps them isolated from other plugins.
   *
   * Breaking change vs the pre-2026-04 API: previously took
   * `(app: Express.Application, ctx)` and could return controller
   * instances; now Fastify-native, returns `void`.
   */
  register(scope: import('fastify').FastifyInstance, context: PluginContext): Promise<void> | void;
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
  /** When set, git subcommands log warnings through this instead of the console. */
  logger?: Pick<Logger, 'warn' | 'error'>;
  gitCommandTimeoutMs?: number;
  gitMaxBufferBytes?: number;
  /** `from` ref for `git diff` when that command is used (default `HEAD~5`). */
  diffFromRef?: string;
}

export interface Commit {
  hash: string;
  message: string;
  author?: string;
  email?: string;
  date?: string;
}

/**
 * Local repository plugin port types (registered at runtime via
 * {@link PluginContext.registerService}; consumers use {@link PluginContext.getService}).
 * @see ADR 0001 — shared contracts live in this package, not via compile-time imports between plugins.
 */

/** VCS for opening pull requests (see pr-pipeline plugin). */
export type RepoVcsProvider = 'github' | 'bitbucket';

export interface RepoVcsConfig {
  provider: RepoVcsProvider;
  /** For GitHub: `owner` + `name`; for Bitbucket Cloud: use `owner` = workspace, `name` = repo slug. */
  owner: string;
  name: string;
}

export interface RepoConfig {
  name: string;
  path: string;
  description?: string;
  techStack?: string[];
  /** Base ref for the PR (e.g. `main`, `develop`). */
  prBaseBranch?: string;
  /** Per-repo override; falls back to pr-pipeline default (e.g. `hotfix/`). */
  prBranchPrefix?: string;
  vcs?: RepoVcsConfig;
}

export interface ValidatedRepo {
  name: string;
  path: string;
  exists: boolean;
  description?: string;
  techStack: string[];
  summary: string;
  commits: Commit[];
  lastChecked: Date;
}

export interface LocalReposContext {
  repos: ValidatedRepo[];
  getRepo(name: string): ValidatedRepo | null;
  getAllRepos(): ValidatedRepo[];
}

export interface LocalReposService {
  localRepos: LocalReposContext;
  buildRepoContext: (repoPath: string, options?: BuildRepoContextOptions) => Promise<unknown>;
  formatRepoContextForPrompt: (context: unknown) => string;
  /** Raw `repos[]` entry from plugin config (path, vcs, pr settings). */
  getSourceRepoConfig(name: string): RepoConfig | undefined;
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
  /** Register a callback to run during graceful shutdown (e.g. worktree cleanup). */
  onShutdown(fn: () => void | Promise<void>): void;
}

export interface RunAgentOptions {
  contextKey?: string;
  repoPath?: string | null;
  cwd?: string;
  agentId?: string;
  model?: string;
  onProgress?: (messages: string[]) => void;
  onFinal?: (text: string) => void | Promise<void>;
  /** Called with each raw stdout chunk from the agent subprocess. */
  onStdout?: (chunk: string) => void;
  /**
   * Override the process-wide agent subprocess timeout (ms) for this run.
   * When omitted, `agents.runner.timeoutMs` from app config applies.
   */
  timeoutMs?: number;
  /**
   * When true, the agent is instructed (via CLI flags / env vars that the
   * specific agent adapter knows how to emit) to disable write/edit/shell
   * tools. Used for investigation-only workflows such as Jira incident
   * analysis, where the agent must never modify the target repository.
   */
  readOnly?: boolean;
  /**
   * Conversation / session id for CLIs that support resume (opencode, claude, cursor, etc.).
   */
  threadId?: string;
  /**
   * Absolute paths to image files to pass to the agent. Only adapters that
   * support multimodal input (e.g. claude via `--input-file`) will use these;
   * others silently ignore the field.
   */
  inputFiles?: string[];
}

export interface StopRunResult {
  status: 'idle' | 'stopping';
}

export interface AgentRunner {
  runAgentForChat(taskId: string, prompt: string, options?: RunAgentOptions): Promise<AgentOutput>;
  stopActiveRun(taskId: string, contextKey?: string): Promise<StopRunResult>;
  registerAgent(agent: Agent): void;
  listAgents(): Promise<AgentInfo[]>;
  /** Terminate all active agent child processes (called on app shutdown). */
  shutdown(): void;
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

/** A single repository known to the matcher, identified by display name and on-disk path. */
export interface MatchedRepo {
  name: string;
  path: string;
}

/**
 * Minimal, source-agnostic interface for resolving an issue's labels to a
 * configured repository. Implemented today by the local-repos plugin; any
 * future source (remote git host, service catalog, etc.) can register an
 * alternate implementation under the same service name.
 */
export interface RepoMatcher {
  /**
   * Case-insensitive match of incoming labels against configured repos.
   * Returns the first configured repo whose `name` matches any label, or
   * `null` if none match.
   *
   * Prefer {@link matchAllByLabels} when the caller wants to fan out to
   * every repo an issue touches; this single-match method is kept for
   * callers that still need the "primary" semantics.
   */
  matchByLabels(labels: string[]): MatchedRepo | null;
  /**
   * Case-insensitive match of incoming labels against **all** configured
   * repos. Returns every configured repo whose `name` matches any of the
   * supplied labels, deduplicated, in a deterministic order (configuration
   * order — not label order — so the output is stable regardless of how
   * the user wrote the labels on the issue).
   *
   * Returns an empty array if nothing matches.
   */
  matchAllByLabels(labels: string[]): MatchedRepo[];
  /**
   * Repo names the user can add as labels to resolve an unmatched issue,
   * ordered for user-facing display.
   */
  listConfiguredLabels(): string[];
}

export interface BuildCommandOptions {
  prompt: string;
  promptExpression: string;
  threadId?: string;
  model?: string;
  thinking?: string;
  /**
   * Hint to the agent adapter to emit a command that disables write/edit/shell
   * tools (e.g. a stricter opencode permission set). The adapter is free to
   * ignore this flag if it cannot enforce read-only mode.
   */
  readOnly?: boolean;
  /** Absolute paths to image files to pass as `--input-file` args (adapter-dependent). */
  inputFiles?: string[];
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
  wallTimeMs?: number;
}

export interface AgentOutput {
  text: string;
  threadId?: string;
  sawJson: boolean;
  usage?: AgentUsage;
}

export interface StreamingOutput extends AgentOutput {
  sawFinal: boolean;
  commentaryMessages: string[];
}

export interface Agent {
  id: string;
  label: string;
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
  /**
   * When `true`, the runner guarantees that at most one invocation of this
   * agent is in-flight at a time, globally across all tasks. Used for agent
   * CLIs that can't handle concurrent instances (e.g. opencode keeps a
   * single-user SQLite DB under `~/.local/share/opencode/` and crashes on
   * `PRAGMA journal_mode = WAL` when a second process races the first —
   * see https://github.com/anomalyco/opencode/issues/21215).
   *
   * This serializes runs at the agent-process level *only*; it does NOT
   * serialize task queuing (the orchestrator still queues per task id) and
   * it does NOT affect other agents running in parallel.
   */
  singleInstance?: boolean;
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

/** Minimal Jira client surface for posting follow-up comments from the PR module. */
export interface PrJiraClient {
  addComment(issueIdOrKey: string, body: string, options?: { parentId?: string }): Promise<void>;
  downloadAttachment(attachmentId: string): Promise<Buffer>;
}

/**
 * What the Jira handler passes to {@link PrWorkflowService.startPrWorkflow}. The
 * service should enqueue and run git + agent + host API asynchronously.
 */
export interface PrWorkflowInput {
  issueKey: string;
  issueSummary: string;
  taskDescription: string;
  projectKey: string;
  labels: string[];
  match: { name: string; path: string };
  jira: PrJiraClient;
  /** Merged with PR-specific instructions for the write-capable agent. */
  analysisPrompt?: string;
  /**
   * Text from the Jira **comment** with the `prTriggerPhrase` removed (whitespace
   * normalized), so operators can add hints after `#agent-detective pr ...`.
   */
  prCommentContext?: string;
  /**
   * Human-authored comments from the Jira ticket (app-authored excluded, oldest
   * first), pre-formatted as `[timestamp] Author:\n<body>` strings. Populated
   * by the jira-adapter when `fetchIssueComments` is enabled.
   */
  issueComments?: string[];
  /** Jira comment ID of the triggering `#agent-detective pr` comment, used as parentId for threaded replies. */
  triggerCommentId?: string;
  /** Image attachments from the Jira issue (image/* mimeType only), available for download. */
  imageAttachments?: Array<{ id: string; filename: string; mimeType: string; size: number }>;
}

export interface PrWorkflowService {
  startPrWorkflow(input: PrWorkflowInput): void | Promise<void>;
}

export interface AgentRunRequest {
  agentId: string;
  prompt: string;
  options?: {
    model?: string;
    repoPath?: string | null;
    cwd?: string;
    threadId?: string;
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