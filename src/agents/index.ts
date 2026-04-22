import { execSync } from 'node:child_process';
import claude from './claude.js';
import cursor from './cursor.js';
import opencode from './opencode.js';
import type { Agent } from '../core/types.js';

const agents = new Map<string, Agent>([
  [claude.id, claude],
  [cursor.id, cursor],
  [opencode.id, opencode],
]);

export const DEFAULT_AGENT = opencode.id;

export const AGENT_CLAUDE = claude.id;
export const AGENT_CURSOR = cursor.id;
export const AGENT_OPENCODE = opencode.id;

export function normalizeAgent(value: string | undefined | null): string {
  if (!value) return DEFAULT_AGENT;
  const normalized = String(value).trim().toLowerCase();
  if (agents.has(normalized)) return normalized;
  return DEFAULT_AGENT;
}

export function isKnownAgent(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return agents.has(normalized);
}

export function getAgent(value: string | undefined | null): Agent | undefined {
  return agents.get(normalizeAgent(value));
}

export function getAgentLabel(value: string | undefined | null): string {
  const agent = getAgent(value);
  return agent?.label ?? DEFAULT_AGENT;
}

export function listAgents(): Agent[] {
  return Array.from(agents.values());
}

export function isAgentInstalled(agentId: string): boolean {
  const agent = agents.get(agentId);
  if (!agent || !agent.command) return false;

  try {
    execSync(`command -v ${agent.command} > /dev/null 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export default agents;
