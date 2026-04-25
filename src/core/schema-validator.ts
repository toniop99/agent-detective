import type { Plugin, PluginSchema } from './types.js';

const SCHEMA_VERSION = '1.0';

export function validatePluginSchema(pluginExport: unknown): true {
  if (!pluginExport || typeof pluginExport !== 'object') {
    throw new Error('Plugin must export an object');
  }

  const plugin = pluginExport as Plugin;

  if (typeof plugin.name !== 'string' || !plugin.name) {
    throw new Error('Plugin must have a name string');
  }

  if (typeof plugin.version !== 'string' || !plugin.version) {
    throw new Error('Plugin must have a version string');
  }

  if (typeof plugin.register !== 'function') {
    throw new Error('Plugin must export a register function');
  }

  if (!plugin.schemaVersion) {
    throw new Error(`Plugin must declare schemaVersion: '${SCHEMA_VERSION}'`);
  }

  if (plugin.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Plugin schema version mismatch: expected ${SCHEMA_VERSION}, got ${plugin.schemaVersion}`);
  }

  return true;
}

export function validatePluginConfig(pluginExport: Plugin, config: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!pluginExport.schema) {
    return config || {};
  }

  const schema: PluginSchema = pluginExport.schema;
  const errors: string[] = [];

  if (schema.required) {
    for (const field of schema.required) {
      if (config?.[field] === undefined) {
        errors.push(`Required field missing: ${field}`);
      }
    }
  }

  if (schema.properties && config) {
    for (const [key, value] of Object.entries(config)) {
      if (!schema.properties[key]) {
        continue;
      }
      const propSchema = schema.properties[key];

      if (propSchema.type === 'string' && typeof value !== 'string') {
        errors.push(`${key} must be a string`);
      }
      if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
        errors.push(`${key} must be a boolean`);
      }
      if (propSchema.type === 'number' && typeof value !== 'number') {
        errors.push(`${key} must be a number`);
      }
      if (propSchema.type === 'array' && !Array.isArray(value)) {
        errors.push(`${key} must be an array`);
      }
      if (propSchema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        errors.push(`${key} must be an object`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid plugin config: ${errors.join(', ')}`);
  }

  return config || {};
}
