import {
  definePlugin,
  zodToPluginSchema,
  PR_WORKFLOW_SERVICE,
  type PluginContext,
  type LocalReposService,
  type PrWorkflowService,
} from '@agent-detective/sdk';
import * as z from 'zod';
import { prPipelineOptionsSchema } from './application/options-schema.js';
import { runPrWorkflow, cleanupWorktrees } from './application/run-pr-workflow.js';

const schema = zodToPluginSchema(prPipelineOptionsSchema);
const PLUGIN = '@agent-detective/pr-pipeline' as const;

const prPipelinePlugin = definePlugin({
  name: PLUGIN,
  version: '0.1.0',
  schemaVersion: '1.0',
  schema,
  dependsOn: ['@agent-detective/local-repos-plugin'],

  register(_scope, context) {
    const ctx = context as PluginContext;
    const log = ctx.logger;
    const parsed = prPipelineOptionsSchema.safeParse(ctx.config ?? {});
    if (!parsed.success) {
      log?.error(`Invalid pr-pipeline config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
      return;
    }
    const options = parsed.data;
    if (!options.enabled) {
      log?.info(`Plugin ${PLUGIN} is disabled`);
      return;
    }

    const localRepos = ctx.getService<LocalReposService>('@agent-detective/local-repos-plugin');

    const service: PrWorkflowService = {
      startPrWorkflow: (input) => {
        void ctx.enqueue(`pr:${input.issueKey}:${input.match.name}`, () =>
          runPrWorkflow(input, {
            localRepos,
            agentRunner: ctx.agentRunner,
            options,
            logger: log ?? { info: () => {}, warn: () => {}, error: () => {} },
          })
        );
      },
    };

    ctx.registerService(PR_WORKFLOW_SERVICE, service);
    ctx.onShutdown(() => cleanupWorktrees(log ?? console));
    log?.info('pr-pipeline: registered; Jira #agent-detective pr comments can use this service');
  },
});

export default prPipelinePlugin;
export { prPipelineOptionsSchema } from './application/options-schema.js';
export { cleanupWorktrees } from './application/run-pr-workflow.js';
