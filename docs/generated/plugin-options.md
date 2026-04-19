# Generated plugin option schemas

Do not edit by hand. Regenerate with `pnpm docs:plugins`.

Source files:

- `packages/jira-adapter/src/options-schema.ts`
- `packages/local-repos-plugin/src/options-schema.ts`

### @agent-detective/jira-adapter

Anchor: `jira-adapter`

```json
{
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "default": true
    },
    "webhookPath": {
      "type": "string",
      "default": "/plugins/agent-detective-jira-adapter/webhook/jira"
    },
    "mockMode": {
      "type": "boolean",
      "default": true
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
    "webhookBehavior": {
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
          },
          "propertyNames": {
            "enum": [
              "jira:issue_created",
              "jira:issue_updated",
              "jira:issue_deleted"
            ]
          }
        }
      },
      "required": [
        "defaults"
      ],
      "additionalProperties": false,
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
      }
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### @agent-detective/local-repos-plugin

Anchor: `local-repos-plugin`

```json
{
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
      "additionalProperties": {}
    },
    "summaryGeneration": {
      "type": "object",
      "additionalProperties": {}
    },
    "validation": {
      "type": "object",
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
      "additionalProperties": {}
    },
    "discoveryContext": {
      "type": "object",
      "additionalProperties": {}
    }
  },
  "required": [
    "repos"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```


