// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AgentGroupService } from '@/server/services/agentGroup';
import { FileService } from '@/server/services/file';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';

import { resolveChatStreamPayload } from './index';

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));
vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn(),
}));
vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(),
}));
vi.mock('@/server/services/agentGroup', () => ({
  AgentGroupService: vi.fn(),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn(),
}));
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(),
}));
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn(),
}));
vi.mock('@/server/modules/Mecha/ContextEngineering', () => ({
  serverMessagesEngine: vi.fn(),
}));
vi.mock('@lobechat/context-engine', () => ({
  AGENT_DOCUMENT_INJECTION_POSITIONS: [],
  generateToolsFromManifest: vi.fn().mockReturnValue([]),
  resolveTopicReferences: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [],
}));

describe('resolveChatStreamPayload', () => {
  it('returns legacy payloads unchanged', async () => {
    const payload = { messages: [], model: 'gpt-4o' } as any;

    await expect(
      resolveChatStreamPayload({ db: {} as any, payload, provider: 'openai', userId: 'u1' }),
    ).resolves.toBe(payload);
  });

  it('reconstructs compact payload messages from persisted chat state', async () => {
    const queryMessages = vi.fn().mockResolvedValue([
      { content: 'hello', id: 'm-user', role: 'user' },
      { content: 'loading', id: 'm-assistant', role: 'assistant' },
    ]);
    const getAgentConfigById = vi.fn().mockResolvedValue({
      chatConfig: { enableHistoryCount: true, historyCount: 8 },
      files: [],
      knowledgeBases: [],
      model: 'gpt-4o',
      plugins: ['plugin-1'],
      provider: 'openai',
      systemRole: 'You are helpful',
    });

    vi.mocked(AgentModel).mockImplementation(() => ({ getAgentConfigById }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ query: queryMessages }) as any);
    vi.mocked(PluginModel).mockImplementation(
      () => ({ query: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(UserModel).mockImplementation(
      () => ({ getUserSettings: vi.fn().mockResolvedValue({ memory: { enabled: false } }) }) as any,
    );
    vi.mocked(UserPersonaModel).mockImplementation(
      () => ({ getLatestPersonaDocument: vi.fn() }) as any,
    );
    vi.mocked(AgentDocumentsService).mockImplementation(
      () => ({ getAgentDocuments: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn(async (path) => path ?? '') }) as any,
    );
    vi.mocked(MarketService).mockImplementation(
      () => ({ getLobehubSkillManifests: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(KlavisService).mockImplementation(
      () => ({ getKlavisManifests: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(createServerAgentToolsEngine).mockReturnValue({
      generateToolsDetailed: vi.fn().mockReturnValue({
        enabledManifests: [{ identifier: 'plugin-1' }],
        enabledToolIds: ['plugin-1'],
        tools: [{ function: { name: 'plugin-1____call' }, type: 'function' }],
      }),
    } as any);
    vi.mocked(serverMessagesEngine).mockResolvedValue([
      { content: 'processed', role: 'user' },
    ] as any);

    const result = await resolveChatStreamPayload({
      db: {} as any,
      payload: {
        chatRef: {
          agentId: 'agent-1',
          assistantMessageId: 'm-assistant',
          parentMessageId: 'm-user',
          topicId: 'topic-1',
        },
        compact: true,
        model: 'gpt-4o',
        parentMessageId: 'top-level-legacy',
      },
      provider: 'openai',
      userId: 'u1',
    } as any);

    expect(queryMessages).toHaveBeenCalledWith(
      { agentId: 'agent-1', groupId: undefined, threadId: undefined, topicId: 'topic-1' },
      expect.any(Object),
    );
    expect(serverMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        historyCount: 9,
        messages: [{ content: 'hello', id: 'm-user', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
        systemRole: 'You are helpful',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        messages: [{ content: 'processed', role: 'user' }],
        model: 'gpt-4o',
        tools: [{ function: { name: 'plugin-1____call' }, type: 'function' }],
      }),
    );
    expect(result).not.toHaveProperty('compact');
    expect(result).not.toHaveProperty('chatRef');
    expect(result).not.toHaveProperty('parentMessageId');
  });

  it('uses the active conversation branch before reconstructing compact payloads', async () => {
    const queryMessages = vi.fn().mockResolvedValue([
      {
        content: 'regenerate this answer',
        createdAt: 1,
        id: 'm-user',
        metadata: { activeBranchIndex: 1 },
        role: 'user',
        updatedAt: 1,
      },
      {
        content: 'inactive old answer',
        createdAt: 2,
        id: 'm-old-assistant',
        parentId: 'm-user',
        role: 'assistant',
        updatedAt: 2,
      },
      {
        content: 'loading',
        createdAt: 3,
        id: 'm-assistant',
        parentId: 'm-user',
        role: 'assistant',
        updatedAt: 3,
      },
    ]);

    vi.mocked(MessageModel).mockImplementation(() => ({ query: queryMessages }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn(async (path) => path ?? '') }) as any,
    );

    const result = await resolveChatStreamPayload({
      db: {} as any,
      payload: {
        chatRef: {
          assistantMessageId: 'm-assistant',
          topicId: 'topic-1',
        },
        compact: true,
        model: 'gpt-4o',
      },
      provider: 'openai',
      userId: 'u1',
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        content: 'regenerate this answer',
        id: 'm-user',
        role: 'user',
      }),
    ]);
    expect(result.messages).not.toContainEqual(expect.objectContaining({ id: 'm-old-assistant' }));
  });

  it('passes group identity and mentioned agents into server context engineering', async () => {
    const queryMessages = vi.fn().mockResolvedValue([
      { content: 'ask designer', id: 'm-user', role: 'user' },
      { content: 'loading', id: 'm-assistant', role: 'assistant' },
    ]);
    const getAgentConfigById = vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      knowledgeBases: [],
      model: 'gpt-4o',
      plugins: [],
      provider: 'openai',
    });
    const getGroupDetail = vi.fn().mockResolvedValue({
      agents: [
        { id: 'agent-1', isSupervisor: true, title: 'Supervisor' },
        { id: 'agent-2', isSupervisor: false, title: 'Designer' },
      ],
      content: 'Coordinate as a group',
      title: 'Design Group',
    });

    vi.mocked(AgentModel).mockImplementation(() => ({ getAgentConfigById }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ query: queryMessages }) as any);
    vi.mocked(PluginModel).mockImplementation(
      () => ({ query: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(UserModel).mockImplementation(
      () => ({ getUserSettings: vi.fn().mockResolvedValue({ memory: { enabled: false } }) }) as any,
    );
    vi.mocked(UserPersonaModel).mockImplementation(
      () => ({ getLatestPersonaDocument: vi.fn() }) as any,
    );
    vi.mocked(AgentDocumentsService).mockImplementation(
      () => ({ getAgentDocuments: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(AgentGroupService).mockImplementation(() => ({ getGroupDetail }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn(async (path) => path ?? '') }) as any,
    );
    vi.mocked(MarketService).mockImplementation(
      () => ({ getLobehubSkillManifests: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(KlavisService).mockImplementation(
      () => ({ getKlavisManifests: vi.fn().mockResolvedValue([]) }) as any,
    );
    vi.mocked(createServerAgentToolsEngine).mockReturnValue({
      generateToolsDetailed: vi.fn().mockReturnValue({
        enabledManifests: [],
        enabledToolIds: [],
        tools: [],
      }),
    } as any);
    vi.mocked(serverMessagesEngine).mockResolvedValue([
      { content: 'processed', role: 'user' },
    ] as any);

    await resolveChatStreamPayload({
      db: {} as any,
      payload: {
        chatRef: {
          agentId: 'agent-1',
          assistantMessageId: 'm-assistant',
          groupId: 'group-1',
          initialContext: {
            mentionedAgents: [{ id: 'agent-2', name: 'Designer' }],
          },
        },
        compact: true,
        model: 'gpt-4o',
      },
      provider: 'openai',
      userId: 'u1',
    });

    expect(getGroupDetail).toHaveBeenCalledWith('group-1');
    expect(serverMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        agentGroup: expect.objectContaining({
          currentAgentId: 'agent-1',
          currentAgentName: 'Supervisor',
          currentAgentRole: 'supervisor',
          groupTitle: 'Design Group',
          members: [
            { id: 'agent-1', name: 'Supervisor', role: 'supervisor' },
            { id: 'agent-2', name: 'Designer', role: 'participant' },
          ],
          systemPrompt: 'Coordinate as a group',
        }),
        agentManagementContext: {
          mentionedAgents: [{ id: 'agent-2', name: 'Designer' }],
        },
      }),
    );
  });
});
