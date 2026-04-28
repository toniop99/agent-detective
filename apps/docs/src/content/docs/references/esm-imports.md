---
title: ESM imports in TypeScript
description: Rules for .js extension imports and ESM module conventions in this repo.
sidebar:
  order: 4
---

# ESM imports in TypeScript

- **`"type": "module"`** in `package.json` for ESM packages (this repo).
- **Relative imports** must use a **`.js` extension** in the specifier (e.g. `from './foo.js'`) so emitted JavaScript resolves at runtime.
- **Do not** commit hand-edited **`.js`** next to **`.ts`** sources.

More: [Agent golden rules](/docs/development/agent-golden-rules/).
