# Project Guidelines Bootstrap Research

Source date: 2026-04-27

This research summarizes current LobeHub conventions found in existing docs and representative code. Use it to populate `.trellis/spec/backend/*.md` and `.trellis/spec/frontend/*.md` with factual project patterns, not aspirational rules.

## Existing Convention Sources

- `AGENTS.md` is the strongest current project convention document.
- `CLAUDE.md` delegates to `AGENTS.md`.
- `CONTRIBUTING.md` is mostly general contribution guidance; it mentions `pnpm lint`, focused commits, and PR review.
- `.editorconfig` sets UTF-8, LF, 2-space indentation, trailing whitespace trimming, and final newlines. Markdown disables trailing whitespace trimming.
- `package.json` uses `pnpm` for dependency management, `bun`/`bunx` for running scripts, `tsgo --noEmit` for type-check, Vitest for tests, stylelint, eslint, and dpdm circular checks.

## Stack And Runtime Shape

- Next.js 16, React 19, TypeScript.
- SPA runs inside Next.js and uses `react-router-dom`.
- UI uses `@lobehub/ui`, antd, lucide icons, and `antd-style`.
- Preferred styling is `createStaticStyles` with `cssVar.*`; runtime `createStyles`/token should be reserved for genuine runtime style needs.
- i18n uses `react-i18next` and locale namespace files under `src/locales/default/`.
- Client state uses Zustand. Server/cache data uses SWR.
- Backend API uses tRPC routers with Zod input schemas.
- Database uses Drizzle ORM with PostgreSQL schemas in `packages/database`.
- Tests use Vitest. Use focused file-level test runs rather than `bun run test`, which is documented as slow.

## Backend Directory Structure

- `src/app/(backend)/` contains Next.js route handlers and API entry points.
  - tRPC handlers: `src/app/(backend)/trpc/lambda/[trpc]/route.ts`, `src/app/(backend)/trpc/async/[trpc]/route.ts`, `src/app/(backend)/trpc/tools/[trpc]/route.ts`.
  - Web APIs/webhooks: examples include `src/app/(backend)/api/agent/run/route.ts`, `src/app/(backend)/api/webhooks/video/[provider]/route.ts`, `src/app/(backend)/webapi/models/[provider]/route.ts`.
- `src/libs/trpc/` contains tRPC setup, middleware, context, client, and request/response helpers.
  - Server setup: `src/libs/trpc/lambda/index.ts`, `src/libs/trpc/lambda/init.ts`, `src/libs/trpc/lambda/context.ts`, `src/libs/trpc/lambda/middleware/serverDatabase.ts`.
  - Client setup: `src/libs/trpc/client/lambda.ts`, `src/libs/trpc/client/index.ts`.
- `src/server/routers/` contains tRPC routers by transport/domain.
  - Lambda routers live in `src/server/routers/lambda/*.ts`; root registration is `src/server/routers/lambda/index.ts`.
  - Other router groups include `async`, `mobile`, and `tools`.
- `src/server/services/` contains backend business/service classes and domain modules, for example `src/server/services/brief/index.ts`, `src/server/services/search/index.ts`, `src/server/services/bot/*`, `src/server/services/agentRuntime/*`.
- `src/server/modules/` contains lower-level reusable backend modules, for example `src/server/modules/AgentRuntime/*` and `src/server/modules/AgentTracing/*`.
- `packages/database/src/` owns database schemas, models, repositories, test DB setup, and database utilities.
  - Schemas: `packages/database/src/schemas/*.ts`
  - Models: `packages/database/src/models/*.ts`
  - Repositories: `packages/database/src/repositories/**`
  - Test DB: `packages/database/src/core/getTestDB.ts`

## Backend API Patterns

- tRPC routers import `router`, `authedProcedure`, and middleware from `@/libs/trpc/lambda`.
- Routers define Zod input schemas near the router. Example: `src/server/routers/lambda/brief.ts` defines `createSchema`, `listSchema`, and `idInput`.
- Authenticated DB-backed procedures usually use `authedProcedure.use(serverDatabase)` so handlers receive `ctx.serverDB` and `ctx.userId`.
- Handlers instantiate models/services with `(ctx.serverDB, ctx.userId)`.
- Router methods return a consistent object shape such as `{ data, success: true }`, sometimes with `message` or `total`.
- Domain root routers are registered explicitly in `src/server/routers/lambda/index.ts`, which exports `LambdaRouter`.
- Client services wrap `lambdaClient.<router>.<procedure>.query/mutate`, for example `src/services/task.ts`.

## Backend Service And Model Patterns

- Service classes coordinate multiple models and business rules. Example: `BriefService` in `src/server/services/brief/index.ts` owns `AgentModel`, `BriefModel`, and `TaskModel`.
- Models are database access classes scoped by `db` and `userId`. Example: `BriefModel` in `packages/database/src/models/brief.ts` stores private `db` and `userId` fields and applies `eq(table.userId, this.userId)` to user-owned queries.
- Models return typed schema rows such as `BriefItem` and `NewBrief`, imported from schema files.
- Model methods use Drizzle query builders (`select`, `insert`, `update`, `delete`) and return `result[0] || null` for nullable single-row lookups.
- Service methods may enrich model data and keep lifecycle side effects outside the model. Example: `BriefService.resolve` marks result briefs as task-completing by calling `TaskModel.updateStatus`.

## Database Patterns

- Drizzle schemas use `pgTable` from `drizzle-orm/pg-core`.
- Tables export insert/select types beside the table, e.g. `export type NewBrief = typeof briefs.$inferInsert; export type BriefItem = typeof briefs.$inferSelect;`.
- Shared column helpers live in `packages/database/src/schemas/_helpers.ts`: `createdAt`, `updatedAt`, `accessedAt`, `timestamps`, `timestamptz`, `varchar255`, `amountNumeric`.
- Text IDs often use `idGenerator`, e.g. `id: text('id').primaryKey().$defaultFn(() => idGenerator('tasks')).notNull()`.
- Foreign keys usually specify delete behavior (`cascade`, `set null`).
- Indexes are declared in the third `pgTable` callback; naming uses table/domain prefixes such as `tasks_status_idx`, `briefs_user_id_idx`.
- Many domain tables include `userId` and user-scoped indexes.
- Migrations are generated via `bun run db:generate`; DB migration runtime uses `bun run db:migrate`.

## Backend Error Handling And Logging

- tRPC routers throw `TRPCError` for expected API errors (`NOT_FOUND`, `BAD_REQUEST`, `UNAUTHORIZED`, `INTERNAL_SERVER_ERROR`).
- Router catch blocks preserve existing `TRPCError` instances and wrap unknown errors with `TRPCError({ cause, code, message })`.
- API route handlers return `NextResponse.json({ error }, { status })` for HTTP APIs. Example: `src/app/(backend)/api/agent/run/route.ts` returns 401 for invalid QStash signatures and 400 when `operationId` is missing.
- tRPC route handlers filter normal unauthorized errors from logs. Example: `src/app/(backend)/trpc/lambda/[trpc]/route.ts` ignores `UNAUTHORIZED` in `onError`, then logs path/type and error for other failures.
- Debug logging uses the `debug` package with namespaced loggers. Examples: `debug('api-route:agent:execute-step')` in `src/app/(backend)/api/agent/run/route.ts`, and `debug('lobe-oom:web-browsing:search-service')` in `src/server/services/search/index.ts`.
- Operational failures are commonly logged with `console.error('[Domain] message', error)` or `console.warn(...)` in backend services and routes. Frontend client error handling also uses `console.error` in the tRPC client link for non-auth failures.

## Backend Testing Patterns

- Tests use Vitest and are colocated as `*.test.ts` / `*.test.tsx`.
- Node-environment backend tests add `// @vitest-environment node`.
- Service tests commonly mock dependent models/services with `vi.mock`, `vi.fn`, `vi.clearAllMocks`, and `vi.mocked`. Example: `src/server/services/brief/index.test.ts`.
- Database model tests use `getTestDB()` from `packages/database/src/core/getTestDB.ts`. By default it runs PGlite and applies migrations, skipping pg_search/BM25 statements for compatibility; `TEST_SERVER_DB=1` switches to node-postgres with `DATABASE_TEST_URL`.
- Database tests seed required rows in `beforeEach` and clean up in `afterEach`. Example: `packages/database/src/models/__tests__/brief.test.ts`.
- Existing AGENTS guidance says prefer `vi.spyOn` over `vi.mock` when practical, run specific tests with `bunx vitest run --silent='passed-only' '[file-path]'`, and do not run full `bun run test` during agent work.

## Frontend Directory Structure

- SPA entry points and router configs live under `src/spa/`.
  - Entries: `src/spa/entry.web.tsx`, `entry.mobile.tsx`, `entry.desktop.tsx`, `entry.popup.tsx`.
  - Router configs: `src/spa/router/desktopRouter.config.tsx`, `desktopRouter.config.desktop.tsx`, `mobileRouter.config.tsx`, `popupRouter.config.tsx`.
  - Desktop route configs must stay synchronized; `src/spa/router/desktopRouter.sync.test.tsx` guards this.
- SPA route segment files live under `src/routes/`.
  - Route files are expected to stay thin and delegate to `@/features/*`.
  - Example thin route: `src/routes/(main)/task/[taskId]/index.tsx` reads `taskId` from `useParams`, gets minimal store data, and renders `TaskDetailPage`.
  - Some older route directories still contain local `features/`, `components/`, and hooks; document the current preferred roots/features split from `AGENTS.md`.
- Domain UI and business components live under `src/features/<Domain>/`.
  - Example: `src/features/AgentTasks/AgentTaskDetail/*`, `src/features/AgentTasks/AgentTaskList/*`, `src/features/AgentTasks/shared/*`.
  - Feature domains export entry points such as `src/features/AgentTasks/index.tsx`.
- Shared client services live in `src/services/`.
- Shared Zustand stores live in `src/store/<domain>/`.
- Shared app components live in `src/components/`.
- Locale defaults live in `src/locales/default/*.ts`.

## Frontend Component Patterns

- Components are typically function components wrapped in `memo`, with explicit props interfaces where props are non-trivial.
- UI layout often uses `Flexbox` from `@lobehub/ui`, antd components, and project feature components such as `NavHeader` and `WideScreenContainer`.
- Icons come from `lucide-react` and are rendered through `@lobehub/ui` `Icon`/`ActionIcon` where appropriate.
- Component state and callbacks use React hooks (`useState`, `useMemo`, `useCallback`, `useEffect`) with dependencies included.
- For user-facing text, use `useTranslation` and locale keys rather than inline strings, with occasional `defaultValue` fallbacks in component code.
- Confirmations and feedback use antd app context or project static methods. Examples: `App.useApp()` with `modal`/`message` in `TaskDetailHeaderActions`, and `message.error` from `@/components/AntdStaticMethods` in store actions.
- Route/page components should prefer composing feature components rather than carrying business logic.

## Frontend Styling Patterns

- Prefer `createStaticStyles` from `antd-style` and `cssVar.*` tokens for CSS-in-JS.
- Static style modules are often exported as `styles` from `style.ts`.
- Keep layout-critical styles close to the feature domain when they are not broadly reusable. Example: `src/features/AgentTasks/shared/style.ts`.
- Direct inline styles are common for simple layout values in JSX, especially with `Flexbox`; larger selectors/classes should use `createStaticStyles`.
- AGENTS explicitly prefers `createStaticStyles` with `cssVar.*` over runtime `createStyles` + `token` unless runtime computation is necessary.

## Frontend Hooks And Data Fetching

- Custom hooks use `use*` naming and live either under feature folders (`src/features/ChatInput/hooks/*`) or route-local hooks for legacy/route-specific code (`src/routes/(main)/settings/hooks/*`).
- Store actions can expose hook-shaped methods that call SWR. Example: `useFetchTaskDetail` and `useFetchTaskList` in `src/store/task/slices/*/action.ts`.
- SWR wrappers live in `src/libs/swr/`. `useClientDataSWR` is for interactive client data, `useOnlyFetchOnceSWR` is for one-time/static data, and `useActionSWR` is for action-triggered requests.
- SWR cache invalidation uses `mutate([key, id])` with explicit array keys, for example `FETCH_TASK_DETAIL_KEY` in task detail actions.
- Client services under `src/services/` should wrap transport details so stores/components do not call raw tRPC everywhere.

## Frontend State Management

- Zustand store domains live under `src/store/<domain>/`.
- Larger stores use slices under `slices/<slice>/` with `action.ts`, `index.ts`, `initialState.ts`, optional `reducer.ts`, and tests.
- Store creation uses `createWithEqualityFn` with `shallow`, project `createDevtools`, `flattenActions`, and optional `expose`. Example: `src/store/task/store.ts`.
- Store actions are class-based in several domains. Example: `TaskDetailSliceActionImpl` and `TaskListSliceActionImpl`.
- Selectors are grouped under `src/store/<domain>/selectors/*.ts` or `selectors.ts`. Example: `taskDetailSelectors` exposes fine-grained selectors and computed booleans.
- State writes include devtools action names, e.g. `this.#set({ activeTaskId: taskId }, false, 'setActiveTaskId')`.
- Optimistic updates refresh/revert on failure and surface user feedback. Example: `updateTask` in task detail slice updates the map optimistically, resets status and mutates on error, then shows `message.error`.

## Frontend Type Safety

- Use TypeScript types from shared packages such as `@lobechat/types` where available.
- Props interfaces are local to the component unless shared externally.
- Use typed selectors and service parameters; derive types with `Parameters<typeof service.method>[0]` and `Awaited<ReturnType<...>>` when useful. Example: `src/store/task/slices/detail/action.ts`.
- Schema-derived database types are used on the backend (`typeof table.$inferInsert`, `$inferSelect`).
- Zod validates tRPC input at router boundaries.
- Avoid broad `any`; existing code has some `as any` in tests/mocks and isolated error catches, but production code generally uses explicit interfaces and imported shared types.

## Frontend i18n

- Add default keys under `src/locales/default/<namespace>.ts`.
- For development preview, also update `locales/zh-CN/` and `locales/en-US/` when user-facing text changes.
- Components use `useTranslation(namespace)` or multiple namespaces. Example: `TaskDetailHeaderActions` uses `useTranslation(['chat', 'common'])`.
- Do not run `pnpm i18n`; AGENTS says CI handles generated i18n workflow.

## Frontend Testing Patterns

- Frontend tests use Vitest with the default `happy-dom` environment from `vitest.config.mts`.
- Tests mock services and project UI/static methods as needed. Example: `src/store/task/slices/detail/action.test.ts` mocks `@/services/task`, `@/libs/swr`, and `@/components/AntdStaticMethods`.
- Store tests reset store state in `beforeEach` and call actions through `useStore.getState()`.
- Use specific file test runs: `bunx vitest run --silent='passed-only' <file>`.

## Quality Commands

- Specific test: `bunx vitest run --silent='passed-only' '[file-path]'`.
- Database package test: `cd packages/database && bunx vitest run --silent='passed-only' '[file]'`.
- Type-check: `bun run type-check`.
- Lint aggregate: `bun run lint` runs TypeScript lint, stylelint, type-check, and circular dependency checks.
- Do not run `bun run test` during ordinary agent work because project guidance says it takes about 10 minutes.

## Spec Population Notes

- Replace template placeholders in all backend and frontend spec files.
- Update backend and frontend `index.md` status rows from `To fill` to a completed status after real content is written.
- Include concrete file path examples in every spec file.
- Do not document new ideals that are absent from the codebase; document the current preferred conventions already stated in `AGENTS.md` and reflected in code.
