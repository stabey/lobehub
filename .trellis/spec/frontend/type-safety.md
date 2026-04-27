# Type Safety

> Type safety patterns in this project.

---

## Overview

LobeHub uses TypeScript across frontend and backend. Frontend code imports
shared domain types from packages such as `@lobechat/types`, derives types from
services where useful, and uses Zod at tRPC router boundaries.

Representative examples:

- `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx` defines
  `TaskDetailPageProps`.
- `src/store/task/slices/detail/action.ts` imports `TaskDetailData` and derives
  `CreatedTask` and `DeletedTask` from `taskService` return types.
- `src/services/task.ts` types task service parameters and uses
  `Parameters<typeof lambdaClient.task.updateReview.mutate>` for pass-through
  mutations.
- `src/server/routers/lambda/brief.ts` validates procedure input with Zod.
- `packages/database/src/schemas/task.ts` exports schema-derived Drizzle types
  such as `NewBrief` and `BriefItem`.

---

## Type Organization

- Component props interfaces live near the component unless shared externally.
- Shared domain data should come from packages such as `@lobechat/types` when
  available.
- Service method parameters are typed in `src/services/*.ts`.
- Store state types live in `src/store/<domain>/initialState.ts`; slice action
  types live near the slice.
- Selector functions type their input with the domain store state, as
  `src/store/task/selectors/detailSelectors.ts` does with `TaskStoreState`.
- Database insert/select types live beside schema definitions in
  `packages/database/src/schemas/*.ts`.

---

## Inference Patterns

Use TypeScript inference to keep service and store contracts synchronized.
`src/store/task/slices/detail/action.ts` derives mutation result types from the
service:

```ts
type CreatedTask = NonNullable<Awaited<ReturnType<typeof taskService.create>>['data']>;
type DeletedTask = NonNullable<Awaited<ReturnType<typeof taskService.delete>>['data']>;
```

Use `Parameters<typeof fn>` for pass-through wrappers. `src/services/task.ts`
uses:

```ts
updateReview = async (...args: Parameters<typeof lambdaClient.task.updateReview.mutate>) =>
  lambdaClient.task.updateReview.mutate(...args);
```

Use discriminated unions for reducer payloads. `src/store/task/slices/detail/reducer.ts`
defines `TaskDetailDispatch` as a union of `deleteTaskDetail`,
`setTaskDetail`, and `updateTaskDetail` actions.

---

## Validation

Use Zod for tRPC input validation at router boundaries. `src/server/routers/lambda/brief.ts`
defines `idInput`, `createSchema`, and `listSchema` near the router, then calls
`.input(schema)` on procedures.

Do not rely on component or service TypeScript types as runtime validation for
API inputs. The runtime boundary is the tRPC router or HTTP route handler.

---

## Assertions And `any`

Avoid broad `any` in production code. Existing code has some `any` in tests,
mocks, and isolated error catches. For example,
`src/server/services/brief/index.test.ts` casts mocked partial rows with
`as any[]`, and `src/app/(backend)/api/agent/run/route.ts` catches
`error: any` to return `error.message`.

When a type assertion is needed:

- Keep it narrow and local.
- Prefer deriving a type from the real function or schema.
- Avoid exporting asserted shapes as shared contracts.

---

## Forbidden Patterns

- Do not introduce untyped service payloads when the method can declare a
  parameter type, as `src/services/task.ts` does for `create`, `update`, and
  `list`.
- Do not duplicate shared domain interfaces in components when
  `@lobechat/types` already exports the shape.
- Do not use TypeScript types as a substitute for runtime validation at API
  boundaries.
- Do not broaden selectors or component props to `any` to avoid fixing the
  actual contract.
