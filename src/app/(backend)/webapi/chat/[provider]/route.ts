import type { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import type { ChatTransportRequest } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { resolveTransportRequest } from '@/server/services/chatTransport/resolveTransportRequest';
import { ChatTransportStageStoreError } from '@/server/services/chatTransport/stageStore';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    // ============  1. init chat model   ============ //
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider);

    // ============  2. create chat completion   ============ //

    const requestBody = (await req.json()) as ChatTransportRequest;
    const data = await resolveTransportRequest(requestBody, userId);

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    return await modelRuntime.chat(data, {
      user: userId,
      ...traceOptions,
      signal: req.signal,
    });
  } catch (e) {
    if (e instanceof ChatTransportStageStoreError) {
      const errorType =
        e.statusCode === 403
          ? ChatErrorType.Forbidden
          : e.statusCode === 404
            ? ChatErrorType.ContentNotFound
            : e.statusCode === 503
              ? ChatErrorType.ServiceUnavailable
              : ChatErrorType.BadRequest;

      return createErrorResponse(errorType, { error: e.message, provider });
    }

    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
    // track the error at server side
    // eslint-disable-next-line no-console
    console[logMethod](`Route: [${provider}] ${errorType}:`, error);

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
