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
