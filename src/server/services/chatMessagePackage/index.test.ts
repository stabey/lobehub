// @vitest-environment node
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ChatMessagePackageService } from './index';

const createDb = (task: Record<string, any>) => {
  let currentTask = task;
  const findFirst = vi.fn(async () => currentTask);
  const where = vi.fn(async () => undefined);
  const set = vi.fn((value: Record<string, any>) => {
    currentTask = { ...currentTask, ...value };
    return { where };
  });
  const update = vi.fn(() => ({ set }));

  return {
    db: {
      query: { asyncTasks: { findFirst } },
      update,
    } as any,
    findFirst,
    getTask: () => currentTask,
    update,
  };
};

const createProcessingTask = (metadata: Record<string, any>) => ({
  id: 'pkg-1',
  metadata,
  status: AsyncTaskStatus.Processing,
  type: AsyncTaskType.ChatMessagePackage,
  userId: 'u1',
});

describe('ChatMessagePackageService', () => {
  it('rejects out-of-order chunks before corrupting package metadata', async () => {
    const { db, update } = createDb(
      createProcessingTask({
        chunks: [],
        totalChunks: 2,
      }),
    );
    const service = new ChatMessagePackageService(db, 'u1');

    await expect(service.appendChunk({ chunk: 'second', id: 'pkg-1', index: 1 })).rejects.toThrow(
      'Message package chunks must be appended in order',
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects finalize when a chunk is missing', async () => {
    const { db } = createDb(
      createProcessingTask({
        chunks: ['{"content":"hello"}'],
        totalChunks: 2,
      }),
    );
    const service = new ChatMessagePackageService(db, 'u1');

    await expect(service.finalize({ id: 'pkg-1' })).rejects.toThrow(
      'Message package chunk 1 is missing',
    );
  });

  it('rejects finalize when byte length does not match', async () => {
    const payload = JSON.stringify({ content: 'hello' });
    const { db } = createDb(
      createProcessingTask({
        byteLength: 1,
        chunks: [payload],
        totalChunks: 1,
      }),
    );
    const service = new ChatMessagePackageService(db, 'u1');

    await expect(service.finalize({ id: 'pkg-1' })).rejects.toThrow(
      'Message package byte length mismatch',
    );
  });

  it('finalizes and resolves a valid package', async () => {
    const payload = JSON.stringify({
      content: 'hello',
      editorData: { root: { children: [] } },
    });
    const { db, getTask } = createDb(
      createProcessingTask({
        byteLength: new TextEncoder().encode(payload).byteLength,
        chunks: [payload],
        totalChunks: 1,
      }),
    );
    const service = new ChatMessagePackageService(db, 'u1');

    await expect(service.finalize({ id: 'pkg-1' })).resolves.toEqual({ id: 'pkg-1' });

    expect(getTask()).toMatchObject({
      metadata: {
        package: {
          content: 'hello',
          editorData: { root: { children: [] } },
        },
      },
      status: AsyncTaskStatus.Success,
    });
    await expect(service.resolve({ id: 'pkg-1' })).resolves.toEqual({
      content: 'hello',
      editorData: { root: { children: [] } },
    });
  });
});
