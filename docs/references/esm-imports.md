# ESM imports in TypeScript

- **`"type": "module"`** in `package.json` for ESM packages (this repo).
- **Relative imports** must use a **`.js` extension** in the specifier (e.g. `from './foo.js'`) so emitted JavaScript resolves at runtime.
- **Do not** commit hand-edited **`.js`** next to **`.ts`** sources.

More: [Agent golden rules](../development/agent-golden-rules.md).
