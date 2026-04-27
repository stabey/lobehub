# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

LobeHub uses Drizzle ORM with PostgreSQL. Database ownership is centralized in
`packages/database/src/`.

Important paths:

- `packages/database/src/schemas/*.ts` - table definitions and inferred row
  types.
- `packages/database/src/models/*.ts` - database access classes used by server
  routers and services.
- `packages/database/src/repositories/**` - repository helpers for larger
  domains.
- `packages/database/src/core/getTestDB.ts` - Vitest database setup with PGlite
  by default and node-postgres when `TEST_SERVER_DB=1`.
- `packages/database/migrations/` - generated Drizzle migrations.

---

## Schema Patterns

Schemas use `pgTable` from `drizzle-orm/pg-core`. Shared column helpers live in
`packages/database/src/schemas/_helpers.ts`, including `createdAt`,
`updatedAt`, `timestamps`, `timestamptz`, `varchar255`, and `amountNumeric`.

Tables export insert/select types beside the table:

```ts
export type NewBrief = typeof briefs.$inferInsert;
export type BriefItem = typeof briefs.$inferSelect;
```

Concrete example: `packages/database/src/schemas/task.ts` defines `tasks`,
`taskDependencies`, `taskTopics`, `briefs`, and `taskComments`.

Use existing ID helpers when the project already has one for the domain:

```ts
id: text('id')
  .primaryKey()
  .$defaultFn(() => idGenerator('briefs'))
  .notNull(),
```

Foreign keys usually include explicit delete behavior, such as `onDelete:
'cascade'` for ownership relations and `onDelete: 'set null'` for optional
associations. The `briefs.userId` and `task_comments.taskId` definitions in
`packages/database/src/schemas/task.ts` show this pattern.

---

## Query Patterns

Models wrap Drizzle queries and are scoped by constructor dependencies:

```ts
export class BriefModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }
}
```

For user-owned data, every lookup/update/delete must include the owner check.
`packages/database/src/models/brief.ts` consistently combines domain filters
with `eq(briefs.userId, this.userId)`.

Common query conventions:

- Use Drizzle query builders (`select`, `insert`, `update`, `delete`) rather
  than raw SQL for normal CRUD.
- Return `result[0] || null` for nullable single-row operations, as in
  `BriefModel.findById`, `markRead`, and `resolve`.
- Return booleans for delete operations when callers only need success, as in
  `BriefModel.delete`.
- Use `sql` for aggregate or ordering expressions that Drizzle cannot express
  directly. `BriefModel.list` uses `sql<number>\`count(\*)\``and`BriefModel.listUnresolved`uses a priority`CASE\` expression.
- Keep lifecycle side effects outside models. `BriefService.resolve` in
  `src/server/services/brief/index.ts` updates task status after the model
  resolves a brief.

---

## Migrations

Generate migrations through the existing project script:

```bash
bun run db:generate
```

Run migrations with:

```bash
bun run db:migrate
```

`package.json` wires `db:generate` to `drizzle-kit generate` and DBML
generation, and wires `db:migrate` to `scripts/migrateServerDB/index.ts`.

Do not hand-write migration files unless there is a deliberate reason and the
generated SQL has been reviewed. Keep schema changes, generated migrations, and
any DBML output synchronized.

---

## Naming Conventions

- Table names in PostgreSQL are snake_case strings, such as `tasks`,
  `task_dependencies`, `task_topics`, and `briefs`.
- TypeScript table exports use lower camel case or plural nouns: `tasks`,
  `taskDependencies`, `taskTopics`, `briefs`.
- Column names in PostgreSQL are snake_case; TypeScript field names are camel
  case. Example: `createdByUserId: text('created_by_user_id')`.
- Index names use table/domain prefixes and end in `_idx`, for example
  `tasks_status_idx`, `briefs_user_id_idx`, and `task_comments_task_id_idx` in
  `packages/database/src/schemas/task.ts`.
- Self-referential foreign keys use explicit names in the third `pgTable`
  callback, such as `tasks_parent_task_id_tasks_id_fk`.

---

## Testing

Database model tests live next to model tests under
`packages/database/src/models/__tests__/`. `packages/database/src/models/__tests__/brief.test.ts`
is a representative example.

Use `getTestDB()` from `packages/database/src/core/getTestDB.ts` for database
tests. By default it uses PGlite and applies migrations while skipping
`pg_search` or BM25 statements that PGlite cannot run. Set `TEST_SERVER_DB=1`
with `DATABASE_TEST_URL` to run against node-postgres.

Database tests should seed required rows in `beforeEach` and clean up in
`afterEach`, as the brief model test does with the `users` table.

Run focused tests instead of the full test suite:

```bash
cd packages/database && bunx vitest run --silent='passed-only' 'src/models/__tests__/brief.test.ts'
```

---

## Common Mistakes

- Forgetting `userId` filters in model queries can leak data across users.
- Putting business side effects in models makes them harder to test and reuse;
  use services for orchestration.
- Adding schema fields without indexes for common filters causes slow list or
  lookup paths. Follow the table/domain-prefixed index style.
- Editing schema files without generating/reviewing migrations leaves runtime
  databases out of sync.
