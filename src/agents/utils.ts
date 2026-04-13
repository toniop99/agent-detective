export function shellQuote(value: string): string {
  const escaped = String(value).replace(/'/g, String.raw`'\''`);
  return `'${escaped}'`;
}

export function resolvePromptValue(prompt: string, promptExpression: string | undefined): string {
  if (promptExpression) return promptExpression;
  return shellQuote(prompt);
}
