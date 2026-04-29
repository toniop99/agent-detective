import { z } from 'zod';
import type { JiraWebhookBehavior } from '../domain/types.js';

export const DEFAULT_WEBHOOK_BEHAVIOR: JiraWebhookBehavior = {
  defaults: {
    action: 'ignore',
    acknowledgmentMessage: 'Thanks for the update! I will review this issue and provide feedback shortly.',
  },
  events: {
    'jira:issue_created': { action: 'analyze' },
    // `analyze` on `jira:comment_created` is the manual retry mechanism:
    // if the initial create had no matching label, the adapter posts a
    // reminder asking for a label + a trigger comment. When the user later
    // comments with `retryTriggerPhrase` in it, the matcher runs again
    // against the ticket's current labels.
    'jira:comment_created': { action: 'analyze' },
  },
};

const jiraWebhookEventTypeSchema = z.enum([
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
  'jira:comment_created',
]);

const jiraEventConfigSchema = z.object({
  action: z.enum(['analyze', 'acknowledge', 'ignore']),
  analysisPrompt: z.string().optional(),
  acknowledgmentMessage: z.string().optional(),
});

const jiraWebhookBehaviorSchema = z.object({
  defaults: jiraEventConfigSchema,
  events: z.partialRecord(jiraWebhookEventTypeSchema, jiraEventConfigSchema.partial()).optional(),
});

/** Zod schema for Jira adapter plugin options (single source of truth for validation and docs). */
export const jiraAdapterOptionsSchema = z
  .object({
    enabled: z.boolean().default(true),
    mockMode: z.boolean().default(true),
    baseUrl: z.string().optional(),
    email: z.string().optional(),
    apiToken: z.string().optional(),
    /**
     * OAuth 2.0 (3LO) Client ID from the Atlassian developer console.
     * When set together with `oauthClientSecret` and `oauthRefreshToken`,
     * the adapter uses OAuth instead of Basic auth.
     */
    oauthClientId: z.string().optional(),
    /**
     * OAuth 2.0 (3LO) Client Secret from the Atlassian developer console.
     */
    oauthClientSecret: z.string().optional(),
    /**
     * OAuth 2.0 (3LO) rotating refresh token. The adapter refreshes access
     * tokens at runtime and will warn operators when Jira rotates this value.
     * Persist the latest refresh token via env or config/local.json.
     */
    oauthRefreshToken: z.string().optional(),
    /**
     * Base URL used to build the OAuth callback redirect URI.
     * Example: `https://agent-detective.example.com` (no trailing slash).
     */
    oauthRedirectBaseUrl: z.string().optional(),
    /**
     * Jira Cloud ID for the site to operate on. Retrieved from Atlassian's
     * `accessible-resources` endpoint during OAuth setup.
     *
     * OAuth calls are routed via `https://api.atlassian.com/ex/jira/{cloudId}`.
     */
    cloudId: z.string().optional(),
    analysisPrompt: z.string().optional(),
    analysisReadOnly: z.boolean().default(true),
    /**
     * Markdown template posted to Jira when an `issue_created` event arrives
     * but none of the labels match a configured repo. See
     * `handlers/missing-labels-handler.ts` for supported placeholders.
     */
    missingLabelsMessage: z.string().optional(),
    /**
     * Safety cap for multi-repo fan-out. When an issue's labels match more
     * than this many configured repos, the adapter analyzes the first N
     * (repo-config order) and mentions the skipped ones in the acknowledgment.
     * `0` disables the cap.
     */
    maxReposPerIssue: z.number().int().min(0).default(5),
    /**
     * Phrase that, when found inside a Jira comment by a non-adapter user,
     * triggers a fresh label match + analysis. Matching is case-insensitive
     * and substring-based. Default is a slash/hashtag command-style phrase
     * that is extremely unlikely to appear in normal conversation.
     */
    retryTriggerPhrase: z.string().min(1).default('#agent-detective analyze'),
    /**
     * On `jira:comment_created` only, if the body contains this phrase (and not
     * the adapter’s own comment), the PR workflow is triggered instead of
     * read-only analysis. Requires `@agent-detective/pr-pipeline` and
     * per-repo VCS in local-repos. PR phrase is checked before `retryTriggerPhrase`.
     */
    prTriggerPhrase: z.string().min(1).default('#agent-detective pr'),
    /**
     * Identity of the Jira account the adapter posts as. Combined with the
     * hidden marker the adapter stamps on every comment, this is used to
     * ignore comments the adapter itself authored so result / reminder
     * comments can't re-trigger analysis.
     */
    jiraUser: z
      .object({
        accountId: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    webhookBehavior: jiraWebhookBehaviorSchema.default(DEFAULT_WEBHOOK_BEHAVIOR),
    /**
     * Per-(issue, repo) minimum spacing for automatic (non–trigger-phrase) analysis.
     * Default 10 minutes — see handlers/index.ts.
     */
    autoAnalysisCooldownMs: z.number().int().min(0).default(10 * 60_000),
    /**
     * Per-issue minimum spacing between "missing label" reminder comments.
     * Default 60 seconds.
     */
    missingLabelsReminderCooldownMs: z.number().int().min(0).default(60_000),
    /**
     * When true, the adapter fetches all comments on the Jira issue before
     * dispatching the PR workflow and passes human-authored ones (app comments
     * excluded) to pr-pipeline as additional agent context.
     */
    fetchIssueComments: z.boolean().default(false),
    /**
     * When true, append a fenced JSON block (`agent-detective/jira-comment-metadata/v1`)
     * after the analysis Markdown so Jira Automation or scripts can parse task id,
     * issue key, and matched repo without scraping narrative text.
     */
    structuredCommentMetadata: z.boolean().default(false),
    /**
     * After analysis completes, optionally create Jira subtasks under the parent issue
     * (requires host SQLite persistence). Default off.
     */
    taskSpawnOnComplete: z.enum(['off', 'subtasks']).default('off'),
    /** Max subtasks per `TASK_COMPLETED` when spawn is enabled. Default 3. */
    taskSpawnMaxPerCompletion: z.number().int().min(1).max(10).default(3),
    /** Default subtask summary template; `{result}` expands to the agent output excerpt. */
    taskSpawnSubtaskSummaryTemplate: z.string().min(1).default('Agent analysis follow-up'),
    taskSpawnSubtaskDescriptionTemplate: z.string().optional(),
    /**
     * When true, merge optional ```json …``` block from agent output (`{ "subtasks": [{ "summary", "description" }] }`).
     */
    taskSpawnMergeAgentJson: z.boolean().default(false),
    /** If set, spawn is skipped unless the parent issue's project key is listed. */
    taskSpawnAllowedProjectKeys: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.mockMode !== false) return;
    const hasOAuthBundle = Boolean(
      data.oauthClientId?.trim() &&
        data.oauthClientSecret?.trim() &&
        data.oauthRefreshToken?.trim()
    );
    const hasBasicBundle = Boolean(
      data.baseUrl?.trim() && data.email?.trim() && data.apiToken?.trim()
    );

    if (!hasOAuthBundle && !hasBasicBundle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'When mockMode is false, Jira auth must be configured as either:' +
          ' (A) Basic auth: baseUrl + email + apiToken (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN), or' +
          ' (B) OAuth 2.0 (3LO): oauthClientId + oauthClientSecret + oauthRefreshToken + cloudId (JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REFRESH_TOKEN, JIRA_CLOUD_ID).',
        path: ['mockMode'],
      });
      return;
    }

    if (hasOAuthBundle && !data.cloudId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'When mockMode is false and OAuth is configured, `cloudId` is required (set in config or JIRA_CLOUD_ID).',
        path: ['cloudId'],
      });
    }
  });

export type JiraAdapterOptions = z.infer<typeof jiraAdapterOptionsSchema>;
