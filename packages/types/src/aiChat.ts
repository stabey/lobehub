import { z } from 'zod';

import type { UIChatMessage } from './message';
import type { MessageMetadata } from './message/common';
import { ChatToolPayloadSchema, MessageMetadataSchema } from './message/common';
import type { CreateMessageParams, PageSelection } from './message/ui/params';
import { PageSelectionSchema } from './message/ui/params';
import type { OpenAIChatMessage } from './openai/chat';
import type { LobeUniformTool } from './tool';
import { LobeUniformToolSchema } from './tool';
import type { ChatTopic, ChatTopicMetadata } from './topic';
import type { ChatThreadType } from './topic/thread';
import { ThreadType } from './topic/thread';

export interface SendNewMessage {
  content?: string;
  /** Lexical editor JSON state for rich text rendering */
  editorData?: Record<string, any>;
  // if message has attached with files, then add files to message and the agent
  files?: string[];
  /**
   * Server-side reference to an oversized message package uploaded in chunks.
   * When present, the server resolves content/editorData/files/pageSelections
   * before persisting the user message.
   */
  messagePackageRef?: MessagePackageRef;
  /** Page selections attached to this message (for Ask AI functionality) */
  pageSelections?: PageSelection[];
  parentId?: string;
}

export interface MessagePackageRef {
  id: string;
}

export interface SendPreloadMessage extends Omit<
  Pick<CreateMessageParams, 'content' | 'metadata' | 'plugin' | 'tool_call_id' | 'tools'>,
  'metadata'
> {
  metadata?: MessageMetadata;
  role: 'assistant' | 'tool';
}

/**
 * Parameters for creating a new thread along with message
 */
export interface CreateThreadWithMessageParams {
  /** Parent thread ID (for nested threads) */
  parentThreadId?: string;
  /** Source message ID that the thread is branched from (optional for standalone threads) */
  sourceMessageId?: string;
  /** Optional thread title */
  title?: string;
  /** Thread type */
  type: ChatThreadType;
}

export interface SendMessageServerParams {
  agentId?: string;
  /**
   * Group ID for group chat scenarios
   * Used to associate the topic with a specific group
   */
  groupId?: string;
  newAssistantMessage: {
    /**
     * Message metadata (e.g., isSupervisor for group orchestration)
     */
    metadata?: Record<string, unknown>;
    model?: string;
    provider: string;
  };
  /**
   * Optional: Create a new thread along with the message
   * If provided, the message will be created in the newly created thread
   */
  newThread?: CreateThreadWithMessageParams;
  newTopic?: {
    /**
     * Topic metadata persisted at creation time. For CC/heterogeneous
     * agents this carries `workingDirectory` so the topic is bound to a
     * project from the moment it's created (used by By-Project grouping
     * and CC `--resume` cwd verification), instead of waiting for the
     * post-execution metadata write which can be skipped on cancel/error.
     */
    metadata?: ChatTopicMetadata;
    title?: string;
    topicMessageIds?: string[];
    trigger?: string;
  };
  newUserMessage: SendNewMessage;
  preloadMessages?: SendPreloadMessage[];
  sessionId?: string;
  threadId?: string;
  // if there is activeTopicId, then add topicId to message
  topicId?: string;
}

export const CreateThreadWithMessageSchema = z.object({
  parentThreadId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  title: z.string().optional(),
  type: z.enum([ThreadType.Continuation, ThreadType.Standalone, ThreadType.Isolation]),
});

const SendPreloadMessageSchema = z.object({
  content: z.string(),
  metadata: MessageMetadataSchema.optional(),
  plugin: z
    .object({
      apiName: z.string(),
      arguments: z.string(),
      identifier: z.string(),
      type: z.string(),
    })
    .optional(),
  role: z.enum(['assistant', 'tool']),
  tool_call_id: z.string().optional(),
  tools: z.array(ChatToolPayloadSchema).optional(),
});

export const MessagePackageRefSchema = z.object({
  id: z.string(),
});

export const InlineSendNewMessageSchema = z.object({
  content: z.string(),
  editorData: z.record(z.unknown()).optional(),
  files: z.array(z.string()).optional(),
  pageSelections: z.array(PageSelectionSchema).optional(),
  parentId: z.string().optional(),
});

export const SendNewMessageSchema = z
  .object({
    content: z.string().optional(),
    editorData: z.record(z.unknown()).optional(),
    files: z.array(z.string()).optional(),
    messagePackageRef: MessagePackageRefSchema.optional(),
    pageSelections: z.array(PageSelectionSchema).optional(),
    parentId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.content === undefined && !value.messagePackageRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either content or messagePackageRef is required',
        path: ['content'],
      });
    }
  });

export const CreateMessagePackageSchema = z.object({
  byteLength: z.number().int().nonnegative().optional(),
  totalChunks: z.number().int().positive(),
});

export const AppendMessagePackageChunkSchema = z.object({
  chunk: z.string().min(1),
  id: z.string(),
  index: z.number().int().nonnegative(),
});

export const FinalizeMessagePackageSchema = z.object({
  id: z.string(),
});

export type CreateMessagePackageParams = z.infer<typeof CreateMessagePackageSchema>;
export type AppendMessagePackageChunkParams = z.infer<typeof AppendMessagePackageChunkSchema>;
export type FinalizeMessagePackageParams = z.infer<typeof FinalizeMessagePackageSchema>;

export const AiSendMessageServerSchema = z.object({
  agentId: z.string().optional(),
  groupId: z.string().optional(),
  newAssistantMessage: z.object({
    metadata: z.record(z.unknown()).optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
  newThread: CreateThreadWithMessageSchema.optional(),
  newTopic: z
    .object({
      metadata: z.custom<ChatTopicMetadata>().optional(),
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
      trigger: z.string().optional(),
    })
    .optional(),
  preloadMessages: z.array(SendPreloadMessageSchema).optional(),
  newUserMessage: SendNewMessageSchema,
  sessionId: z.string().optional(),
  threadId: z.string().optional(),
  topicId: z.string().optional(),
});

export interface SendMessageServerResponse {
  assistantMessageId: string;
  /**
   * If a new thread was created, this will be the thread ID
   */
  createdThreadId?: string;
  isCreateNewTopic: boolean;
  messages: UIChatMessage[];
  topicId: string;
  topics?: {
    items: ChatTopic[];
    total: number;
  };
  userMessageId: string;
}

export const StructureSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  schema: z.object({
    $defs: z.any().optional(),
    additionalProperties: z.boolean().optional(),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional(),
    type: z.literal('object'),
  }),
  strict: z.boolean().optional(),
});

export const StructureOutputSchema = z.object({
  messages: z.array(z.any()),
  model: z.string(),
  provider: z.string(),
  schema: StructureSchema.optional(),
  tools: z
    .array(z.object({ function: LobeUniformToolSchema, type: z.literal('function') }))
    .optional(),
});

interface IStructureSchema {
  description: string;
  name: string;
  schema: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
  strict?: boolean;
}

export interface StructureOutputParams {
  keyVaultsPayload: string;
  messages: OpenAIChatMessage[];
  model: string;
  provider: string;
  schema?: IStructureSchema;
  systemRole?: string;
  tools?: {
    function: LobeUniformTool;
    type: 'function';
  }[];
}
