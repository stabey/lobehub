# Component Guidelines

> How components are built in this project.

---

## Overview

Frontend components are React function components written in TypeScript. The
common stack is `@lobehub/ui`, antd, lucide icons, `antd-style`, and
react-i18next.

Representative examples:

- `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx`
- `src/features/AgentTasks/AgentTaskDetail/TaskDetailHeaderActions.tsx`
- `src/features/AgentTasks/CreateTaskModal/index.tsx`
- `src/features/AgentTasks/shared/style.ts`

---

## Component Structure

Most non-trivial components follow this shape:

1. Import UI primitives, icons, React hooks, routing hooks, services/stores, and
   feature-local components.
2. Define a local props interface when props are non-trivial.
3. Implement a function component wrapped in `memo`.
4. Select only the store state/actions the component needs.
5. Use `useCallback` and `useMemo` for callbacks and derived arrays passed to
   child components.
6. Export the memoized component as default or through a feature entry point.

`src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx` shows page
composition with `memo`, local `TaskDetailPageProps`, store selectors, effects,
and feature components. `src/features/AgentTasks/AgentTaskDetail/TaskDetailHeaderActions.tsx`
shows menu item creation with `useMemo` and delete confirmation with
`useCallback`.

---

## Props Conventions

- Use explicit props interfaces for exported components with meaningful props.
  Example: `TaskDetailPageProps` in
  `src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx`.
- Keep props local to the component unless they are shared by multiple modules.
- Prefer imported shared types from packages such as `@lobechat/types` when the
  data crosses feature or API boundaries.
- Avoid passing broad objects when a component only needs a few fields; select
  specific values from stores through selectors.

---

## Composition Patterns

Use existing project primitives before introducing new layout systems:

- `Flexbox` from `@lobehub/ui` is commonly used for layout.
- antd `App.useApp()` supplies `modal` and `message` where component-local
  feedback is needed.
- `ActionIcon`, `DropdownMenu`, `Icon`, `Hotkey`, and `copyToClipboard` from
  `@lobehub/ui` are used in action-heavy components such as
  `TaskDetailHeaderActions`.
- Shared app components such as `NavHeader`, `WideScreenContainer`,
  `ToggleRightPanelButton`, `AutoSaveHint`, and `BrandTextLoading` are reused
  in feature pages.

Feature pages should compose smaller feature components instead of embedding all
UI in one file. `TaskDetailPage.tsx` delegates to `TaskDetailTitleInput`,
`TaskDetailAssignee`, `TaskModelConfig`, `TaskDetailRunPauseAction`,
`TaskProperties`, `TaskInstruction`, `TaskSubtasks`, `TaskActivities`, and
`TopicChatDrawer`.

---

## Styling Patterns

Prefer `createStaticStyles` from `antd-style` with `cssVar.*` tokens for
CSS-in-JS. `src/features/AgentTasks/shared/style.ts` is a current example:

```ts
export const styles = createStaticStyles(({ css, cssVar }) => ({
  commentInputCard: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
  `,
}));
```

Use runtime `createStyles` and theme tokens only when styles genuinely need
runtime computation. Direct inline styles are still common for small layout
values with `Flexbox`, such as `style={{ minHeight: 0 }}` in
`TaskDetailPage.tsx`.

Keep layout-critical styles close to the feature domain when they are not
broadly reusable.

---

## Text And i18n

User-facing text should use react-i18next. `TaskDetailHeaderActions.tsx` calls
`useTranslation(['chat', 'common'])` and reads keys such as
`taskDetail.deleteConfirm.title` and `delete`.

Default locale namespace files live under `src/locales/default/*.ts`, for
example `src/locales/default/chat.ts`. For development preview, update
`locales/zh-CN/` and `locales/en-US/` when adding user-facing text.

Do not run `pnpm i18n`; project guidance says CI handles generated i18n output.

---

## Accessibility

Use library components that carry expected semantics where possible. For icon
actions, prefer `ActionIcon`, `Icon`, `DropdownMenu`, and lucide icons instead
of ad hoc SVG buttons. `TaskDetailHeaderActions.tsx` uses an icon-only
`ActionIcon` to open a dropdown whose menu items have text labels and icons.

When adding interactive controls, make sure the visible label, menu item text,
or tooltip communicates the action. Preserve keyboard hints where existing
components expose them, such as `Hotkey` in the task detail delete menu item.

---

## Common Mistakes

- Putting full page UI and business logic into `src/routes/**` instead of
  `src/features/**`.
- Adding inline user-facing strings without locale keys.
- Creating a new style system when `@lobehub/ui`, antd, and `antd-style` already
  cover the component.
- Using runtime styles for static token-based CSS that can be expressed with
  `createStaticStyles`.
