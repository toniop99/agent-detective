# Plan: Consolidate OpenAPI Metadata to Single Source of Truth

## Status: PENDING

## Problem Statement

The current implementation has architectural duplication that works but is confusing and fragile:

1. **Duplicate Metadata Symbols** - `packages/core/src/metadata.ts` and `src/core/openapi/metadata.ts` both define the same Symbols independently
2. **Duplicate Controller Logic** - `packages/core/src/controller.ts` and `src/core/openapi/controller.ts` have nearly identical implementations
3. **Test Files Using Local Metadata** - `test/core/openapi/*.test.ts` import from `src/core/openapi/metadata.js` instead of `@agent-detective/core`
4. **Unused `controllers` Property** - `PluginContext.controllers` is set but never used

This creates risk: if someone accidentally uses local metadata for reads while decorators use `@agent-detective/core`, metadata lookups silently fail.

---

## Goal

Make `src/core/openapi/` a re-export layer from `@agent-detective/core`, not an independent implementation. Tests should verify the actual behavior that plugins experience.

---

## Steps

### Step 1: Update Test Files to Use @agent-detective/core

**Files to modify:**
- `test/core/openapi/controller.test.ts`
- `test/core/openapi/decorators.test.ts`

**Changes:**
```typescript
// Before (uses local metadata)
import { getControllerMetadata, getControllerRoutes } from '../../../src/core/openapi/metadata.js';
import { Get, Post, Delete } from '../../../src/core/openapi/decorators.js';

// After (uses @agent-detective/core)
import { getControllerMetadata, getControllerRoutes, Controller, Get, Post, Delete } from '@agent-detective/core';
```

Note: These tests are testing the same decorator behavior - they should use the same Symbol definitions that plugins use.

### Step 2: Make src/core/openapi/ Re-export from @agent-detective/core

**Files to modify:**
- `src/core/openapi/index.ts` - Re-export everything from `@agent-detective/core` instead of local files
- `src/core/openapi/decorators.ts` - Delete or make it simply re-export
- `src/core/openapi/metadata.ts` - Delete or make it simply re-export
- `src/core/openapi/controller.ts` - Delete or make it simply re-export
- `src/core/openapi/spec-generator.ts` - Already imports from `@agent-detective/core`, keep as-is

**After changes, `src/core/openapi/index.ts` should look like:**
```typescript
export * from '@agent-detective/core';
export { CORE_PLUGIN_TAG, SCALAR_TAG_GROUPS, createTagDescription } from './constants.js';
export { generateSpecFromRoutes } from './spec-generator.js';  // Only this is app-specific
```

### Step 3: Remove Duplicate Files

**Delete:**
- `src/core/openapi/decorators.ts` (if becomes empty re-export)
- `src/core/openapi/metadata.ts` (if becomes empty re-export)
- `src/core/openapi/controller.ts` (if becomes empty re-export)

Keep `spec-generator.ts` and `constants.ts` as they contain app-specific logic.

### Step 4: Remove Unused `controllers` Property

**File to modify:**
- `packages/types/src/index.ts`

Remove `controllers: object[]` from `PluginContext` interface since it's never used by consumers.

### Step 5: Verify Tests Pass

```bash
pnpm test
pnpm run lint
pnpm run build
```

---

## Files Summary

| Action | File |
|--------|------|
| MODIFY | `test/core/openapi/controller.test.ts` |
| MODIFY | `test/core/openapi/decorators.test.ts` |
| MODIFY | `src/core/openapi/index.ts` |
| DELETE | `src/core/openapi/decorators.ts` (if empty) |
| DELETE | `src/core/openapi/metadata.ts` (if empty) |
| DELETE | `src/core/openapi/controller.ts` (if empty) |
| MODIFY | `packages/types/src/index.ts` (remove controllers property) |

---

## Architecture After Fix

```
@agent-detective/core (SINGLE SOURCE OF TRUTH)
├── metadata.ts (defines Symbols + metadata functions)
├── controller.ts (Controller decorator + registerController)
├── decorators.ts (HTTP method decorators)
└── spec-generator.ts (generateSpecFromControllers)

src/core/openapi/
├── index.ts (re-exports from @agent-detective/core)
├── constants.ts (CORE_PLUGIN_TAG, SCALAR_TAG_GROUPS - app-specific)
└── spec-generator.ts (generateSpecFromRoutes - app-specific)
```

Plugins import from `@agent-detective/core` - metadata Symbols are always consistent.

---

## Verification Checklist

- [ ] All 160 tests pass
- [ ] Lint passes for all packages
- [ ] Build succeeds for all packages
- [ ] OpenAPI spec still generates correctly at `/docs`
- [ ] Plugin endpoints appear in Scalar docs with proper tags
