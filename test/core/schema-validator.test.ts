import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validatePluginSchema, validatePluginConfig } from '../../src/core/schema-validator.js';
import type { Plugin } from '../../src/core/types.js';

describe('Schema Validator', () => {
  describe('validatePluginSchema', () => {
    it('accepts valid plugin with minimal interface', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        register: () => {},
      };

      assert.doesNotThrow(() => validatePluginSchema(plugin));
    });

    it('accepts plugin with schema version', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        schemaVersion: '1.0',
        register: () => {},
      };

      assert.doesNotThrow(() => validatePluginSchema(plugin));
    });

    it('rejects plugin without name', () => {
      const plugin = {
        version: '1.0.0',
        register: () => {},
      };

      assert.throws(() => validatePluginSchema(plugin), /must have a name string/);
    });

    it('rejects plugin without version', () => {
      const plugin = {
        name: 'test-plugin',
        register: () => {},
      };

      assert.throws(() => validatePluginSchema(plugin), /must have a version string/);
    });

    it('rejects plugin without register function', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
      };

      assert.throws(() => validatePluginSchema(plugin), /must export a register function/);
    });

    it('rejects plugin with wrong schema version', () => {
      const plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        schemaVersion: '2.0',
        register: () => {},
      };

      assert.throws(() => validatePluginSchema(plugin), /schema version mismatch/);
    });

    it('rejects null', () => {
      assert.throws(() => validatePluginSchema(null), /must export an object/);
    });

    it('rejects non-object', () => {
      assert.throws(() => validatePluginSchema('string'), /must export an object/);
    });
  });

  describe('validatePluginConfig', () => {
    it('returns empty config if no schema defined', () => {
      const plugin = { name: 'test', version: '1.0.0', register: () => {} } as Plugin;
      const result = validatePluginConfig(plugin, undefined);
      assert.deepEqual(result, {});
    });

    it('validates config against schema', () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register: () => {},
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', default: '/webhook' },
            enabled: { type: 'boolean', default: true },
          },
          required: [],
        },
      } as Plugin;

      const result = validatePluginConfig(plugin, { path: '/custom', enabled: false });
      assert.equal(result.path, '/custom');
      assert.equal(result.enabled, false);
    });

    it('uses provided values over defaults', () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register: () => {},
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', default: '/webhook' },
          },
          required: [],
        },
      } as Plugin;

      const result = validatePluginConfig(plugin, { path: '/custom' });
      assert.equal(result.path, '/custom');
    });

    it('rejects missing required fields', () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register: () => {},
        schema: {
          type: 'object',
          properties: {
            token: { type: 'string' },
          },
          required: ['token'],
        },
      } as Plugin;

      assert.throws(() => validatePluginConfig(plugin, {}), /Required field missing: token/);
    });

    it('rejects wrong type for string', () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register: () => {},
        schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: [],
        },
      } as Plugin;

      assert.throws(() => validatePluginConfig(plugin, { value: 123 }), /must be a string/);
    });

    it('rejects wrong type for boolean', () => {
      const plugin = {
        name: 'test',
        version: '1.0.0',
        register: () => {},
        schema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
          },
          required: [],
        },
      } as Plugin;

      assert.throws(() => validatePluginConfig(plugin, { enabled: 'yes' }), /must be a boolean/);
    });
  });
});
