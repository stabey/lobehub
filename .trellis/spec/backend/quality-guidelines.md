# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

Backend code should preserve the existing layer boundaries and test style:

- Route handlers and tRPC routers validate and delegate.
- Services coordinate business rules.
- Models own database access and user scoping.
- Shared database definitions live in `packages/database/src/`.
- Tests use Vitest and should be focused to the changed file/domain.

Project scripts in `package.json` define the main quality commands:

- `bun run lint` runs TypeScript lint, stylelint, type-check, and circular
  dependency checks.
- `bun run type-check` runs `tsgo --noEmit`.
- Focused tests use `bunx vitest run --silent='passed-only' '<file>'`.

---

## Forbidden Patterns

- Do not run the full `bun run test` during normal agent work; project guidance
  says it is slow. Run focused Vitest files instead.
- Do not bypass tRPC input validation. New procedure inputs should use Zod near
  the router, as in `src/server/routers/lambda/brief.ts`.
- Do not place business orchestration in Drizzle models. `BriefService.resolve`
  updates task lifecycle state outside `BriefModel`.
- Do not write user-owned database queries without user scoping.
  `packages/database/src/models/brief.ts` is the model to copy for
  `eq(table.userId, this.userId)`.
- Do not update only one side of a cross-layer contract. If a router response,
  service method, model type, or shared type changes, update consumers and tests
  together.

---

## Required Patterns

- Authenticated DB-backed lambda procedures should use
  `authedProcedure.use(serverDatabase)` and instantiate services/models with
  `ctx.serverDB` and `ctx.userId`.
- Register new lambda routers in `src/server/routers/lambda/index.ts`.
- Keep router response shapes consistent with current code:
  `{ data, success: true }`, optionally with `message` and `total`.
- Use `TRPCError` for expected tRPC failures and preserve existing `TRPCError`
  instances in catch blocks.
- Use schema-derived database types such as `BriefItem` and `NewBrief` from
  `packages/database/src/schemas/task.ts`.
- Keep comments focused on non-obvious behavior. The terminal accept rule
  comment in `src/server/services/brief/index.ts` is a good example of a
  valuable domain comment.

---

## Testing Requirements

Add or update tests when backend behavior changes:

- Service tests can mock dependent models/services with Vitest. Example:
  `src/server/services/brief/index.test.ts`.
- Database model tests should use `getTestDB()` from
  `packages/database/src/core/getTestDB.ts`. Example:
  `packages/database/src/models/__tests__/brief.test.ts`.
- Node-environment backend tests declare `// @vitest-environment node`.
- Existing project guidance prefers `vi.spyOn` when practical, though some
  established tests use `vi.mock` for class dependencies.

Run the most specific relevant test file:

```bash
bunx vitest run --silent='passed-only' 'src/server/services/brief/index.test.ts'
```

For database package tests:

```bash
cd packages/database && bunx vitest run --silent='passed-only' 'src/models/__tests__/brief.test.ts'
```

---

## Code Review Checklist

Before considering backend work complete, check:

- Inputs are validated at the transport boundary with Zod or explicit HTTP
  validation.
- Expected failures return `TRPCError` codes or explicit HTTP status codes.
- Unknown failures are logged server-side and wrapped before reaching clients.
- User-owned queries include user scoping.
- Router, service, model, and client service contracts still agree.
- New schema changes have generated/reviewed migrations.
- Focused tests or a clear docs-only verification were run.
- `bun run type-check` was run for TypeScript changes, or intentionally skipped
  for docs-only changes.
