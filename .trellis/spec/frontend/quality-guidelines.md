# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality is enforced through focused tests, lint/type-check scripts,
route synchronization checks, i18n conventions, and reuse of established UI and
state patterns.

Relevant project commands from `package.json`:

- `bun run lint` runs TypeScript lint, stylelint, type-check, and circular
  dependency checks.
- `bun run type-check` runs `tsgo --noEmit`.
- Focused tests use `bunx vitest run --silent='passed-only' '<file>'`.

Do not run the full `bun run test` during normal agent work; project guidance
says it takes about 10 minutes.

---

## Forbidden Patterns

- Do not put new business-heavy UI under `src/routes/**`; route segments should
  delegate to `src/features/**`.
- Do not update only one desktop router config. Keep
  `src/spa/router/desktopRouter.config.tsx` and
  `src/spa/router/desktopRouter.config.desktop.tsx` synchronized.
- Do not spread raw tRPC calls through components. Use `src/services/` and store
  actions, as `src/services/task.ts` and `src/store/task/slices/detail/action.ts`
  do.
- Do not add user-facing strings without locale keys under
  `src/locales/default/` and preview locale updates when appropriate.
- Do not run `pnpm i18n`; CI handles generated i18n workflow.
- Do not use runtime `createStyles` for static token-based styles that can use
  `createStaticStyles` with `cssVar.*`.

---

## Required Patterns

- Use function components and `memo` for non-trivial feature components, as in
  `TaskDetailPage.tsx` and `TaskDetailHeaderActions.tsx`.
- Use existing `@lobehub/ui`, antd, lucide icons, and shared feature components
  before introducing new UI primitives.
- Use `useTranslation` for user-facing copy. `TaskDetailHeaderActions.tsx`
  reads both `chat` and `common` namespaces.
- Use Zustand selectors for focused store reads and action selection.
- Use SWR wrappers from `src/libs/swr/` for client/server data fetching.
- Keep desktop router configs synchronized and rely on
  `src/spa/router/desktopRouter.sync.test.tsx` as the guard.

---

## Testing Requirements

Frontend tests use Vitest. The default test environment is configured by
`vitest.config.mts`; store tests run against the store directly.

Examples:

- `src/store/task/slices/list/action.test.ts` mocks `@/services/task` and
  `@/libs/swr`, resets store state in `beforeEach`, and calls actions through
  `useTaskStore.getState()`.
- `src/store/task/selectors/detailSelectors.test.ts` covers derived selector
  behavior.
- `src/spa/router/desktopRouter.sync.test.tsx` checks desktop router config
  parity.
- `src/features/AgentTasks/features/taskCardListDisplay.test.ts` covers feature
  display logic.

Run the specific test file that matches the changed code:

```bash
bunx vitest run --silent='passed-only' 'src/spa/router/desktopRouter.sync.test.tsx'
```

For docs-only changes, it is acceptable to skip type-check and tests if you run
docs/context consistency checks instead and report that no TypeScript files
changed.

---

## Accessibility And UX Review

When changing UI:

- Prefer semantic/library controls from `@lobehub/ui` and antd.
- Ensure icon actions have clear labels through menu items, visible text, or
  tooltips. `TaskDetailHeaderActions.tsx` uses labeled dropdown items for the
  icon-triggered menu.
- Preserve keyboard affordances where existing UI exposes them, such as the
  `Hotkey` extra shown for delete.
- Check responsive layout when editing fixed headers, panels, or dense task UI.

---

## Code Review Checklist

Before considering frontend work complete, check:

- Route files remain thin and delegate to features.
- Desktop router configs are both updated when route paths change.
- Components use existing UI primitives and styling conventions.
- Store reads use focused selectors and actions.
- Server data flows through services and SWR/store actions.
- User-facing copy has locale keys.
- Tests were added or updated for changed behavior, or a docs-only verification
  was run.
- `bun run type-check` was run for TypeScript changes, or intentionally skipped
  for docs-only changes.
