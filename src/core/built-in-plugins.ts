import type { Plugin } from './types.js';

import jiraAdapter from '@agent-detective/jira-adapter';
import linearAdapter from '@agent-detective/linear-adapter';
import localRepos from '@agent-detective/local-repos-plugin';
import prPipeline from '@agent-detective/pr-pipeline';

function normalizeModule(mod: unknown): Plugin {
  const m = mod as { default?: unknown };
  return ((m && typeof m === 'object' && 'default' in m ? m.default : m) ?? mod) as Plugin;
}

const builtIns: Record<string, Plugin> = {
  '@agent-detective/local-repos-plugin': normalizeModule(localRepos),
  '@agent-detective/jira-adapter': normalizeModule(jiraAdapter),
  '@agent-detective/linear-adapter': normalizeModule(linearAdapter),
  '@agent-detective/pr-pipeline': normalizeModule(prPipeline),
};

export function getBuiltInPlugin(spec: string): Plugin | null {
  return builtIns[spec] ?? null;
}

