/**
 * Host-only OpenAPI tag identifiers and helpers. Plugins do not import this
 * module; their own tag is their package name and the host owns grouping.
 */

export const CORE_PLUGIN_TAG = '@agent-detective/core';

export const RESERVED_TAGS = {
  CORE: CORE_PLUGIN_TAG,
} as const;

export const SCALAR_TAG_GROUPS = {
  CORE: 'Core',
  PLUGINS: 'Plugins',
} as const;

export function createTagDescription(tag: string): string {
  switch (tag) {
    case CORE_PLUGIN_TAG:
      return 'Core API endpoints';
    default:
      return `${tag} plugin endpoints`;
  }
}
