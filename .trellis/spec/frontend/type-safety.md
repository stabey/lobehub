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

## Scenario: Compact Ordinary Chat Requests

### 1. Scope / Trigger

- Trigger: ordinary Client-mode chat must avoid large browser-to-server request
  bodies.
- Applies only after `sendMessageInServer` has persisted the current user and
  assistant placeholder messages. Do not use this as a global API compression
  pattern or Gateway promotion.

### 2. Signatures

- Frontend LLM POST:
  `ChatStreamRequestPayload = ChatStreamPayload | CompactChatStreamPayload`.
- Compact payload:

```ts
interface CompactChatStreamPayload extends Partial<Omit<ChatStreamPayload, 'messages' | 'tools'>> {
  chatRef: {
    agentId?: string;
    assistantMessageId: string;
    groupId?: string;
    initialContext?: RuntimeInitialContext;
    parentMessageId?: string;
    stepContext?: RuntimeStepContext;
    threadId?: string;
    topicId?: string;
  };
  compact: true;
}
```

- Oversized current message packages use
  `SendNewMessage.messagePackageRef?: { id: string }` after chunk upload through
  `aiChat.createMessagePackage`, `aiChat.appendMessagePackageChunk`, and
  `aiChat.finalizeMessagePackage`.

### 3. Contracts

- Compact `/webapi/chat/[provider]` requests must omit model-ready `messages`
  and `tools`.
- Keep short `sendMessageInServer.newUserMessage` content inline.
- For oversized current message packages, upload chunks first and pass only
  `messagePackageRef` to `sendMessageInServer`.
- Backend route resolves compact chat references from the persisted active
  conversation path and existing server-side context engineering before calling
  the model runtime.
- Compact reconstruction must restore runtime context that used to be assembled
  on the client, including `RuntimeStepContext`, active group identity
  (`agentGroup`), and `initialContext.mentionedAgents` for call-agent
  delegation. Selected skill/tool context is persisted into the current user
  message before the compact LLM POST, so do not re-send or re-inject it through
  `chatRef.initialContext`.

### 4. Validation & Error Matrix

- Missing inline `content` and missing `messagePackageRef` -> Zod validation
  error.
- Missing message-package chunk -> finalize fails.
- Byte-length mismatch -> finalize fails.
- Unfinalized or foreign package reference -> resolve fails.
- Compact payload missing resolvable model/provider -> route-side resolver
  fails.

### 5. Good/Base/Bad Cases

- Good: persisted ordinary chat call sends compact metadata plus
  `assistantMessageId`.
- Base: short current user message remains inline for `sendMessageInServer`.
- Bad: browser sends full `messages`, selected skill/tool context, or
  base64/file content in the later LLM POST.

### 6. Tests Required

- Frontend helper test: oversized package splits by UTF-8 byte length and
  returns only a ref.
- Router test: `sendMessageInServer` resolves `messagePackageRef` before
  creating the user message.
- Route/service test: compact chat payload reconstructs messages before model
  runtime call.
- Route/service test: compact chat payload forwards group identity and
  mentioned-agent context into server-side context engineering.
- Frontend chat service test: compact LLM request body excludes `messages` and
  `tools`.

### 7. Wrong vs Correct

Wrong:

```ts
await fetchSSE('/webapi/chat/openai', {
  body: JSON.stringify({ messages: modelReadyMessages, tools }),
});
```

Correct:

```ts
await fetchSSE('/webapi/chat/openai', {
  body: JSON.stringify({
    chatRef: { agentId, assistantMessageId, topicId },
    compact: true,
    model,
  }),
});
```

Wrong:

```ts
await serverMessagesEngine({ messages, model, provider });
```

Correct:

```ts
await serverMessagesEngine({
  agentGroup,
  agentManagementContext,
  messages,
  model,
  provider,
  stepContext,
});
```

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
