# Generated plugin option schemas

Do not edit by hand. Regenerate with `pnpm docs:plugins`.

Source files:

- `packages/jira-adapter/src/options-schema.ts`
- `packages/local-repos-plugin/src/options-schema.ts`

### @agent-detective/jira-adapter

Anchor: `jira-adapter`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "enabled": {
      "default": true,
      "type": "boolean"
    },
    "webhookPath": {
      "default": "/plugins/agent-detective-jira-adapter/webhook/jira",
      "type": "string"
    },
    "mockMode": {
      "default": true,
      "type": "boolean"
    },
    "baseUrl": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "apiToken": {
      "type": "string"
    },
    "analysisPrompt": {
      "type": "string"
    },
    "analysisReadOnly": {
      "default": true,
      "type": "boolean"
    },
    "webhookBehavior": {
      "default": {
        "defaults": {
          "action": "ignore",
          "acknowledgmentMessage": "Thanks for the update! I will review this issue and provide feedback shortly."
        },
        "events": {
          "jira:issue_created": {
            "action": "analyze"
          },
          "jira:issue_updated": {
            "action": "acknowledge"
          }
        }
      },
      "type": "object",
      "properties": {
        "defaults": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "analyze",
                "acknowledge",
                "ignore"
              ]
            },
            "analysisPrompt": {
              "type": "string"
            },
            "acknowledgmentMessage": {
              "type": "string"
            }
          },
          "required": [
            "action"
          ],
          "additionalProperties": false
        },
        "events": {
          "type": "object",
          "propertyNames": {
            "type": "string",
            "enum": [
              "jira:issue_created",
              "jira:issue_updated",
              "jira:issue_deleted"
            ]
          },
          "additionalProperties": {
            "type": "object",
            "properties": {
              "action": {
                "type": "string",
                "enum": [
                  "analyze",
                  "acknowledge",
                  "ignore"
                ]
              },
              "analysisPrompt": {
                "type": "string"
              },
              "acknowledgmentMessage": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        }
      },
      "required": [
        "defaults"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "enabled",
    "webhookPath",
    "mockMode",
    "analysisReadOnly",
    "webhookBehavior"
  ],
  "additionalProperties": false
}
```

### @agent-detective/local-repos-plugin

Anchor: `local-repos-plugin`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "repos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "techStack": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "name",
          "path"
        ],
        "additionalProperties": false
      }
    },
    "techStackDetection": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "summaryGeneration": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "validation": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "repoContext": {
      "type": "object",
      "properties": {
        "gitLogMaxCommits": {
          "type": "number"
        }
      },
      "additionalProperties": false
    },
    "discovery": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "discoveryContext": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    }
  },
  "required": [
    "repos"
  ],
  "additionalProperties": false
}
```


