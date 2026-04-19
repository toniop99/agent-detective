import * as z from 'zod';
import type { PluginSchema, PluginSchemaProperty } from '@agent-detective/types';

function coerceProperty(raw: Record<string, unknown>): PluginSchemaProperty {
  const typ = raw.type;
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const def = raw.default;

  if (typ === 'string' || typ === 'boolean' || typ === 'number') {
    return { type: typ, default: def, description };
  }
  if (typ === 'integer') {
    return { type: 'number', default: def, description };
  }
  if (typ === 'array') {
    return { type: 'array', default: def, description };
  }
  return { type: 'object', default: def, description };
}

/** Convert a Zod object schema to the simplified `PluginSchema` shape used by the core validator. */
export function zodToPluginSchema(schema: z.ZodType): PluginSchema {
  const j = z.toJSONSchema(schema, { target: 'draft-7' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const properties: PluginSchema['properties'] = {};
  for (const [key, prop] of Object.entries(j.properties || {})) {
    properties[key] = coerceProperty(prop);
  }
  return { type: 'object', properties, required: j.required };
}
