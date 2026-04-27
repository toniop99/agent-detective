import type { OpenAPI } from 'openapi-types';
import type { ApplyTagGroupsOptions, TagGroup } from '@agent-detective/types';
import { CORE_PLUGIN_TAG, SCALAR_TAG_GROUPS, createTagDescription } from './tags.js';

/**
 * Mutates a Fastify-generated OpenAPI document to:
 * - Ensure the core tag exists with a stable description.
 * - Ensure every plugin tag has a description (Scalar shows it in the sidebar).
 * - Add the Scalar `x-tagGroups` extension so the docs UI shows
 *   "Core" and "Plugins" as collapsible groups.
 *
 * Call from `@fastify/swagger`'s `transformObject` hook so the grouping
 * runs after every plugin's routes have contributed their tags.
 */
export function applyTagGroups(
  spec: OpenAPI.Document,
  options: ApplyTagGroupsOptions = {},
): OpenAPI.Document {
  const doc = spec as OpenAPI.Document & {
    tags?: Array<{ name: string; description?: string }>;
    'x-tagGroups'?: TagGroup[];
  };

  doc.tags = doc.tags ?? [];
  const byName = new Map(doc.tags.map((t) => [t.name, t]));

  const ensureTag = (name: string) => {
    const existing = byName.get(name);
    const desc = options.descriptions?.[name] ?? createTagDescription(name);
    if (!existing) {
      const tag = { name, description: desc };
      doc.tags!.push(tag);
      byName.set(name, tag);
    } else if (!existing.description) {
      existing.description = desc;
    }
  };

  ensureTag(CORE_PLUGIN_TAG);

  const pluginTags =
    options.pluginTags ??
    [...byName.keys()].filter((n) => n !== CORE_PLUGIN_TAG);

  for (const name of pluginTags) ensureTag(name);

  doc['x-tagGroups'] = [
    { name: SCALAR_TAG_GROUPS.CORE, tags: [CORE_PLUGIN_TAG] },
    { name: SCALAR_TAG_GROUPS.PLUGINS, tags: pluginTags },
  ];

  return doc;
}
