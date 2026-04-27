import {
  type AppendMessagePackageChunkParams,
  AppendMessagePackageChunkSchema,
  AsyncTaskStatus,
  AsyncTaskType,
  type CreateMessagePackageParams,
  CreateMessagePackageSchema,
  type FinalizeMessagePackageParams,
  FinalizeMessagePackageSchema,
  InlineSendNewMessageSchema,
  type MessagePackageRef,
  type SendNewMessage,
} from '@lobechat/types';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { asyncTasks } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

const encoder = new TextEncoder();
const PACKAGE_TTL_MS = 30 * 60 * 1000;

interface MessagePackageMetadata {
  byteLength?: number;
  chunks: string[];
  finalizedAt?: string;
  package?: SendNewMessage;
  totalChunks: number;
}

export class ChatMessagePackageService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (params: CreateMessagePackageParams) => {
    const input = CreateMessagePackageSchema.parse(params);
    await this.cleanupExpired();

    const [row] = await this.db
      .insert(asyncTasks)
      .values({
        metadata: {
          byteLength: input.byteLength,
          chunks: [],
          totalChunks: input.totalChunks,
        } satisfies MessagePackageMetadata,
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.ChatMessagePackage,
        userId: this.userId,
      })
      .returning({ id: asyncTasks.id });

    return { id: row.id };
  };

  appendChunk = async (params: AppendMessagePackageChunkParams) => {
    const input = AppendMessagePackageChunkSchema.parse(params);
    const task = await this.getOwnedPackage(input.id);
    const metadata = this.parseMetadata(task.metadata);

    if (task.status !== AsyncTaskStatus.Processing) {
      throw new Error('Message package is not accepting chunks');
    }
    if (input.index >= metadata.totalChunks) {
      throw new Error('Message package chunk index is out of range');
    }
    if (input.index > metadata.chunks.length) {
      throw new Error('Message package chunks must be appended in order');
    }

    const chunks = [...metadata.chunks];
    const existing = chunks[input.index];
    if (existing !== undefined && existing !== input.chunk) {
      throw new Error('Message package chunk index already contains different content');
    }

    chunks[input.index] = input.chunk;

    await this.db
      .update(asyncTasks)
      .set({
        metadata: { ...metadata, chunks } satisfies MessagePackageMetadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(asyncTasks.id, input.id),
          eq(asyncTasks.userId, this.userId),
          eq(asyncTasks.type, AsyncTaskType.ChatMessagePackage),
        ),
      );

    return { success: true };
  };

  finalize = async (params: FinalizeMessagePackageParams) => {
    const input = FinalizeMessagePackageSchema.parse(params);
    const task = await this.getOwnedPackage(input.id);
    const metadata = this.parseMetadata(task.metadata);

    if (task.status !== AsyncTaskStatus.Processing) {
      throw new Error('Message package has already been finalized');
    }

    const chunks = Array.from({ length: metadata.totalChunks }, (_, index) => {
      const chunk = metadata.chunks[index];
      if (typeof chunk !== 'string') throw new Error(`Message package chunk ${index} is missing`);
      return chunk;
    });

    const rawPackage = chunks.join('');
    if (
      metadata.byteLength !== undefined &&
      encoder.encode(rawPackage).byteLength !== metadata.byteLength
    ) {
      throw new Error('Message package byte length mismatch');
    }

    const parsedPackage = InlineSendNewMessageSchema.parse(JSON.parse(rawPackage));

    await this.db
      .update(asyncTasks)
      .set({
        metadata: {
          byteLength: metadata.byteLength,
          chunks,
          finalizedAt: new Date().toISOString(),
          package: parsedPackage,
          totalChunks: metadata.totalChunks,
        } satisfies MessagePackageMetadata,
        status: AsyncTaskStatus.Success,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(asyncTasks.id, input.id),
          eq(asyncTasks.userId, this.userId),
          eq(asyncTasks.type, AsyncTaskType.ChatMessagePackage),
        ),
      );

    return { id: input.id };
  };

  resolve = async (ref: MessagePackageRef): Promise<SendNewMessage> => {
    const task = await this.getOwnedPackage(ref.id);
    const metadata = this.parseMetadata(task.metadata);

    if (task.status !== AsyncTaskStatus.Success || !metadata.package) {
      throw new Error('Message package has not been finalized');
    }

    return metadata.package;
  };

  private cleanupExpired = async () => {
    await this.db
      .delete(asyncTasks)
      .where(
        and(
          eq(asyncTasks.userId, this.userId),
          eq(asyncTasks.type, AsyncTaskType.ChatMessagePackage),
          lt(asyncTasks.updatedAt, new Date(Date.now() - PACKAGE_TTL_MS)),
        ),
      );
  };

  private getOwnedPackage = async (id: string) => {
    const task = await this.db.query.asyncTasks.findFirst({
      where: and(
        eq(asyncTasks.id, id),
        eq(asyncTasks.userId, this.userId),
        eq(asyncTasks.type, AsyncTaskType.ChatMessagePackage),
      ),
    });

    if (!task) throw new Error('Message package not found');
    return task;
  };

  private parseMetadata = (metadata: unknown): MessagePackageMetadata => {
    return z
      .object({
        byteLength: z.number().int().nonnegative().optional(),
        chunks: z.array(z.string()),
        finalizedAt: z.string().optional(),
        package: InlineSendNewMessageSchema.optional(),
        totalChunks: z.number().int().positive(),
      })
      .parse(metadata);
  };
}
