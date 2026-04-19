import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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

export function zodToPluginSchema(z: ZodTypeAny): PluginSchema {
  const j = zodToJsonSchema(z, { $refStrategy: 'none', target: 'jsonSchema7' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const properties: PluginSchema['properties'] = {};
  for (const [key, prop] of Object.entries(j.properties || {})) {
    properties[key] = coerceProperty(prop);
  }
  return { type: 'object', properties, required: j.required };
}
