# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Hooks are used for local React state, route state, data fetching, store-backed
actions, and small shared utilities. Custom hooks use `use*` naming and live in
feature folders, route-local folders for legacy code, or shared `src/hooks/`
when broadly reusable.

Concrete examples:

- `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx` uses effects to
  sync active task and active chat agent state.
- `src/store/task/slices/detail/action.ts` exposes `useFetchTaskDetail` as a
  store action that calls SWR.
- `src/libs/swr/index.ts` defines project SWR wrappers.
- `src/hooks/useAppOrigin.ts` is consumed by
  `src/features/AgentTasks/AgentTaskDetail/TaskDetailHeaderActions.tsx`.

---

## Custom Hook Patterns

- Use `use*` naming for hooks and hook-shaped store actions.
- Keep hook dependencies explicit. `TaskDetailPage.tsx` includes `taskId`,
  `setActiveTaskId`, and `agentId` dependencies in its effects.
- Keep feature-specific hooks near the feature when they are not shared.
- Use shared hooks from `src/hooks/` for cross-feature concerns, such as app
  origin resolution.
- Store-backed hook actions may live in Zustand action classes when they need
  access to store state and actions.

When a hook is primarily a data fetch for a store domain, follow the task store
pattern in `src/store/task/slices/detail/action.ts`: expose a method named
`useFetchTaskDetail`, build a stable SWR key, call a store action as the fetcher,
and keep cache invalidation in the same slice.

---

## Data Fetching

LobeHub uses SWR for client/server data synchronization. Project wrappers live
in `src/libs/swr/index.ts`:

- `useClientDataSWR` for interactive client data that may refresh on focus or
  explicit mutation.
- `useOnlyFetchOnceSWR` for one-time/static data.
- `useActionSWR` for action-triggered requests that should not fetch on mount.
- `mutate` from `src/libs/swr/mutate.ts` for explicit cache invalidation.

Client services under `src/services/` wrap transport details. For example,
`src/services/task.ts` wraps `lambdaClient.task.find.query`,
`lambdaClient.task.create.mutate`, and related task procedures. Hooks and
stores should call `taskService` rather than spreading raw tRPC calls through
components.

Use explicit array keys for SWR caches. `useFetchTaskDetail` uses
`[FETCH_TASK_DETAIL_KEY, taskId]` and `internal_refreshTaskDetail` invalidates
with `mutate([FETCH_TASK_DETAIL_KEY, id])`.

---

## Polling And Revalidation

Do not rely on SWR function-form `refreshInterval` when the first call may have
undefined data. `src/store/task/slices/detail/action.ts` documents this trap and
drives polling from a reactive store boolean:

```ts
const shouldPoll = useTaskStore((s) => {
  const detail = taskId ? s.taskDetailMap[taskId] : undefined;
  return hasInFlightActivity(detail);
});
```

Then it passes a numeric interval:

```ts
{
  refreshInterval: shouldPoll ? TASK_DETAIL_POLL_INTERVAL : 0;
}
```

Follow this pattern when polling depends on state that arrives after the first
fetch.

---

## Naming Conventions

- Shared hooks: `src/hooks/useSomething.ts`.
- Feature hooks: `src/features/<Domain>/hooks/useSomething.ts` or near the
  feature component if the feature already uses that structure.
- Store-backed data hooks: `useFetch<DomainThing>` in the relevant store slice,
  such as `useFetchTaskDetail`.
- SWR keys should be named constants near the action, such as
  `FETCH_TASK_DETAIL_KEY`.

---

## Common Mistakes

- Calling raw tRPC clients from many components instead of using `src/services/`
  and store actions.
- Creating unstable SWR keys or mixing string keys and array keys for the same
  resource.
- Forgetting to invalidate SWR cache after mutations.
- Omitting hook dependencies to silence rerenders. Keep dependencies explicit
  and restructure the code if a callback is unstable.
