// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { resolveChatStreamPayload } from '@/server/services/chatStreamPayload';

import { POST } from './route';

vi.mock('@lobechat/model-runtime', () => ({
  AGENT_RUNTIME_ERROR_SET: new Set(),
  AgentRuntimeError: {
    createError: vi.fn((errorType) => ({ errorType })),
  },
  AgentRuntimeErrorType: {
    AccountDeactivated: 'AccountDeactivated',
    AgentRuntimeError: 'AgentRuntimeError',
    ExceededContextWindow: 'ExceededContextWindow',
    InsufficientQuota: 'InsufficientQuota',
    InvalidProviderAPIKey: 'InvalidProviderAPIKey',
    LocationNotSupportError: 'LocationNotSupportError',
    ModelNotFound: 'ModelNotFound',
    NoOpenAIAPIKey: 'NoOpenAIAPIKey',
    OllamaBizError: 'OllamaBizError',
    OllamaServiceUnavailable: 'OllamaServiceUnavailable',
    ProviderBizError: 'ProviderBizError',
    QuotaLimitReached: 'QuotaLimitReached',
  },
}));

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('@/server/services/chatStreamPayload', () => ({
  resolveChatStreamPayload: vi.fn(async ({ payload }) => payload),
}));

vi.mock('@/utils/trace', () => ({
  getTracePayload: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
  vi.mocked(resolveChatStreamPayload).mockImplementation(async ({ payload }) => payload as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid session', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
      const mockRuntime = {
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        mockRuntime as unknown as Awaited<ReturnType<typeof initModelRuntimeFromDB>>,
      );

      await POST(request as unknown as Request, { params: mockParams });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'test-user-id',
        'test-provider',
      );
    });

    it('should return Unauthorized error when no session exists', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(401);
    });
  });

  describe('chat', () => {
    it('should correctly handle chat completion with valid payload', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockChatResponse: any = { success: true, message: 'Reply from agent' };
      const mockRuntime = {
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        mockRuntime as unknown as Awaited<ReturnType<typeof initModelRuntimeFromDB>>,
      );

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(mockRuntime.chat).toHaveBeenCalledWith(mockChatPayload, {
        user: 'test-user-id',
        signal: expect.anything(),
      });
    });

    it('should reconstruct compact chat payload before calling model runtime', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const compactPayload = {
        chatRef: { assistantMessageId: 'm-assistant', topicId: 'topic-1' },
        compact: true,
        model: 'test-model',
      };
      const resolvedPayload = {
        messages: [{ content: 'resolved from db', role: 'user' }],
        model: 'test-model',
      };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(compactPayload),
      });

      const mockChatResponse: any = { success: true };
      const mockRuntime = {
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(resolveChatStreamPayload).mockResolvedValue(resolvedPayload as any);
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        mockRuntime as unknown as Awaited<ReturnType<typeof initModelRuntimeFromDB>>,
      );

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(resolveChatStreamPayload).toHaveBeenCalledWith({
        db: expect.anything(),
        payload: compactPayload,
        provider: 'test-provider',
        userId: 'test-user-id',
      });
      expect(mockRuntime.chat).toHaveBeenCalledWith(resolvedPayload, {
        user: 'test-user-id',
        signal: expect.anything(),
      });
    });

    it('should return an error response when chat completion fails', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockErrorResponse = {
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'Something went wrong', errorType: 500 },
        errorMessage: 'Something went wrong',
      };

      const mockRuntime = {
        chat: vi.fn().mockRejectedValue(mockErrorResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        mockRuntime as unknown as Awaited<ReturnType<typeof initModelRuntimeFromDB>>,
      );

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          errorMessage: 'Something went wrong',
          error: {
            errorMessage: 'Something went wrong',
            errorType: 500,
          },
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });
  });
});
