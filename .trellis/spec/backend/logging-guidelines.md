# Logging Guidelines

> How logging is done in this project.

---

## Overview

Backend logging currently uses a mix of:

- Namespaced `debug` loggers for operational traces that should be opt-in.
- `console.info`, `console.warn`, and `console.error` for route/service
  failures and important runtime conditions.

Concrete examples:

- `src/app/(backend)/api/agent/run/route.ts` uses
  `debug('api-route:agent:execute-step')`.
- `src/server/services/search/index.ts` uses a namespaced debug logger for the
  search service.
- `src/app/(backend)/trpc/lambda/[trpc]/route.ts` logs non-auth tRPC handler
  failures with path and procedure type.
- `src/server/routers/lambda/brief.ts` logs domain-prefixed router failures
  such as `[brief:list]`.

---

## Log Levels

Use the level that matches the audience and urgency:

- `debug(...)`: lifecycle traces, retry/lock state, timings, provider/service
  details, and other information useful while debugging. These logs should be
  behind a namespace.
- `console.info(...)`: high-level handler failures or noteworthy events that
  are not necessarily application bugs. The tRPC lambda handler uses this to
  print the path and procedure type before logging the error.
- `console.warn(...)`: recoverable suspicious conditions.
- `console.error(...)`: unexpected failures that lead to failed API responses
  or lost work.

---

## Namespaces And Format

Prefer a stable namespace for `debug` loggers:

```ts
const log = debug('api-route:agent:execute-step');
```

Include operation identifiers in async/runtime logs when available. The agent
run route logs messages like `[{operationId}] Starting step {stepIndex}` and
`[{operationId}] Step {stepIndex} completed (...)`.

For console logs in routers, use a short domain prefix in square brackets:

```ts
console.error('[brief:resolve]', error);
```

When logging tRPC handler errors, include path and type. The lambda tRPC route
uses:

```ts
console.info(`Error in tRPC handler (lambda) on path: ${path}, type: ${type}`);
console.error(error);
```

---

## What to Log

Log enough context to diagnose production failures without exposing sensitive
data:

- Route/service domain and operation name.
- Stable IDs that are already server-side operational identifiers, such as
  `operationId` and `stepIndex` in the agent execution route.
- Retry, lock, and status transitions for queued or async work.
- The original error object server-side when wrapping unknown failures.
- Execution timing for long-running routes when already available, such as the
  `executionTime` in `src/app/(backend)/api/agent/run/route.ts`.

---

## What NOT to Log

Avoid logging:

- Secrets, API keys, credentials, tokens, and signed webhook headers.
- Raw request bodies when they may contain user content or credentials.
- Full user prompts, private messages, or document contents.
- Normal auth failures at error level in shared tRPC handlers. The lambda tRPC
  route intentionally suppresses `UNAUTHORIZED` in `onError`.

If sensitive context is needed for debugging, log stable identifiers and inspect
the underlying record through authorized tooling instead.

---

## Common Mistakes

- Using `console.log` for noisy traces instead of a namespaced `debug` logger.
- Logging a generic message without the route/procedure name, which makes
  production traces hard to connect to code.
- Duplicating logs for expected failures, especially auth failures already
  surfaced to the frontend.
