# Technical debt (rolling notes)

Short, **repo-local** reminders for patterns to fix or revisit. Prefer [ADR](../architecture/adr/) for decisions; use this for “known rough edges” agents should not amplify.

- *(Add items as one line each; remove when resolved.)*
- **Plugin SDK package split** — rename `packages/core` → `packages/sdk`, move HTTP type declarations into `@agent-detective/types`, pull host-only `applyTagGroups` and tag constants into `src/core/openapi/`. Plan: [`active/2026-04-plugin-sdk-package.md`](active/2026-04-plugin-sdk-package.md).

## Resolved (recent)
