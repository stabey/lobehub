# State Management

> How state is managed in this project.

---

## Overview

LobeHub uses Zustand for client state and SWR for server/cache state. Store
domains live under `src/store/<domain>/`; larger stores are split into slices.

The task store is the current reference implementation:

- `src/store/task/store.ts`
- `src/store/task/initialState.ts`
- `src/store/task/slices/detail/action.ts`
- `src/store/task/slices/detail/reducer.ts`
- `src/store/task/selectors/detailSelectors.ts`
- `src/store/task/slices/list/action.test.ts`

---

## State Categories

- Local UI state: use React state inside a component when the state is private
  to that component.
- Route state: read route params with `react-router-dom`, as
  `src/routes/(main)/task/[taskId]/index.tsx` does with `useParams`.
- Global client state: use Zustand stores in `src/store/<domain>/` for shared UI
  state, selected IDs, maps, status flags, and cross-component actions.
- Server state: use SWR wrappers from `src/libs/swr/` and client services from
  `src/services/`.
- Derived state: use selectors under `src/store/<domain>/selectors/` instead of
  recomputing the same logic in components.

---

## Store Structure

Larger stores use slices. `src/store/task/store.ts` builds `TaskStore` by
combining slice action types and `TaskStoreState`, then flattens action classes:

```ts
...flattenActions<TaskStoreAction>([
  createTaskListSlice(...parameters),
  createTaskDetailSlice(...parameters),
  createTaskLifecycleSlice(...parameters),
  createTaskConfigSlice(...parameters),
  new TaskStoreResetAction(...parameters),
])
```

Store creation uses:

- `createWithEqualityFn` from `zustand/traditional`.
- `shallow` equality from `zustand/shallow`.
- project `createDevtools`.
- `flattenActions`.
- optional `expose` for debugging.

State writes include devtools action names:

```ts
this.#set({ activeTaskId: taskId }, false, 'setActiveTaskId');
```

---

## Selectors And Derived State

Selectors are grouped under `src/store/<domain>/selectors/`. The task detail
selectors in `src/store/task/selectors/detailSelectors.ts` expose focused reads
such as `activeTaskId`, `activeTaskDetail`, `activeTaskStatus`, and computed
booleans such as `canRunActiveTask`, `canPauseActiveTask`, and
`canCancelActiveTask`.

Components should select narrow values:

```ts
const saveStatus = useTaskStore(taskDetailSelectors.taskSaveStatus);
const deleteTask = useTaskStore((s) => s.deleteTask);
```

This pattern is used in
`src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx` and
`src/features/AgentTasks/AgentTaskDetail/TaskDetailHeaderActions.tsx`.

---

## Server State

Server state is fetched through services and SWR wrappers, then written into
store maps when needed. `src/store/task/slices/detail/action.ts` fetches task
detail through `taskService.getDetail`, dispatches the result into
`taskDetailMap`, and also stores raw DB-id lookups under the resolved
identifier when necessary.

Cache invalidation uses explicit array keys:

```ts
await mutate([FETCH_TASK_DETAIL_KEY, id]);
```

Client services such as `src/services/task.ts` keep tRPC transport details away
from components and stores.

---

## Optimistic Updates

Optimistic updates should be reversible. `updateTask` in
`src/store/task/slices/detail/action.ts` updates `taskDetailMap`, sets
`taskSaveStatus` to `saving`, calls `taskService.update`, and on failure:

- resets `taskSaveStatus` to `idle`;
- refreshes the task detail from the server;
- shows `message.error` with an i18n key;
- rethrows the error.

Use reducers for map/tree mutations when state updates are non-trivial.
`src/store/task/slices/detail/reducer.ts` uses `immer` to patch task detail and
nested subtasks.

---

## When to Use Global State

Promote state to a Zustand store when:

- multiple components need the same value or action;
- the state is part of a domain workflow, such as active task, topic drawer, or
  task save status;
- the state needs devtools action names;
- server results need to be cached into maps for cross-component reads.

Keep one-off form fields, open/closed UI affordances, and component-private
transitions local unless they affect a shared workflow.

---

## Common Mistakes

- Storing server data directly in component state when it is shared across a
  route or domain.
- Mutating nested store data without a reducer or immutable update helper.
- Dispatching store writes without devtools action names.
- Duplicating derived booleans in components instead of adding focused
  selectors.
