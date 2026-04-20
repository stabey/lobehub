import type { ChatStreamPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatTransportStageStore, ChatTransportStageStoreError } from './stageStore';

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
};

vi.mock('@/envs/chat', () => ({
  getChatTransportConfig: vi.fn(() => ({ enabled: true, ttlSeconds: 300 })),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn(() => ({
    enabled: true,
    prefix: 'lobechat',
    tls: false,
    url: 'redis://localhost',
  })),
}));

vi.mock('@/libs/redis', () => ({
  initializeRedisWithPrefix: vi.fn(async () => mockRedis),
  isRedisEnabled: vi.fn(() => true),
  RedisKeyNamespace: { LOBEHUB: 'lobechat' },
  RedisKeys: {
    lobechat: {
      chatTransportStage: (userId: string, stageId: string) =>
        `chat_transport_stage:${userId}:${stageId}`,
    },
  },
}));

describe('ChatTransportStageStore', () => {
  const payload: ChatStreamPayload = {
    messages: [],
    model: 'test-model',
    temperature: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a stage using a user-scoped key', async () => {
    mockRedis.setex.mockResolvedValue('OK');

    const store = new ChatTransportStageStore('user-1');
    const result = await store.createStage(payload);

    expect(result.stageId).toMatch(/^chat_stage_/);
    expect(result.expiresAt).toBeTruthy();
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^chat_transport_stage:user-1:chat_stage_/),
      300,
      JSON.stringify({ payload }),
    );
  });

  it('resolves a stage for the current user key', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ payload }));

    const store = new ChatTransportStageStore('user-1');
    await expect(store.resolveStage('chat_stage_123')).resolves.toEqual(payload);
    expect(mockRedis.get).toHaveBeenCalledWith('chat_transport_stage:user-1:chat_stage_123');
  });

  it('returns not found when another user resolves the same stage id', async () => {
    mockRedis.get.mockResolvedValue(null);

    const store = new ChatTransportStageStore('user-2');

    await expect(store.resolveStage('chat_stage_123')).rejects.toEqual(
      new ChatTransportStageStoreError(404, 'Chat transport stage not found or expired'),
    );
    expect(mockRedis.get).toHaveBeenCalledWith('chat_transport_stage:user-2:chat_stage_123');
  });
});
