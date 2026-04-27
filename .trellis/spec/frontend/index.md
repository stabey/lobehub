# Frontend Development Guidelines

> Current frontend conventions for LobeHub.

---

## Overview

LobeHub uses Next.js 16, React 19, TypeScript, a Vite-powered SPA inside
Next.js, `react-router-dom`, `@lobehub/ui`, antd, lucide icons, `antd-style`,
react-i18next, Zustand, and SWR.

These guides document the patterns currently used in the repository. They are
intended for Trellis agents and contributors who need to match existing code.

---

## Guidelines Index

| Guide                                             | Description                             | Status    |
| ------------------------------------------------- | --------------------------------------- | --------- |
| [Directory Structure](./directory-structure.md)   | Module organization and file layout     | Populated |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition  | Populated |
| [Hook Guidelines](./hook-guidelines.md)           | Custom hooks, data fetching patterns    | Populated |
| [State Management](./state-management.md)         | Local state, global state, server state | Populated |
| [Quality Guidelines](./quality-guidelines.md)     | Code standards, forbidden patterns      | Populated |
| [Type Safety](./type-safety.md)                   | Type patterns, validation               | Populated |

---

## Pre-Development Checklist

Before changing frontend code, read the specific guide that matches the work:

- SPA routes or feature placement:
  [Directory Structure](./directory-structure.md).
- React UI, component composition, or styling:
  [Component Guidelines](./component-guidelines.md).
- Custom hooks or SWR data fetching:
  [Hook Guidelines](./hook-guidelines.md).
- Zustand stores, selectors, reducers, or optimistic updates:
  [State Management](./state-management.md).
- Shared types, props, service payloads, or runtime validation:
  [Type Safety](./type-safety.md).
- Tests, i18n, accessibility, or review checks:
  [Quality Guidelines](./quality-guidelines.md).

All documentation in this directory is written in English and references real
repository paths.

Example frontend paths covered by these guides include
`src/routes/(main)/task/[taskId]/index.tsx`,
`src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx`,
`src/services/task.ts`, and `src/store/task/store.ts`.
