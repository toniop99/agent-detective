import type { JiraAdapterConfig } from '../domain/types.js';
import type { JiraSubtaskCreateSpec } from '../infrastructure/jira-client.js';

function interpolate(template: string, ctx: { result: string }): string {
  return template.replace(/\{result\}/g, () => ctx.result);
}

/**
 * Parse first fenced ```json … ``` block from agent output for optional spawn overrides.
 * Expected shape: `{ "subtasks": [ { "summary": "…", "description": "…" } ] }`.
 */
export function parseOptionalSpawnJsonFromResult(result: string): JiraSubtaskCreateSpec[] | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(result);
  const raw = fence?.[1]?.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { subtasks?: unknown };
    if (!Array.isArray(o.subtasks)) return null;
    const out: JiraSubtaskCreateSpec[] = [];
    for (const st of o.subtasks) {
      if (!st || typeof st !== 'object') continue;
      const row = st as Record<string, unknown>;
      const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
      if (!summary) continue;
      const entry: JiraSubtaskCreateSpec = { summary };
      if (typeof row.description === 'string' && row.description.trim()) {
        entry.description = row.description;
      }
      out.push(entry);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Build subtask specs from templates and optional JSON (see ADR 0003 / plan).
 */
export function buildSubtaskSpecsForTaskResult(cfg: JiraAdapterConfig, result: string): JiraSubtaskCreateSpec[] {
  const max = cfg.taskSpawnMaxPerCompletion ?? 3;
  const json =
    cfg.taskSpawnMergeAgentJson === true ? parseOptionalSpawnJsonFromResult(result) : null;
  if (json && json.length > 0) {
    return json.slice(0, max);
  }
  const summaryTpl = cfg.taskSpawnSubtaskSummaryTemplate ?? 'Agent analysis follow-up';
  const descTpl = cfg.taskSpawnSubtaskDescriptionTemplate;
  return [
    {
      summary: interpolate(summaryTpl, { result }),
      ...(descTpl ? { description: interpolate(descTpl, { result }) } : {}),
    },
  ];
}
