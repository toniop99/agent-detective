/**
 * Writes JSON Schema (from Zod) and a top-level key table for `appConfigSchema`
 * into `docs/reference/generated/app-config.md`. Run after changing `src/config/schema.ts`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { appConfigSchema } from '../src/config/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'reference', 'generated', 'app-config.md');

const jsonSchema = z.toJSONSchema(appConfigSchema, { target: 'draft-7' }) as Record<string, unknown>;

function summarizeTopLevelType(prop: Record<string, unknown> | undefined): string {
  if (!prop) {
    return '—';
  }
  const t = prop.type;
  if (t === 'array' && prop.items && typeof prop.items === 'object') {
    return 'array';
  }
  if (t === 'object') {
    if (prop.propertyNames) {
      return 'object (string keys; see JSON below)';
    }
    if (prop.additionalProperties && !prop.properties) {
      return 'object (loose; see JSON below)';
    }
    if (prop.properties) {
      return 'object (see JSON below)';
    }
  }
  if (Array.isArray(t)) {
    return t.join(' | ');
  }
  if (typeof t === 'string') {
    return t;
  }
  return 'see JSON below';
}

function topLevelKeyTable(): string {
  const props = jsonSchema.properties;
  if (!props || typeof props !== 'object') {
    return '';
  }
  const keys = Object.keys(props as Record<string, unknown>).sort();
  const rows = keys
    .map((key) => {
      const prop = (props as Record<string, Record<string, unknown>>)[key];
      const summary = summarizeTopLevelType(prop);
      return `| \`${key}\` | ${summary} |`;
    })
    .join('\n');
  return `| Key | Shape (from JSON Schema) |
|-----|---------------------------|
${rows}

`;
}

const body = `---
title: Generated top-level app config (Zod)
description: Zod-generated JSON Schema for the top-level application configuration object.
sidebar:
  order: 1
  badge:
    text: Generated
    variant: note
---

# Generated top-level app config (Zod)

Do not edit by hand. Regenerate with \`pnpm docs:config\`.

Source: \`src/config/schema.ts\` (\`appConfigSchema\` — unknown top-level keys are rejected; see \`additionalProperties\` in the JSON below).

## Top-level keys

${topLevelKeyTable()}## JSON Schema (draft-7)

\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, 'utf8');
// eslint-disable-next-line no-console -- CLI script success output
console.log('Wrote', outPath);
