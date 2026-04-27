import type {
  AppendMessagePackageChunkParams,
  CreateMessagePackageParams,
  FinalizeMessagePackageParams,
  SendMessageServerParams,
  StructureOutputParams,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';

import { lambdaClient } from '@/libs/trpc/client';

class AiChatService {
  appendMessagePackageChunk = async (
    params: AppendMessagePackageChunkParams,
    abortController?: AbortController,
  ) => {
    return lambdaClient.aiChat.appendMessagePackageChunk.mutate(params, {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  createMessagePackage = async (
    params: CreateMessagePackageParams,
    abortController?: AbortController,
  ) => {
    return lambdaClient.aiChat.createMessagePackage.mutate(params, {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  finalizeMessagePackage = async (
    params: FinalizeMessagePackageParams,
    abortController?: AbortController,
  ) => {
    return lambdaClient.aiChat.finalizeMessagePackage.mutate(params, {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  sendMessageInServer = async (
    params: SendMessageServerParams,
    abortController: AbortController,
  ) => {
    return lambdaClient.aiChat.sendMessageInServer.mutate(cleanObject(params), {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  generateJSON = async (params: StructureOutputParams, abortController: AbortController) => {
    return lambdaClient.aiChat.outputJSON.mutate(params, {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };
}

export const aiChatService = new AiChatService();
