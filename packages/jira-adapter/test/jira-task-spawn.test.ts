import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtaskSpecsForTaskResult, parseOptionalSpawnJsonFromResult } from '../src/application/jira-task-spawn.js';
import type { JiraAdapterConfig } from '../src/domain/types.js';

describe('jira-task-spawn', () => {
  it('parses fenced json subtasks', () => {
    const body = 'intro\n```json\n{ "subtasks": [ { "summary": "A", "description": "D1" }, { "summary": "B" } ] }\n```\n';
    const out = parseOptionalSpawnJsonFromResult(body);
    assert.deepEqual(out, [
      { summary: 'A', description: 'D1' },
      { summary: 'B' },
    ]);
  });

  it('buildSubtaskSpecs caps json by max', () => {
    const cfg = {
      taskSpawnMergeAgentJson: true,
      taskSpawnMaxPerCompletion: 2,
    } as JiraAdapterConfig;
    const body =
      '```json\n{ "subtasks": [ {"summary":"1"}, {"summary":"2"}, {"summary":"3"} ] }\n```';
    const specs = buildSubtaskSpecsForTaskResult(cfg, body);
    assert.equal(specs.length, 2);
    assert.equal(specs[0]!.summary, '1');
    assert.equal(specs[1]!.summary, '2');
  });

  it('defaults to one template subtask when no json', () => {
    const cfg = {} as JiraAdapterConfig;
    const specs = buildSubtaskSpecsForTaskResult(cfg, 'hello');
    assert.equal(specs.length, 1);
    assert.match(specs[0]!.summary, /follow-up/i);
  });
});
