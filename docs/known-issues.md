# Known Issues - Technical Debt

This document tracks known issues and technical debt identified in the agent-detective project for future resolution.

---

## 1. Race Condition in Plugin Loading (Critical)

**Severity**: Critical  
**Status**: Unresolved  
**Location**: `src/core/plugin-system.ts` line 127

### Problem

The `loadPlugin()` function does NOT await the `plugin.register()` call, even though plugins like `local-repos-plugin` have an `async register()` function.

```typescript
// In loadPlugin() line 127:
plugin.register(prefixedApp, pluginContext);  // NOT awaited!
loadedPlugins.set(packageName, loaded);       // Immediately marked as loaded
logger.info(`Loaded plugin ${plugin.name}@${plugin.version}`);
```

### Effects

1. Plugin is marked "loaded" before `localRepos` is actually set on context
2. Other plugins that depend on `local-repos-plugin` may try to access `localRepos` before it's ready
3. HTTP endpoints might not be registered when the server starts responding to requests
4. The `dependsOn` ordering is topological but register() is fire-and-forget

### Required Fix

```typescript
// Await the register call
await plugin.register(prefixedApp, pluginContext);
```

### Additional Consideration

The `dependsOn` field in plugin definitions creates a topological load order, but since `register()` is not awaited, a dependent plugin may load before its dependency's `register()` completes. Consider whether dependencies should also wait for their dependents to complete registration.

---

## 2. HTTP Endpoint Path Prefix - No Validation

**Severity**: Low  
**Status**: Unresolved  
**Location**: `src/core/plugin-system.ts` lines 21-31

### Problem

The Proxy auto-prefixes routes for plugins, but:
1. If a plugin mistakenly registers a path that already looks prefixed (e.g., `/plugins/agent-detective-local-repos-plugin/repos`), it would get double-prefixed
2. No validation or warning for such cases

### Example Scenario

```typescript
// In a hypothetical misbehaving plugin:
app.get('/plugins/agent-detective-my-plugin/repos', handler);  // Already looks prefixed

// The Proxy would prefix this to:
// /plugins/plugins/agent-detective-my-plugin/plugins/agent-detective-my-plugin/repos
```

### Current Mitigation

Existing plugins correctly use relative paths (`/repos`, `/webhook/jira`), so this is not currently a problem. However, the Proxy could be smarter and detect/prevent this.

---

## 3. console.warn vs Structured Logger

**Severity**: Low  
**Status**: Unresolved  
**Location**: `packages/local-repos-plugin/src/summary-generator.ts` line 34

### Problem

```typescript
console.warn(`Agent summary failed for ${repoPath}, falling back to pattern-based: ${(err as Error).message}`);
```

The `generateSummary()` function uses `console.warn` instead of the plugin's structured logger (passed via `PluginContext.logger`).

### Effects

- Warnings go to stdout instead of being part of the application's structured log stream
- No plugin context in the log output
- Inconsistent with other logging in the codebase

### Potential Fix Options

1. Pass a logger instance to `generateSummary()`
2. Return error information to caller and let caller log
3. Accept as minor issue - this is an internal fallback mechanism

---

## 4. Proxy Doesn't Handle `app.use()` for Express Routers

**Severity**: Low  
**Status**: Unresolved  
**Location**: `src/core/plugin-system.ts` lines 21-31

### Problem

The Proxy only handles `['get', 'post', 'put', 'delete', 'patch']`:

```typescript
return new Proxy(app, {
  get(target, prop) {
    if (['get', 'post', 'put', 'delete', 'patch'].includes(prop as string)) {
      // Only these HTTP methods are prefixed
    }
    // app.use(), app.all(), app.param() bypass the proxy entirely
  }
});
```

### Effects

If a future plugin tries to mount an Express Router with `app.use('/path', router)`, it bypasses the prefix entirely. This would cause routes to be at the root path rather than under `/plugins/{plugin-name}/`.

### Current Status

Not affecting any existing plugins. Would need to be addressed if a plugin requires router mounting.

---

## 5. No Schema Defined for local-repos-plugin

**Severity**: Low  
**Status**: Unresolved  
**Location**: `packages/local-repos-plugin/src/index.ts` lines 71-73

### Problem

```typescript
const localReposPlugin: Plugin = {
  name: '@agent-detective/local-repos-plugin',
  version: '0.1.0',
  dependsOn: [],
  // NO schema defined
```

Unlike `jira-adapter` which has a `schema.json` and in-code schema definition, `local-repos-plugin` has no `schema` property.

### Effects

1. Config validation passes any config without checking types
2. No default values applied via schema (defaults come from code, not schema)
3. Inconsistent with how jira-adapter works
4. Config IDE support/autocomplete may not work properly

### Note

Default values for `local-repos-plugin` are defined in code (`DEFAULT_SUMMARY_CONFIG`, `DEFAULT_VALIDATION_CONFIG`, etc.) which works but means configuration schema and defaults are split between `schema.json` (doesn't exist for this plugin) and `types.ts`.

---

## 6. Duplicate Default Constants

**Severity**: Low  
**Status**: Unresolved  
**Location**: `packages/local-repos-plugin/src/summary-generator.ts` vs `packages/local-repos-plugin/src/types.ts`

### Problem

The default prompt for summary generation is defined in TWO places:

**In `types.ts` line 80:**
```typescript
const DEFAULT_SUMMARY_CONFIG: SummaryGenerationConfig = {
  // ...
  summaryPrompt: 'Summarize this repository in 2-3 sentences based on the provided context.',
};
```

**In `summary-generator.ts` line 17:**
```typescript
const DEFAULT_SUMMARY_PROMPT = 'Summarize this repository in 2-3 sentences based on the provided context.';
```

### Risks

- Values could get out of sync if one is updated but not the other
- Maintenance confusion about which constant to modify

### Potential Fix

Export the default from `types.ts` and reuse it in `summary-generator.ts`, or consolidate to a single source of truth.

---

## 7. dependsOn Not Enforced at Runtime

**Severity**: Medium  
**Status**: Unresolved  
**Location**: `packages/jira-adapter/src/index.ts` line 53

### Problem

The `dependsOn` field is declared but at runtime, the plugin doesn't validate that dependencies are actually available:

```typescript
// In jira-adapter's register():
const {
  localRepos,
  buildRepoContext,
  formatRepoContextForPrompt,
} = extContext;
```

If `local-repos-plugin` hasn't finished loading (due to the race condition in issue #1), these would be `undefined` rather than throwing an error. The code silently proceeds with undefined values.

### Effects

- Silent failures if dependency plugin fails to load
- No clear error messages about missing dependencies
- Debugging becomes difficult

### Note

The issue #1 (race condition) would compound this - even if the topological ordering is correct, not awaiting `register()` means dependencies might not be truly "ready" when dependents call them.

---

## Priority Fix Order

| Priority | Issue | Rationale |
|----------|-------|-----------|
| 1 | Race condition in loadPlugin | Affects reliability of entire plugin system |
| 2 | dependsOn not enforced | Compounds issue #1, causes silent failures |
| 3 | No schema for local-repos-plugin | Consistency, proper config validation |
| 4 | Pass logger to generateSummary | Code quality, proper logging |
| 5 | Handle app.use() in Proxy | Future-proofing for router-based plugins |
| 6 | console.warn vs structured logger | Minor, acceptable for internal fallback |
| 7 | Duplicate default constants | Maintenance risk, low urgency |

---

## Related Files

- `src/core/plugin-system.ts` - Plugin loading system
- `packages/local-repos-plugin/src/index.ts` - local-repos-plugin entry
- `packages/local-repos-plugin/src/summary-generator.ts` - Summary generation
- `packages/local-repos-plugin/src/types.ts` - Type definitions and defaults
- `packages/jira-adapter/src/index.ts` - jira-adapter as example of dependency usage

---

## Last Updated

2026-04-12