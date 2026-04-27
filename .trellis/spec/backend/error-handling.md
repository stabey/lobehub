# Error Handling

> How errors are handled in this project.

---

## Overview

Backend error handling depends on the transport:

- tRPC routers throw `TRPCError` with a code such as `NOT_FOUND`,
  `BAD_REQUEST`, `UNAUTHORIZED`, or `INTERNAL_SERVER_ERROR`.
- Next.js route handlers return `NextResponse.json({ error }, { status })` for
  HTTP APIs.
- Unknown failures are logged, then wrapped in a transport-appropriate error.
- Expected errors should be preserved instead of being converted into generic
  500 responses.

Concrete examples:

- `src/server/routers/lambda/brief.ts`
- `src/app/(backend)/api/agent/run/route.ts`
- `src/app/(backend)/trpc/lambda/[trpc]/route.ts`

---

## Error Types

tRPC procedures use `TRPCError` from `@trpc/server`.

`src/server/routers/lambda/brief.ts` throws `NOT_FOUND` when a requested brief
does not exist:

```ts
if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
```

Expected HTTP route failures are returned with explicit status codes. In
`src/app/(backend)/api/agent/run/route.ts`, invalid QStash signatures return
401 and missing `operationId` returns 400.

---

## Error Handling Patterns

Router procedures commonly use `try`/`catch` blocks that:

1. Call a model or service.
2. Return a success envelope.
3. Preserve existing `TRPCError` instances.
4. Log and wrap unknown errors.

Pattern from `src/server/routers/lambda/brief.ts`:

```ts
try {
  const model = new BriefModel(ctx.serverDB, ctx.userId);
  const brief = await model.findById(input.id);
  if (!brief) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
  return { data: brief, success: true };
} catch (error) {
  if (error instanceof TRPCError) throw error;
  console.error('[brief:find]', error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to find brief',
  });
}
```

For HTTP route handlers, keep validation and authentication checks near the top
of the handler before doing expensive work. `src/app/(backend)/api/agent/run/route.ts`
verifies the QStash signature before parsing JSON and returns early when the
signature or operation metadata is invalid.

---

## API Error Responses

tRPC procedures return data through tRPC error semantics. Successful router
responses commonly use envelopes such as:

```ts
return { data: brief, message: 'Brief marked as read', success: true };
```

List endpoints may include `total`, for example `briefRouter.list` returns
`{ data: result.briefs, success: true, total: result.total }`.

Next.js HTTP APIs return JSON with an `error` field and an explicit status:

```ts
return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
```

For retryable work queue collisions, include enough context for the caller. The
agent run route returns 429 with `operationId`, `stepIndex`, and a
`Retry-After` header when a step is locked by another instance.

---

## Logging During Errors

tRPC route handlers filter normal unauthorized errors from logs. In
`src/app/(backend)/trpc/lambda/[trpc]/route.ts`, `onError` returns early for
`UNAUTHORIZED`, then logs the path, procedure type, and error for other
failures.

Domain routers use domain prefixes in console messages, such as
`[brief:create]`, `[brief:delete]`, and `[brief:resolve]` in
`src/server/routers/lambda/brief.ts`.

---

## Common Mistakes

- Do not catch a `TRPCError` and wrap it as `INTERNAL_SERVER_ERROR`; preserve it
  so clients receive the intended status/code.
- Do not return raw thrown error objects to clients. Return a stable message and
  log the original error server-side.
- Do not log normal auth failures at error level in shared handlers; the lambda
  tRPC route already treats `UNAUTHORIZED` as expected behavior.
- Do not parse request JSON before signature verification when a route depends
  on raw-body signatures, as in the QStash agent route.
