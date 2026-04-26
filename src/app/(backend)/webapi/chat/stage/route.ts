import type { ChatStreamPayload } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { z } from 'zod';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import {
  ChatTransportStageStore,
  ChatTransportStageStoreError,
} from '@/server/services/chatTransport/stageStore';
import { createErrorResponse } from '@/utils/errorResponse';

const MAX_STAGED_CHAT_PAYLOAD_BYTES = 1024 * 1024;

const stagedChatPayloadSchema = z
  .object({
    messages: z.array(z.any()),
    model: z.string().min(1),
    temperature: z.number().nullish(),
  })
  .passthrough();

/**
 * Sampling fields that providers reject when they receive `null`.
 * The client can serialize unset agent params as `null`; once that lands in
 * Redis via JSON.stringify, downstream provider calls see `"key": null` and
 * 400. Strip `null` here so the persisted payload simply omits the key.
 */
const NULLABLE_SAMPLING_FIELDS = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'n',
] as const;

const stripNullSamplingFields = <T extends Record<string, unknown>>(payload: T): T => {
  const next: Record<string, unknown> = { ...payload };
  for (const field of NULLABLE_SAMPLING_FIELDS) {
    if (next[field] === null) {
      delete next[field];
    }
  }
  return next as T;
};

const mapStageStoreErrorType = (statusCode: number) => {
  switch (statusCode) {
    case 400: {
      return ChatErrorType.BadRequest;
    }
    case 403: {
      return ChatErrorType.Forbidden;
    }
    case 404: {
      return ChatErrorType.ContentNotFound;
    }
    case 503: {
      return ChatErrorType.ServiceUnavailable;
    }
    default: {
      return ChatErrorType.InternalServerError;
    }
  }
};

export const POST = checkAuth(async (req, { userId }) => {
  try {
    const rawPayload = await req.text();

    if (new TextEncoder().encode(rawPayload).byteLength > MAX_STAGED_CHAT_PAYLOAD_BYTES) {
      return createErrorResponse(ChatErrorType.PayloadTooLarge, {
        error: `Chat transport payload must be ${MAX_STAGED_CHAT_PAYLOAD_BYTES} bytes or smaller`,
      });
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      return createErrorResponse(ChatErrorType.BadRequest, {
        error: 'Invalid staged chat payload',
      });
    }

    const result = stagedChatPayloadSchema.safeParse(parsedPayload);

    if (!result.success) {
      return createErrorResponse(ChatErrorType.BadRequest, {
        error: 'Invalid staged chat payload',
      });
    }

    const payload = stripNullSamplingFields(result.data) as ChatStreamPayload;

    const store = new ChatTransportStageStore(userId);
    const stageResult = await store.createStage(payload);

    return Response.json(stageResult);
  } catch (error) {
    if (error instanceof ChatTransportStageStoreError) {
      return createErrorResponse(mapStageStoreErrorType(error.statusCode), {
        error: error.message,
      });
    }

    console.error('Chat transport stage route error:', error);
    return createErrorResponse(ChatErrorType.InternalServerError, { error });
  }
});
