import type { Plugin, PluginContext } from '@agent-detective/types';
import { PR_WORKFLOW_SERVICE, type PrWorkflowService } from '@agent-detective/types';
import type { LocalReposService } from '@agent-detective/local-repos-plugin';
import * as z from 'zod';
import { zodToPluginSchema } from '@agent-detective/core';
import { prPipelineOptionsSchema } from './options-schema.js';
import { runPrWorkflow } from './run-pr-workflow.js';

// registerService is not exported from core for plugin - use context.registerService
const schema = zodToPluginSchema(prPipelineOptionsSchema);
const PLUGIN = '@agent-detective/pr-pipeline' as const;

const prPipelinePlugin: Plugin = {
  name: PLUGIN,
  version: '0.1.0',
  schemaVersion: '1.0',
  schema,
  dependsOn: ['@agent-detective/local-repos-plugin', '@agent-detective/jira-adapter'],

  register(_app, context) {
    const ctx = context as PluginContext;
    const log = ctx.logger;
    const parsed = prPipelineOptionsSchema.safeParse(ctx.config ?? {});
    if (!parsed.success) {
      log?.error(`Invalid pr-pipeline config: ${JSON.stringify(z.treeifyError(parsed.error))}`);
      return;
    }
    const options = parsed.data;
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
    log?.info('pr-pipeline: registered; Jira #agent-detective pr comments can use this service');
    return [];
  },
};

export default prPipelinePlugin;
export { prPipelineOptionsSchema } from './options-schema.js';
