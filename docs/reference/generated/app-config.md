---
title: Generated top-level app config (Zod)
description: Zod-generated JSON Schema for the top-level application configuration object.
sidebar:
  order: 1
  badge:
    text: Generated
    variant: note
---

# Generated top-level app config (Zod)

Do not edit by hand. Regenerate with `pnpm docs:config`.

Source: `src/config/schema.ts` (`appConfigSchema` — unknown top-level keys are rejected; see `additionalProperties` in the JSON below).

## Top-level keys

| Key | Shape (from JSON Schema) |
|-----|---------------------------|
| `agent` | string |
| `agents` | object (string keys; see JSON below) |
| `docsApiKey` | string |
| `docsAuthRequired` | boolean |
| `observability` | object (string keys; see JSON below) |
| `pluginSystem` | object (see JSON below) |
| `plugins` | array |
| `port` | number |

## JSON Schema (draft-7)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "port": {
      "type": "number"
    },
    "agent": {
      "type": "string"
    },
    "agents": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "defaultModel": {
                "type": "string"
              }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "timeoutMs": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "maxBufferBytes": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              "postFinalGraceMs": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              "forceKillDelayMs": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            },
            "additionalProperties": false
          }
        ]
      }
    },
    "plugins": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "package": {
            "type": "string"
          },
          "options": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          }
        },
        "additionalProperties": false
      }
    },
    "pluginSystem": {
      "type": "object",
      "properties": {
        "failOnContractErrors": {
          "type": "boolean"
        },
        "failOnDependencyErrors": {
          "type": "boolean"
        },
        "failOnPluginLoadErrors": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    },
    "observability": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "docsAuthRequired": {
      "type": "boolean"
    },
    "docsApiKey": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```
