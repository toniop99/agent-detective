import { execSync } from 'node:child_process';

export function shellQuote(value: string): string {
  const escaped = String(value).replace(/'/g, String.raw`'\''`);
  return `'${escaped}'`;
}

export function resolvePromptValue(prompt: string, promptExpression: string | undefined): string {
  if (promptExpression) return promptExpression;
  return shellQuote(prompt);
}

export function isCommandAvailable(command: string): boolean {
  try {
    execSync(`command -v ${command} > /dev/null 2>&1`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
