# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend is a SPA inside Next.js. SPA entry points and router configs live
under `src/spa/`, route segment files live under `src/routes/`, and domain UI
and business components live under `src/features/`.

The preferred split is roots vs features:

- `src/routes/` contains thin route segment files.
- `src/features/<Domain>/` contains the actual page layouts, feature
  components, hooks, and domain-specific UI.
- Shared services, stores, hooks, components, and locales stay in their
  top-level project directories.

Some older route directories still contain local `features/`, `components/`,
or hooks. For new work, follow the roots/features split documented here and in
`AGENTS.md`.

---

## Directory Layout

```text
src/
  spa/
    entry.web.tsx
    entry.mobile.tsx
    entry.desktop.tsx
    entry.popup.tsx
    router/
      desktopRouter.config.tsx
      desktopRouter.config.desktop.tsx
      mobileRouter.config.tsx
      popupRouter.config.tsx
  routes/
    (main)/              # desktop/main SPA route segments
    (mobile)/            # mobile route segments
    (desktop)/           # desktop-specific route segments
    (popup)/             # popup route segments
    onboarding/
    share/
  features/
    AgentTasks/          # domain UI and page composition
    NavHeader/
    RightPanel/
    WideScreenContainer/
  services/              # client service wrappers
  store/                 # Zustand stores
  components/            # shared app components
  hooks/                 # shared client hooks
  locales/default/       # default i18n namespace files
```

Concrete examples:

- `src/spa/router/desktopRouter.config.tsx` and
  `src/spa/router/desktopRouter.config.desktop.tsx` define desktop route trees.
- `src/spa/router/desktopRouter.sync.test.tsx` verifies those desktop route
  configs stay synchronized.
- `src/routes/(main)/task/[taskId]/index.tsx` is a thin route that reads
  `taskId` from `useParams` and renders `TaskDetailPage`.
- `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx` contains the
  actual task detail page layout.
- `src/services/task.ts` wraps `lambdaClient.task.*` calls for components and
  stores.
- `src/store/task/store.ts` builds the task Zustand store from slices.

---

## Module Organization

Route files should delegate to features. They may read route params or minimal
store state needed to select the correct feature entry, but should not contain
heavy UI or business logic.

`src/routes/(main)/task/[taskId]/index.tsx` is the reference pattern:

```tsx
const { taskId } = useParams<{ taskId?: string }>();
if (!taskId) return null;
return <TaskDetailPage agentId={agentId} taskId={taskId} />;
```

Feature domains should expose clear entry points. `src/features/AgentTasks/index.tsx`
exports `TaskDetailPage` and `AgentTasksPage` from domain subfolders.

Client transport details belong in `src/services/`. Stores and components call
`taskService` from `src/services/task.ts` instead of calling raw tRPC clients
throughout the UI.

Global state belongs in `src/store/<domain>/`; domain components select from
stores through selectors such as `taskDetailSelectors` from
`src/store/task/selectors/detailSelectors.ts`.

---

## Naming Conventions

- React component files use PascalCase when they export a component, for example
  `TaskDetailPage.tsx`, `TaskDetailHeaderActions.tsx`, and
  `CreateTaskModal/index.tsx`.
- Feature domains use PascalCase folders, such as `src/features/AgentTasks/`.
- Route segments follow React Router/Next-style segment names, including
  dynamic segments like `src/routes/(main)/task/[taskId]/index.tsx`.
- Store domains use lower camel or lowercase folders, such as `src/store/task/`.
- Store slices live under `slices/<slice>/` with files such as `action.ts`,
  `index.ts`, `initialState.ts`, `reducer.ts`, and `*.test.ts`.
- Style helper modules are commonly named `style.ts`, as in
  `src/features/AgentTasks/shared/style.ts`.

---

## Router Sync Rule

When adding or changing desktop SPA routes, update both:

- `src/spa/router/desktopRouter.config.tsx`
- `src/spa/router/desktopRouter.config.desktop.tsx`

Keep paths and nesting aligned unless there is a documented intentional
divergence. `src/spa/router/desktopRouter.sync.test.tsx` compares route paths
and index route counts to catch blank-screen regressions.

---

## Examples

Use these as reference implementations:

- Thin route: `src/routes/(main)/task/[taskId]/index.tsx`
- Feature page: `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx`
- Feature entry point: `src/features/AgentTasks/index.tsx`
- Client service: `src/services/task.ts`
- Store entry point: `src/store/task/store.ts`
- Store selectors: `src/store/task/selectors/detailSelectors.ts`
- Router sync test: `src/spa/router/desktopRouter.sync.test.tsx`
