/**
 * Writes JSON Schema (from Zod) for first-party plugin options into docs/generated/plugin-options.md.
 * Run after changing `options-schema.ts` in a plugin package.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { jiraAdapterOptionsSchema } from '../packages/jira-adapter/src/options-schema.js';
import { localReposPluginOptionsSchema } from '../packages/local-repos-plugin/src/options-schema.js';
import { prPipelineOptionsSchema } from '../packages/pr-pipeline/src/options-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'generated', 'plugin-options.md');

function block(title: string, id: string, schema: Record<string, unknown>): string {
  return `### ${title}\n\nAnchor: \`${id}\`\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\n`;
}

const jira = z.toJSONSchema(jiraAdapterOptionsSchema, { target: 'draft-7' }) as Record<string, unknown>;
const localRepos = z.toJSONSchema(localReposPluginOptionsSchema, {
  target: 'draft-7',
}) as Record<string, unknown>;
const prPipeline = z.toJSONSchema(prPipelineOptionsSchema, { target: 'draft-7' }) as Record<string, unknown>;

const body = `# Generated plugin option schemas

Do not edit by hand. Regenerate with \`pnpm docs:plugins\`.

Source files:

- \`packages/jira-adapter/src/options-schema.ts\`
- \`packages/local-repos-plugin/src/options-schema.ts\`
- \`packages/pr-pipeline/src/options-schema.ts\`

${block('@agent-detective/jira-adapter', 'jira-adapter', jira)}${block(
  '@agent-detective/local-repos-plugin',
  'local-repos-plugin',
  localRepos
)}${block('@agent-detective/pr-pipeline', 'pr-pipeline', prPipeline)}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, 'utf8');
console.log('Wrote', outPath);
