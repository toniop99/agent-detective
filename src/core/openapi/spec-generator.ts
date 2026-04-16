import type { OperationMetadata, ResponseMetadata } from '@agent-detective/core';
import { getControllerMetadata, getControllerRoutes } from '@agent-detective/core';
import { CORE_PLUGIN_TAG, createTagDescription, SCALAR_TAG_GROUPS } from './constants.js';

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, PathOperation>>;
  tags: Tag[];
  servers?: { url: string; description?: string }[];
  'x-tagGroups'?: TagGroup[];
}

export interface PathOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  security?: string[];
  requestBody?: RequestBodySpec;
  responses?: Record<string, ResponseSpec>;
  parameters?: ParameterSpec[];
  [key: string]: unknown;
}

export interface RequestBodySpec {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeSpec>;
}

export interface MediaTypeSpec {
  schema?: Record<string, unknown>;
  example?: unknown;
}

export interface ResponseSpec {
  description: string;
  content?: Record<string, MediaTypeSpec>;
}

export interface ParameterSpec {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

export interface Tag {
  name: string;
  description?: string;
}

export interface TagGroup {
  name: string;
  tags: string[];
}

function convertResponses(responsesMap: Map<number, ResponseMetadata> | undefined): Record<string, ResponseSpec> {
  if (!responsesMap) return {};

  const result: Record<string, ResponseSpec> = {};
  responsesMap.forEach((resp, statusCode) => {
    const content: Record<string, MediaTypeSpec> = {};
    if (resp.contentType || resp.example || resp.schema) {
      content[resp.contentType || 'application/json'] = {
        schema: resp.schema,
        example: resp.example,
      };
    }
    result[String(statusCode)] = {
      description: resp.description,
      ...(Object.keys(content).length > 0 ? { content } : {}),
    };
  });
  return result;
}

function inferSchemaFromType(_type: unknown): Record<string, unknown> {
  return { type: 'object' };
}

export function generateSpecFromControllers(
  controllers: (new () => object)[],
  baseInfo?: { title?: string; version?: string; description?: string }
): OpenAPISpec {
  const paths: Record<string, Record<string, PathOperation>> = {};
  const tags: Tag[] = [];
  const tagSet = new Set<string>();

  for (const controller of controllers) {
    const ctrlMeta = getControllerMetadata(controller);
    if (!ctrlMeta) continue;

    if (ctrlMeta.tags) {
      for (const tag of ctrlMeta.tags) {
        if (!tagSet.has(tag)) {
          tagSet.add(tag);
          tags.push({ name: tag, description: ctrlMeta.description || createTagDescription(tag) });
        }
      }
    }

    const routes = getControllerRoutes(controller);
    for (const route of routes) {
      const fullPath = `${ctrlMeta.prefix}${route.path}`;
      const operationMeta = route.operationMetadata;

      const operation: PathOperation = {
        summary: operationMeta?.summary,
        description: operationMeta?.description,
        tags: operationMeta?.tags || ctrlMeta.tags,
        operationId: operationMeta?.operationId,
        deprecated: operationMeta?.deprecated,
        security: operationMeta?.security,
        responses: convertResponses(operationMeta?.responses),
      };

      if (operationMeta?.requestBody) {
        operation.requestBody = {
          description: operationMeta.requestBody.description,
          required: operationMeta.requestBody.required,
          content: {
            [operationMeta.requestBody.contentType || 'application/json']: {
              schema: operationMeta.requestBody.schema || inferSchemaFromType(undefined),
              example: operationMeta.requestBody.example,
            },
          },
        };
      }

      if (!paths[fullPath]) paths[fullPath] = {};
      paths[fullPath][route.method] = operation;
    }
  }

  const coreTagExists = tagSet.has(CORE_PLUGIN_TAG);
  if (!coreTagExists) {
    tags.unshift({ name: CORE_PLUGIN_TAG, description: createTagDescription(CORE_PLUGIN_TAG) });
  }

  const tagGroups: TagGroup[] = [
    { name: SCALAR_TAG_GROUPS.CORE, tags: [CORE_PLUGIN_TAG] },
    { name: SCALAR_TAG_GROUPS.PLUGINS, tags: tags.filter(t => t.name !== CORE_PLUGIN_TAG).map(t => t.name) },
  ];

  return {
    openapi: '3.0.0',
    info: {
      title: baseInfo?.title || 'Agent Detective API',
      version: baseInfo?.version || '1.0.0',
      description: baseInfo?.description || 'API documentation for agent-detective and its plugins',
    },
    paths,
    tags,
    servers: [{ url: '/', description: 'Current server' }],
    'x-tagGroups': tagGroups,
  };
}

export function generateSpecFromRoutes(
  routes: Array<{
    method: string;
    path: string;
    prefixedPath: string;
    pluginName: string;
    operationMetadata?: OperationMetadata;
  }>
): OpenAPISpec {
  const paths: Record<string, Record<string, PathOperation>> = {};
  const tags: Tag[] = [];
  const tagSet = new Set<string>();

  for (const route of routes) {
    const openAPIPath = route.prefixedPath.replace(/:([^/]+)/g, '{$1}');

    if (!paths[openAPIPath]) paths[openAPIPath] = {};

    const tagsToUse = [route.pluginName];
    for (const tag of tagsToUse) {
      if (!tagSet.has(tag)) {
        tagSet.add(tag);
        tags.push({ name: tag, description: createTagDescription(tag) });
      }
    }

    const operation: PathOperation = {
      summary: route.operationMetadata?.summary || `Route: ${route.method.toUpperCase()} ${route.path}`,
      description: route.operationMetadata?.description || `Auto-generated from ${route.method.toUpperCase()} ${route.path}`,
      tags: tagsToUse,
      operationId: route.operationMetadata?.operationId,
      deprecated: route.operationMetadata?.deprecated,
      security: route.operationMetadata?.security,
      responses: convertResponses(route.operationMetadata?.responses),
    };

    if (route.operationMetadata?.requestBody) {
      operation.requestBody = {
        description: route.operationMetadata.requestBody.description,
        required: route.operationMetadata.requestBody.required,
        content: {
          [route.operationMetadata.requestBody.contentType || 'application/json']: {
            schema: route.operationMetadata.requestBody.schema || inferSchemaFromType(undefined),
            example: route.operationMetadata.requestBody.example,
          },
        },
      };
    }

    paths[openAPIPath][route.method.toLowerCase()] = operation;
  }

  const tagGroups: TagGroup[] = [
    { name: SCALAR_TAG_GROUPS.CORE, tags: [CORE_PLUGIN_TAG] },
    { name: SCALAR_TAG_GROUPS.PLUGINS, tags: tags.filter(t => t.name !== CORE_PLUGIN_TAG).map(t => t.name) },
  ];

  return {
    openapi: '3.0.0',
    info: {
      title: 'Agent Detective API',
      version: '1.0.0',
      description: 'API documentation for agent-detective and its plugins',
    },
    paths,
    tags,
    servers: [{ url: '/', description: 'Current server' }],
    'x-tagGroups': tagGroups,
  };
}