# Backend Development Guidelines

> Current backend conventions for LobeHub.

---

## Overview

LobeHub backend code is split between Next.js route handlers, tRPC routers,
backend services/modules, and the shared database package. These guides document
the conventions currently present in the repository so Trellis agents can match
the existing code style.

---

## Guidelines Index

| Guide                                           | Description                         | Status    |
| ----------------------------------------------- | ----------------------------------- | --------- |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Populated |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations   | Populated |
| [Error Handling](./error-handling.md)           | Error types, handling strategies    | Populated |
| [Quality Guidelines](./quality-guidelines.md)   | Code standards, forbidden patterns  | Populated |
| [Logging Guidelines](./logging-guidelines.md)   | Structured logging, log levels      | Populated |

---

## Pre-Development Checklist

Before changing backend code, read the specific guide that matches the work:

- API routes or tRPC routers: [Directory Structure](./directory-structure.md)
  and [Error Handling](./error-handling.md).
- Database schemas, models, repositories, or migrations:
  [Database Guidelines](./database-guidelines.md).
- Backend services/modules, async jobs, or runtime behavior:
  [Quality Guidelines](./quality-guidelines.md) and
  [Logging Guidelines](./logging-guidelines.md).

All documentation in this directory is written in English and references real
repository paths.

Example backend paths covered by these guides include
`src/server/routers/lambda/brief.ts`, `src/server/services/brief/index.ts`,
`src/app/(backend)/api/agent/run/route.ts`, and
`packages/database/src/models/brief.ts`.
