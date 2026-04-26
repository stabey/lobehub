// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { ChatTransportStageStoreError } from '@/server/services/chatTransport/stageStore';

import { POST } from './route';

const mockCreateStage = vi.fn();

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/services/chatTransport/stageStore', () => {
  class MockChatTransportStageStoreError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ChatTransportStageStoreError';
      this.statusCode = statusCode;
    }
  }

  return {
    ChatTransportStageStore: vi.fn().mockImplementation(() => ({
      createStage: mockCreateStage,
    })),
    ChatTransportStageStoreError: MockChatTransportStageStoreError,
  };
});

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe('chat stage route', () => {
  let request: Request;

  beforeEach(() => {
    request = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({ messages: [], model: 'test-model', temperature: 1 }),
    });

    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {} as any,
      user: { id: 'test-user-id' } as any,
    });
    mockCreateStage.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a stage for a valid payload', async () => {
    mockCreateStage.mockResolvedValue({
      expiresAt: '2026-04-20T00:00:00.000Z',
      stageId: 'stage-123',
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mockCreateStage).toHaveBeenCalledWith({
      messages: [],
      model: 'test-model',
      temperature: 1,
    });
    expect(await response.json()).toEqual({
      expiresAt: '2026-04-20T00:00:00.000Z',
      stageId: 'stage-123',
    });
  });

  it('accepts payloads with missing or null temperature', async () => {
    mockCreateStage.mockResolvedValue({
      expiresAt: '2026-04-20T00:00:00.000Z',
      stageId: 'stage-456',
    });

    const requestWithoutTemperature = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({ messages: [], model: 'test-model' }),
    });
    const responseWithoutTemperature = await POST(requestWithoutTemperature, {
      params: Promise.resolve({}),
    });
    expect(responseWithoutTemperature.status).toBe(200);
    const argWithoutTemperature = mockCreateStage.mock.calls.at(-1)?.[0];
    expect(argWithoutTemperature).not.toHaveProperty('temperature');

    mockCreateStage.mockResolvedValue({
      expiresAt: '2026-04-20T00:00:00.000Z',
      stageId: 'stage-789',
    });
    const requestWithNullTemperature = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({ messages: [], model: 'test-model', temperature: null }),
    });
    const responseWithNullTemperature = await POST(requestWithNullTemperature, {
      params: Promise.resolve({}),
    });
    expect(responseWithNullTemperature.status).toBe(200);
    const argWithNullTemperature = mockCreateStage.mock.calls.at(-1)?.[0];
    expect(argWithNullTemperature).not.toHaveProperty('temperature');
  });

  it('strips other null sampling fields before staging', async () => {
    mockCreateStage.mockResolvedValue({
      expiresAt: '2026-04-20T00:00:00.000Z',
      stageId: 'stage-strip',
    });

    const requestWithNullSamplingFields = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({
        frequency_penalty: null,
        max_tokens: null,
        messages: [],
        model: 'test-model',
        n: null,
        presence_penalty: null,
        temperature: 0.7,
        top_p: null,
      }),
    });

    const response = await POST(requestWithNullSamplingFields, {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(200);
    const arg = mockCreateStage.mock.calls.at(-1)?.[0];
    expect(arg).toEqual({ messages: [], model: 'test-model', temperature: 0.7 });
    expect(arg).not.toHaveProperty('top_p');
    expect(arg).not.toHaveProperty('frequency_penalty');
    expect(arg).not.toHaveProperty('presence_penalty');
    expect(arg).not.toHaveProperty('max_tokens');
    expect(arg).not.toHaveProperty('n');
  });

  it('returns bad request for invalid staged payload', async () => {
    request = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({ model: 'test-model' }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      body: {
        error: 'Invalid staged chat payload',
      },
      errorType: 400,
    });
    expect(mockCreateStage).not.toHaveBeenCalled();
  });

  it('returns bad request for invalid json payload', async () => {
    request = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: '{',
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      body: {
        error: 'Invalid staged chat payload',
      },
      errorType: 400,
    });
    expect(mockCreateStage).not.toHaveBeenCalled();
  });

  it('returns payload too large for oversized requests', async () => {
    request = new Request(new URL('https://test.com'), {
      method: 'POST',
      body: JSON.stringify({
        messages: [],
        model: 'test-model',
        padding: 'x'.repeat(1024 * 1024),
        temperature: 1,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      body: {
        error: 'Chat transport payload must be 1048576 bytes or smaller',
      },
      errorType: 413,
    });
    expect(mockCreateStage).not.toHaveBeenCalled();
  });

  it('maps stage store errors to HTTP responses', async () => {
    mockCreateStage.mockImplementation(() => {
      throw new ChatTransportStageStoreError(503, 'Redis is unavailable');
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      body: {
        error: 'Redis is unavailable',
      },
      errorType: 503,
    });
  });
});
