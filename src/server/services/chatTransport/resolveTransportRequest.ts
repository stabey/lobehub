import type { ChatStreamPayload, ChatTransportRequest } from '@lobechat/types';

import { ChatTransportStageStore } from './stageStore';

const isStagedTransportRequest = (
  request: ChatTransportRequest,
): request is Extract<ChatTransportRequest, { transport: 'staged' }> => {
  return 'transport' in request && request.transport === 'staged';
};

export const resolveTransportRequest = async (
  request: ChatTransportRequest,
  userId: string,
): Promise<ChatStreamPayload> => {
  if (!isStagedTransportRequest(request)) {
    return request;
  }

  const stageStore = new ChatTransportStageStore(userId);
  return stageStore.resolveStage(request.stageId);
};
