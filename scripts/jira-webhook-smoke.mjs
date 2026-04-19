#!/usr/bin/env node
/**
 * POST the bundled Jira issue_created fixture to the local webhook (no Jira Cloud needed).
 * Usage: pnpm run jira:webhook-smoke
 * Env: JIRA_WEBHOOK_URL (default http://127.0.0.1:3001/plugins/agent-detective-jira-adapter/webhook/jira)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const url =
  process.env.JIRA_WEBHOOK_URL ||
  'http://127.0.0.1:3001/plugins/agent-detective-jira-adapter/webhook/jira';
const fixture = resolve(root, 'packages/jira-adapter/test/fixtures/issue-created.json');
const body = readFileSync(fixture, 'utf8');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});

const text = await res.text();
console.log(`${res.status} ${res.statusText}`);
console.log(text);
if (!res.ok) process.exit(1);
