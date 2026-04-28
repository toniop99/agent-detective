---
title: Generated plugin option schemas
description: Zod-generated JSON Schema for all bundled plugin option types.
sidebar:
  order: 2
  badge:
    text: Generated
    variant: note
---

# Generated plugin option schemas

Do not edit by hand. Regenerate with `pnpm docs:plugins`.

Source files:

- `packages/jira-adapter/src/application/options-schema.ts`
- `packages/linear-adapter/src/application/options-schema.ts`
- `packages/local-repos-plugin/src/application/options-schema.ts`
- `packages/pr-pipeline/src/application/options-schema.ts`

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
    "missingLabelsMessage": {
      "type": "string"
    },
    "maxReposPerIssue": {
      "default": 5,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "retryTriggerPhrase": {
      "default": "#agent-detective analyze",
      "type": "string",
      "minLength": 1
    },
    "prTriggerPhrase": {
      "default": "#agent-detective pr",
      "type": "string",
      "minLength": 1
    },
    "jiraUser": {
      "type": "object",
      "properties": {
        "accountId": {
          "type": "string"
        },
        "email": {
          "type": "string"
        }
      },
      "additionalProperties": false
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
          "jira:comment_created": {
            "action": "analyze"
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
              "jira:issue_deleted",
              "jira:comment_created"
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
    },
    "autoAnalysisCooldownMs": {
      "default": 600000,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "missingLabelsReminderCooldownMs": {
      "default": 60000,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "fetchIssueComments": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "enabled",
    "mockMode",
    "analysisReadOnly",
    "maxReposPerIssue",
    "retryTriggerPhrase",
    "prTriggerPhrase",
    "webhookBehavior",
    "autoAnalysisCooldownMs",
    "missingLabelsReminderCooldownMs",
    "fetchIssueComments"
  ],
  "additionalProperties": false
}
```

### @agent-detective/linear-adapter

Anchor: `linear-adapter`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "enabled": {
      "default": false,
      "type": "boolean"
    },
    "mockMode": {
      "default": true,
      "type": "boolean"
    },
    "apiKey": {
      "type": "string"
    },
    "webhookSigningSecret": {
      "type": "string"
    },
    "oauthClientId": {
      "type": "string"
    },
    "oauthClientSecret": {
      "type": "string"
    },
    "oauthRedirectBaseUrl": {
      "type": "string"
    },
    "oauthScopes": {
      "type": "string"
    },
    "oauthActor": {
      "default": "user",
      "type": "string",
      "enum": [
        "user",
        "app"
      ]
    },
    "oauthAppCommentDisplayName": {
      "type": "string"
    },
    "oauthAppCommentDisplayIconUrl": {
      "type": "string"
    },
    "oauthRefreshToken": {
      "type": "string"
    },
    "skipWebhookSignatureVerification": {
      "default": false,
      "type": "boolean"
    },
    "webhookDeliveryDedupWindowMs": {
      "default": 600000,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "webhookBehavior": {
      "default": {
        "defaults": {
          "action": "ignore",
          "acknowledgmentMessage": "Thanks for the update! I will review this issue and provide feedback shortly."
        },
        "events": {
          "linear:Issue:create": {
            "action": "analyze"
          },
          "linear:Comment:create": {
            "action": "analyze"
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
            "type": "string"
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
    },
    "analysisPrompt": {
      "type": "string"
    },
    "analysisReadOnly": {
      "default": true,
      "type": "boolean"
    },
    "missingLabelsMessage": {
      "type": "string"
    },
    "maxReposPerIssue": {
      "default": 5,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "retryTriggerPhrase": {
      "default": "#agent-detective analyze",
      "type": "string",
      "minLength": 1
    },
    "prTriggerPhrase": {
      "default": "#agent-detective pr",
      "type": "string",
      "minLength": 1
    },
    "botActorIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "autoAnalysisCooldownMs": {
      "default": 600000,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "missingLabelsReminderCooldownMs": {
      "default": 60000,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "fetchIssueComments": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "enabled",
    "mockMode",
    "oauthActor",
    "skipWebhookSignatureVerification",
    "webhookDeliveryDedupWindowMs",
    "webhookBehavior",
    "analysisReadOnly",
    "maxReposPerIssue",
    "retryTriggerPhrase",
    "prTriggerPhrase",
    "autoAnalysisCooldownMs",
    "missingLabelsReminderCooldownMs",
    "fetchIssueComments"
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
          },
          "prBaseBranch": {
            "type": "string",
            "minLength": 1
          },
          "prBranchPrefix": {
            "type": "string"
          },
          "vcs": {
            "type": "object",
            "properties": {
              "provider": {
                "type": "string",
                "enum": [
                  "github",
                  "bitbucket"
                ]
              },
              "owner": {
                "type": "string",
                "minLength": 1
              },
              "name": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "provider",
              "owner",
              "name"
            ],
            "additionalProperties": false
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
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "patterns": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "additionalProperties": false
    },
    "summaryGeneration": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "source": {
          "type": "string",
          "enum": [
            "readme",
            "commits",
            "both"
          ]
        },
        "maxReadmeLines": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "commitCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "useAgent": {
          "type": "boolean"
        },
        "agentId": {
          "type": "string"
        },
        "model": {
          "type": "string"
        },
        "summaryPrompt": {
          "type": "string"
        },
        "maxOutputChars": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "object",
      "properties": {
        "failOnMissing": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    },
    "repoContext": {
      "type": "object",
      "properties": {
        "gitLogMaxCommits": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "gitCommandTimeoutMs": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "gitMaxBufferBytes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "diffFromRef": {
          "type": "string",
          "minLength": 1
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "repos"
  ],
  "additionalProperties": false
}
```

### @agent-detective/pr-pipeline

Anchor: `pr-pipeline`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "enabled": {
      "default": true,
      "type": "boolean"
    },
    "prBranchPrefix": {
      "default": "hotfix/",
      "type": "string"
    },
    "prTitleTemplate": {
      "default": "[{{key}}] {{summary}}",
      "type": "string"
    },
    "prDryRun": {
      "default": true,
      "type": "boolean"
    },
    "prAgent": {
      "type": "string",
      "minLength": 1
    },
    "prAgentTimeoutMs": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "prDebug": {
      "default": false,
      "type": "boolean"
    },
    "githubToken": {
      "type": "string",
      "minLength": 1
    },
    "bitbucketToken": {
      "type": "string",
      "minLength": 1
    },
    "bitbucketUsername": {
      "type": "string",
      "minLength": 1
    },
    "bitbucketEmail": {
      "type": "string",
      "minLength": 1
    },
    "bitbucketAppPassword": {
      "type": "string",
      "minLength": 1
    },
    "worktreeSetupCommands": {
      "default": [],
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "prAnalytics": {
      "default": false,
      "type": "boolean"
    },
    "includeIssueComments": {
      "default": true,
      "type": "boolean"
    },
    "triage": {
      "default": {
        "enabled": false,
        "timeoutMs": 60000
      },
      "type": "object",
      "properties": {
        "enabled": {
          "default": false,
          "type": "boolean"
        },
        "agent": {
          "type": "string",
          "minLength": 1
        },
        "model": {
          "type": "string",
          "minLength": 1
        },
        "timeoutMs": {
          "default": 60000,
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "customPrompt": {
          "type": "string"
        }
      },
      "required": [
        "enabled",
        "timeoutMs"
      ],
      "additionalProperties": false
    },
    "images": {
      "default": {
        "enabled": false,
        "maxCount": 5,
        "maxTotalBytes": 10485760
      },
      "type": "object",
      "properties": {
        "enabled": {
          "default": false,
          "type": "boolean"
        },
        "maxCount": {
          "default": 5,
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "maxTotalBytes": {
          "default": 10485760,
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "enabled",
        "maxCount",
        "maxTotalBytes"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "enabled",
    "prBranchPrefix",
    "prTitleTemplate",
    "prDryRun",
    "prDebug",
    "worktreeSetupCommands",
    "prAnalytics",
    "includeIssueComments",
    "triage",
    "images"
  ],
  "additionalProperties": false
}
```


