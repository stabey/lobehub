import type { ChatStreamPayload } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { getChatTransportConfig } from '@/envs/chat';
import { getRedisConfig } from '@/envs/redis';
import {
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';

export class ChatTransportStageStoreError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ChatTransportStageStoreError';
    this.statusCode = statusCode;
  }
}

interface StagedChatPayloadEnvelope {
  payload: ChatStreamPayload;
}

export class ChatTransportStageStore {
  constructor(private readonly userId: string) {}

  private getStageKey = (stageId: string) => {
    return RedisKeys.lobechat.chatTransportStage(this.userId, stageId);
  };

  private async getRedisOrThrow() {
    const transportConfig = getChatTransportConfig();
    if (!transportConfig.enabled) {
      throw new ChatTransportStageStoreError(503, 'Staged chat transport is disabled');
    }

    const redisConfig = getRedisConfig();
    if (!isRedisEnabled(redisConfig)) {
      throw new ChatTransportStageStoreError(503, 'Redis is unavailable');
    }

    const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.LOBEHUB);
    if (!redis) {
      throw new ChatTransportStageStoreError(503, 'Redis is unavailable');
    }

    return redis;
  }

  createStage = async (payload: ChatStreamPayload) => {
    const redis = await this.getRedisOrThrow();
    const transportConfig = getChatTransportConfig();
    const stageId = `chat_stage_${nanoid(16)}`;
    const key = this.getStageKey(stageId);

    const envelope: StagedChatPayloadEnvelope = {
      payload,
    };

    await redis.setex(key, transportConfig.ttlSeconds, JSON.stringify(envelope));

    return {
      expiresAt: new Date(Date.now() + transportConfig.ttlSeconds * 1000).toISOString(),
      stageId,
    };
  };

  resolveStage = async (stageId: string): Promise<ChatStreamPayload> => {
    const redis = await this.getRedisOrThrow();
    const key = this.getStageKey(stageId);
    const raw = await redis.get(key);

    if (!raw) {
      throw new ChatTransportStageStoreError(404, 'Chat transport stage not found or expired');
    }

    let envelope: StagedChatPayloadEnvelope;
    try {
      envelope = JSON.parse(raw) as StagedChatPayloadEnvelope;
    } catch {
      throw new ChatTransportStageStoreError(400, 'Invalid staged chat payload');
    }

    return envelope.payload;
  };
}
