import type { Agent } from '../core/types.js';

const codexAppAgent: Agent = {
  id: 'codex-app',
  label: 'codex-app',
  backend: 'app-server',
  checkAvailable: () => true,
};

export default codexAppAgent;
