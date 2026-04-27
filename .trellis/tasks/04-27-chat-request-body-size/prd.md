# Reduce Chat Request Body Size

## Goal

Optimize the frontend-to-backend interaction for chat so normal conversation requests do not fail under a strict outbound request body limit. The immediate constraint is a gateway limit that can be treated as roughly 1 KB per request body for frontend-to-backend traffic. Backend-to-frontend streaming responses are not currently constrained.

## What I Already Know

- The main failing path is ordinary chat in Client mode.
- The frontend currently builds the model-ready message context in `src/services/chat/index.ts` with `contextEngineering`, then sends `JSON.stringify(payload)` to `/webapi/chat/[provider]`.
- The backend route `src/app/(backend)/webapi/chat/[provider]/route.ts` reads `req.json()` as `ChatStreamPayload` and forwards it directly to `modelRuntime.chat`.
- The body can grow with `messages`, injected system/context content, tools, multimodal file URLs, topic references, memory, selected skills/tools, and history.
- `aiChat.sendMessageInServer` already persists the new user and assistant messages before local agent execution starts. The later `/webapi/chat/[provider]` call duplicates conversation context already available server-side.
- A compact LLM reference payload alone does not solve the case where the new user message package itself is larger than the gateway body limit, because `aiChat.sendMessageInServer` currently sends `newUserMessage.content`, `editorData`, and `pageSelections` in the request body.
- Gateway mode already has a thinner frontend request (`prompt`, `fileIds`, app context), because execution happens on the backend. It is not the default path for ordinary Client mode.
- File upload flows mostly pass file IDs after upload; they should be checked, but they are not the primary source of the oversized chat request body.

## Requirements

- Reduce the ordinary chat LLM request body from complete model context to a compact server-resolvable reference.
- Handle oversized single user messages by avoiding a one-shot request body containing the full content package (`content`, `editorData`, page selections, and injected selected skill/tool context).
- Preserve existing chat behavior: streaming, cancellation, tool calls, context compression, topic creation, thread handling, group chat, and selected skill/tool context.
- Keep the optimization focused on chat interactions and avoid broad rewrites of unrelated small request bodies.
- Keep backend response behavior unchanged unless an implementation detail requires a small compatible adjustment.
- Add tests around the new compact request contract and route-side reconstruction.

## Acceptance Criteria

- [ ] A normal follow-up chat request no longer sends the full `messages` array from browser to `/webapi/chat/[provider]`.
- [ ] The compact frontend request contains only small metadata such as provider/model/options and identifiers needed to resolve context server-side.
- [ ] If the current user message package exceeds the configured safe payload threshold, the frontend stores it through a chunked/reference flow before final send, so no single frontend-to-backend request body contains the full large message.
- [ ] `sendMessageInServer` can persist a user message from either inline content fields or a server-side message package reference.
- [ ] The backend reconstructs model messages from persisted conversation state and existing server-side context engineering utilities before calling `modelRuntime.chat`.
- [ ] Existing direct `ChatStreamPayload` behavior is preserved or explicitly migrated for non-chat preset tasks that already have small bodies.
- [ ] Unit tests cover compact payload handling, legacy payload handling or migration behavior, and route auth/error behavior.
- [ ] No large file content/base64 data is introduced into new frontend-to-backend chat request bodies.

## Brainstorm

### Approach A: Add a Compact Chat Reference Payload (Recommended)

- How it works: after `sendMessageInServer` persists the user/assistant messages, frontend calls `/webapi/chat/[provider]` with a compact payload containing identifiers such as `agentId`, `topicId`, `threadId`, `groupId`, `assistantMessageId`, `parentMessageId`, plus model/provider/options. The backend loads messages from DB, applies server-side context engineering, then calls `modelRuntime.chat`.
- Pros: directly targets the failing request; preserves current frontend runtime and SSE route; lowest behavioral blast radius compared with moving all runtime to Gateway mode.
- Cons: server route must gain enough context reconstruction logic and tests; frontend/client and server context engineering parity must be checked carefully. Does not by itself solve an oversized current user message.

### Approach A2: Chunked Message Package Reference (Recommended Add-on)

- How it works: for a message package above a conservative threshold, frontend creates a server-side message package draft/reference using multiple small chunk requests, then calls `sendMessageInServer` with `messagePackageRef` instead of inline `content`/`editorData`/`pageSelections`. The backend assembles/validates the package and persists the user message from the reference.
- Pros: solves single-message overflow while keeping short messages simple; works with a per-request body limit; creates a reusable pattern for chat-adjacent long text without changing every API.
- Cons: requires temporary content storage, cleanup/TTL, ordering/integrity checks, and additional tests. The chunk envelope must be small enough that each chunk request stays safely below 1 KB.

### Approach B: Route Ordinary Chat Through Existing Server Agent Runtime

- How it works: enable a Gateway-like backend execution path for ordinary web chat so frontend sends only prompt/file IDs/app context and receives stream events.
- Pros: already solves request size structurally and centralizes execution on server.
- Cons: much larger product/runtime change; impacts WebSocket/gateway availability, tool execution, reconnection, and user lab toggle behavior. Too broad for this task unless we intentionally promote Gateway mode.

### Approach C: Compress or Trim the Existing JSON Payload

- How it works: reduce `messages`, strip fields, gzip JSON, or enforce stronger frontend history limits before POST.
- Pros: easiest mechanically.
- Cons: not robust under a 1 KB limit; can break context quality; gzip may not help if gateway counts decompressed or disallows compression. This is a fallback only, not a durable interface fix.

## Recommended MVP

Use Approach A plus A2 for ordinary chat Client mode:

- Add a compact request shape for `/webapi/chat/[provider]`.
- Add a chunked message-package-reference path for oversized current user messages before `sendMessageInServer`.
- Keep inline message content for short messages to avoid unnecessary multi-request overhead.
- Keep direct model-ready payload support only where the body is inherently small or needed for preset/internal calls.
- Reuse existing server-side `serverMessagesEngine` and DB message loading instead of duplicating client `contextEngineering`.
- Do not optimize unrelated small TRPC calls in this task.
- Review file-upload-related chat paths for accidental base64/full content in request bodies, but only fix concrete chat-adjacent offenders.

## Follow-up Plan

1. Define shared compact chat request and message package reference types/schemas.
2. Add a backend message-package-reference flow for oversized current message data: create/init reference, append small chunks, finalize/validate, and resolve by id during `sendMessageInServer`.
3. Add a backend resolver that loads persisted messages for `{agentId, groupId, topicId, threadId}`, resolves agent config and tools, runs `serverMessagesEngine`, then calls `modelRuntime.chat`.
4. Update ordinary chat flow to use inline content below the threshold, content references above the threshold, and compact LLM requests after `sendMessageInServer`; keep preset task helpers on the existing direct payload path unless they are chat-sized.
5. Add focused tests for long-message chunking, `sendMessageInServer` contentRef handling, route payload discrimination, server reconstruction, and frontend request body shape.
6. Inspect chat-adjacent file paths for raw base64/full-content payloads and fix only confirmed oversized requests.

## Out of Scope

- Replacing all Client mode execution with Gateway mode.
- General-purpose request compression middleware.
- Global API payload auditing for every route.
- Changing backend-to-frontend stream response format.
- Reworking the file upload pipeline unless inspection finds chat sends raw file/base64 content after upload.

## Technical Notes

- Branch: `feat/slim-chat-requests`.
- Main frontend LLM POST: `src/services/chat/index.ts`.
- Main backend LLM POST route: `src/app/(backend)/webapi/chat/[provider]/route.ts`.
- Chat lifecycle persists messages first in `src/store/chat/slices/aiChat/actions/conversationLifecycle.ts` via `aiChatService.sendMessageInServer`.
- Server-side message/context processing exists at `src/server/modules/Mecha/ContextEngineering/index.ts`.
- Server agent runtime already demonstrates DB-backed context rebuilding in `src/server/modules/AgentRuntime/RuntimeExecutors.ts`.
- Message querying with file URL post-processing exists in `packages/database/src/models/message.ts`.

## Open Questions

- None. User confirmed Approach A + A2 on 2026-04-27.

## Decision (ADR-lite)

**Context**: The current chat flow can exceed the frontend-to-backend gateway body limit in two places: persisted user message creation and the later LLM request containing full conversation context.

**Decision**: Implement a two-part chat payload reduction:

- For ordinary chat LLM calls, send a compact server-resolvable request and reconstruct model messages on the backend.
- For oversized current user messages, upload the message package through small chunks and pass a server-side `messagePackageRef` into `sendMessageInServer`.

**Consequences**: Short messages keep the simple inline path. Long messages require a temporary package/reference lifecycle with validation and cleanup. Gateway mode remains out of scope for this task.

## Definition of Done

- Tests added or updated for affected frontend service and backend route behavior.
- Type-check and focused tests pass.
- Any interface contract changes are reflected in shared types.
- Rollback path is clear: legacy direct payload route remains available or the new path is isolated behind a small helper.
