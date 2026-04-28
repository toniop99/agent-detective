/**
 * Plugin-facing runtime constants: service-registry keys and standard event
 * names. Re-exported from `@agent-detective/sdk` so plugin authors get them
 * from the same package as `defineRoute` / `registerRoutes`.
 *
 * The matching TypeScript contracts (`RepoMatcher`, `PrWorkflowService`,
 * `TaskEvent`, ...) live in `@agent-detective/types` and are re-exported
 * from this package's entrypoint.
 */

/**
 * Service-registry key under which the bundled `local-repos-plugin`
 * registers a `RepoMatcher`. Use with `context.getService<RepoMatcher>(...)`.
 */
export const REPO_MATCHER_SERVICE = 'repo-matcher';

/**
 * Service-registry key under which `@agent-detective/pr-pipeline` registers
 * its `PrWorkflowService`. Use with `context.getService<PrWorkflowService>(...)`.
 */
export const PR_WORKFLOW_SERVICE = 'pr-workflow' as const;

/**
 * Service-registry key for a standardized repo-context provider.
 *
 * Providers should also register `StandardCapabilities.REPO_CONTEXT`.
 */
export const REPO_CONTEXT_SERVICE = 'repo-context-service' as const;

/**
 * Service-registry key for a standardized code-analysis provider.
 *
 * Providers should also register `StandardCapabilities.CODE_ANALYSIS`.
 */
export const CODE_ANALYSIS_SERVICE = 'code-analysis-service' as const;

/**
 * Standard event names emitted on `context.events`. Plugins listen with
 * `context.events.on(StandardEvents.TASK_CREATED, handler)` and emit with
 * `context.events.emit(StandardEvents.TASK_GATHER_CONTEXT, ...)`.
 */
export const StandardEvents = {
  TASK_CREATED: 'task:created',
  TASK_GATHER_CONTEXT: 'task:gather_context',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
} as const;

/**
 * Standardized capability names. Prefer these over ad-hoc strings so plugins
 * can reliably declare and check features across the ecosystem.
 *
 * Third-party plugins should use stable, namespaced capability strings
 * (e.g. `acme.example/repo-matching`) if they need custom capabilities.
 */
export const StandardCapabilities = {
  /**
   * The host can build and format repository context for prompts.
   * Today this is provided by the bundled `@agent-detective/local-repos-plugin`.
   */
  REPO_CONTEXT: 'repo-context',
  /**
   * The host can perform repo-context based code analysis for a resolved repo.
   * Today this is provided by the bundled `@agent-detective/local-repos-plugin`.
   */
  CODE_ANALYSIS: 'code-analysis',
} as const;
