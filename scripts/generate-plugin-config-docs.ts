/**
 * Writes JSON Schema (from Zod) for first-party plugin options into docs/generated/plugin-options.md.
 * Run after changing `options-schema.ts` in a plugin package.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { jiraAdapterOptionsSchema } from '../packages/jira-adapter/src/options-schema.js';
import { localReposPluginOptionsSchema } from '../packages/local-repos-plugin/src/options-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'generated', 'plugin-options.md');

function block(title: string, id: string, schema: ReturnType<typeof zodToJsonSchema>): string {
  return `### ${title}\n\nAnchor: \`${id}\`\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\n`;
}

const jira = zodToJsonSchema(jiraAdapterOptionsSchema, { $refStrategy: 'none', target: 'jsonSchema7' });
const localRepos = zodToJsonSchema(localReposPluginOptionsSchema, {
  $refStrategy: 'none',
  target: 'jsonSchema7',
});

const body = `# Generated plugin option schemas

Do not edit by hand. Regenerate with \`pnpm docs:plugins\`.

Source files:

- \`packages/jira-adapter/src/options-schema.ts\`
- \`packages/local-repos-plugin/src/options-schema.ts\`

${block('@agent-detective/jira-adapter', 'jira-adapter', jira)}${block(
  '@agent-detective/local-repos-plugin',
  'local-repos-plugin',
  localRepos
)}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, 'utf8');
console.log('Wrote', outPath);
