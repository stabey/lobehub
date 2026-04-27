# Directory Structure

> How backend code is organized in this project.

---

## Overview

The backend is a Next.js 16 application with a SPA frontend mounted inside it.
Backend code lives mainly in `src/app/(backend)/`, `src/libs/trpc/`,
`src/server/`, and `packages/database/src/`.

Keep transport, orchestration, and persistence separated:

- Next.js route handlers expose HTTP entry points.
- tRPC routers validate inputs and call services/models.
- Services coordinate business rules and multiple models.
- Database models own Drizzle queries and user scoping.
- Schemas, models, repositories, migrations, and test DB helpers live in
  `packages/database/src/`.

---

## Directory Layout

```text
src/
  app/(backend)/
    api/                 # HTTP API route handlers and webhooks
    trpc/                # tRPC route handler entry points
    webapi/              # provider-style web API route handlers
  libs/trpc/
    lambda/              # tRPC context, init, middleware, server setup
    client/              # tRPC clients used by frontend services
    utils/               # request/response helpers
  server/
    routers/             # tRPC routers grouped by transport/domain
    services/            # backend service classes and domain modules
    modules/             # lower-level reusable backend modules
packages/database/src/
  schemas/               # Drizzle table definitions and schema-derived types
  models/                # database access classes
  repositories/          # repository helpers for larger domains
  core/                  # database adapters and test DB setup
```

Concrete examples:

- `src/app/(backend)/trpc/lambda/[trpc]/route.ts` creates the lambda tRPC fetch
  handler and logs non-auth handler errors.
- `src/app/(backend)/api/agent/run/route.ts` exposes the QStash-backed agent
  execution route.
- `src/server/routers/lambda/brief.ts` defines Zod input schemas and brief
  procedures.
- `src/server/services/brief/index.ts` coordinates `AgentModel`, `BriefModel`,
  and `TaskModel`.
- `packages/database/src/models/brief.ts` owns Drizzle queries for briefs.
- `packages/database/src/schemas/task.ts` defines task-related tables and
  schema-derived insert/select types.

---

## Module Organization

For new backend behavior, follow the same path through the stack:

1. Add or extend a tRPC router under `src/server/routers/<transport>/`.
2. Register domain root routers explicitly in the root router, such as
   `src/server/routers/lambda/index.ts`.
3. Put business orchestration in `src/server/services/<domain>/`.
4. Put lower-level reusable runtime code in `src/server/modules/<Domain>/` only
   when it is shared below the service layer.
5. Put database access in `packages/database/src/models/<domain>.ts` and schema
   definitions in `packages/database/src/schemas/*.ts`.

Routers should stay thin. In `src/server/routers/lambda/brief.ts`, procedures
validate input, instantiate a model or `BriefService`, and return `{ data,
success: true }` style objects. Business rules such as enriching briefs with
agent avatars and completing a task after approving a result brief live in
`src/server/services/brief/index.ts`.

Authenticated, database-backed lambda procedures usually use:

```ts
const briefProcedure = authedProcedure.use(serverDatabase);
```

The handler then receives `ctx.serverDB` and `ctx.userId` and passes them to
models/services.

---

## Naming Conventions

- Router files are domain-oriented and usually lower camel or lowercase names:
  `src/server/routers/lambda/brief.ts`,
  `src/server/routers/lambda/task.ts`.
- Service folders use the domain name and export from `index.ts`, for example
  `src/server/services/brief/index.ts`.
- Service classes use `DomainService`; database model classes use
  `DomainModel`.
- Database table exports are plural domain nouns where the underlying table is
  plural, such as `tasks`, `taskTopics`, and `briefs` in
  `packages/database/src/schemas/task.ts`.
- Schema-derived types sit beside the table definition, for example `NewBrief`
  and `BriefItem`.
- User-owned models should keep `db` and `userId` as private fields and apply
  user scoping in each query, as `packages/database/src/models/brief.ts` does
  with `eq(briefs.userId, this.userId)`.

---

## Examples

Use these as reference implementations:

- tRPC router: `src/server/routers/lambda/brief.ts`
- Backend service: `src/server/services/brief/index.ts`
- Database model: `packages/database/src/models/brief.ts`
- Drizzle schema: `packages/database/src/schemas/task.ts`
- Next.js API route: `src/app/(backend)/api/agent/run/route.ts`
- tRPC route handler: `src/app/(backend)/trpc/lambda/[trpc]/route.ts`

Avoid putting heavy business logic directly in `src/app/(backend)/**/route.ts`
or in route segment files. Route handlers should validate, authenticate, call a
service/model, and translate the result to an HTTP or tRPC response.
