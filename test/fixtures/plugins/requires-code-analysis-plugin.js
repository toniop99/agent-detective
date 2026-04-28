import { StandardCapabilities } from '@agent-detective/sdk';

export default {
  name: 'requires-code-analysis-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',
  requiresCapabilities: [StandardCapabilities.CODE_ANALYSIS],
  register() {},
};

