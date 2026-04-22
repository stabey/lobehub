// @vitest-environment node
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import type { TopicItem } from '@lobechat/database/schemas';
import type {
  ChatStreamPayload,
  CompactTopicChatTransportRequest,
  UIChatMessage,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTransportRequest } from './resolveTransportRequest';
import { ChatTransportStageStoreError } from './stageStore';

const {
  mockCreateServerAgentToolsEngine,
  mockGenerateSkillSet,
  mockGenerateToolsDetailed,
  mockGetAgentConfigById,
  mockGetAgentDocuments,
  mockGetKlavisManifests,
  mockGetLobehubSkillManifests,
  mockGetMessagesAndTopics,
  mockGetUserSettings,
  mockQueryPlugins,
  mockResolveStage,
  mockServerMessagesEngine,
  mockStageStoreCtor,
  mockFindAllSkills,
  mockFindSkillByIdentifier,
  mockGetDocumentById,
  mockQueryMessages,
  mockFindTopicById,
  mockFindTopicDocuments,
} = vi.hoisted(() => ({
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockFindAllSkills: vi.fn(),
  mockFindSkillByIdentifier: vi.fn(),
  mockFindTopicDocuments: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockQueryMessages: vi.fn(),
  mockFindTopicById: vi.fn(),
  mockGenerateSkillSet: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetAgentConfigById: vi.fn(),
  mockGetAgentDocuments: vi.fn(),
  mockGetKlavisManifests: vi.fn(),
  mockGetLobehubSkillManifests: vi.fn(),
  mockGetMessagesAndTopics: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockQueryPlugins: vi.fn(),
  mockResolveStage: vi.fn(),
  mockServerMessagesEngine: vi.fn(),
  mockStageStoreCtor: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@lobechat/builtin-tools', () => ({
  builtinTools: [],
  manualModeExcludeToolIds: ['manual-excluded-tool'],
}));

vi.mock('@lobechat/context-engine', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    SkillEngine: vi.fn().mockImplementation(() => ({
      generate: mockGenerateSkillSet,
    })),
  };
});

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [
    {
      abilities: { functionCall: true },
      id: 'claude-sonnet-4-6',
      providerId: 'anthropic',
    },
    {
      abilities: { functionCall: true },
      id: 'gpt-4',
      providerId: 'openai',
    },
  ],
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn().mockImplementation(() => ({
    findAll: mockFindAllSkills,
    findByIdentifier: mockFindSkillByIdentifier,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: mockQueryPlugins,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    query: mockQueryMessages,
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: mockFindTopicById,
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn().mockImplementation(() => ({
    findByTopicId: mockFindTopicDocuments,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mockGetUserSettings,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  shouldEnableBuiltinSkill: vi.fn(() => true),
}));

vi.mock('@/server/modules/Mecha/AgentToolsEngine', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
}));

vi.mock('@/server/modules/Mecha/ContextEngineering', () => ({
  serverMessagesEngine: mockServerMessagesEngine,
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfigById: mockGetAgentConfigById,
  })),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    getAgentDocuments: mockGetAgentDocuments,
  })),
}));

vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({
    getMessagesAndTopics: mockGetMessagesAndTopics,
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: mockGetKlavisManifests,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: mockGetLobehubSkillManifests,
  })),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    getDocumentById: mockGetDocumentById,
  })),
}));

vi.mock('./stageStore', () => {
  class MockChatTransportStageStoreError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ChatTransportStageStoreError';
      this.statusCode = statusCode;
    }
  }

  return {
    ChatTransportStageStore: mockStageStoreCtor,
    ChatTransportStageStoreError: MockChatTransportStageStoreError,
  };
});

const serverDB = {} as any;

const toolManifest = {
  api: [{ description: 'Run plugin action', name: 'run', parameters: {} }],
  identifier: 'plugin-a',
  meta: { title: 'Plugin A' },
  type: 'default' as const,
};

const selectedToolManifest = {
  api: [{ description: 'Run plugin B action', name: 'runB', parameters: {} }],
  identifier: 'plugin-b',
  meta: { title: 'Plugin B' },
  type: 'default' as const,
};

const mentionEditorData = {
  root: {
    children: [
      {
        children: [
          {
            label: 'Agent B',
            metadata: { id: 'agent-b', type: 'agent' },
            type: 'mention',
          },
        ],
        type: 'paragraph',
      },
    ],
    type: 'root',
  },
};

const selectedToolEditorData = {
  root: {
    children: [
      {
        children: [
          {
            actionCategory: 'tool',
            actionLabel: 'Plugin B',
            actionType: 'plugin-b',
            type: 'action-tag',
          },
        ],
        type: 'paragraph',
      },
    ],
    type: 'root',
  },
};

const selectedSkillEditorData = {
  root: {
    children: [
      {
        children: [
          {
            actionCategory: 'skill',
            actionLabel: 'Skill B',
            actionType: 'skill-b',
            type: 'action-tag',
          },
        ],
        type: 'paragraph',
      },
    ],
    type: 'root',
  },
};

const lobehubSkillManifest = {
  api: [],
  identifier: 'lobehub-skill-provider',
  meta: { title: 'LobeHub Skill' },
  type: 'default' as const,
};

const klavisManifest = {
  api: [],
  identifier: 'klavis-provider',
  meta: { title: 'Klavis' },
  type: 'default' as const,
};

const rebuiltMessages = [
  { content: 'Rebuilt system prompt', role: 'system' as const },
  { content: 'Rebuilt user message', role: 'user' as const },
];

const createCompactRequest = (
  overrides: Partial<CompactTopicChatTransportRequest> = {},
): CompactTopicChatTransportRequest => {
  const { compact: compactOverrides, ...requestOverrides } = overrides;

  return {
    compact: {
      agentId: 'agent-1',
      assistantMessageId: 'assistant-1',
      scope: 'topic',
      threadId: 'thread-1',
      topicId: 'topic-1',
      userMessageId: 'user-1',
      version: 1,
      ...compactOverrides,
    },
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    stream: true,
    temperature: 0.6,
    transport: 'compact',
    ...requestOverrides,
  };
};

describe('resolveTransportRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockStageStoreCtor.mockImplementation(() => ({
      resolveStage: mockResolveStage,
    }));

    mockResolveStage.mockResolvedValue({
      messages: [],
      model: 'gpt-4',
      temperature: 1,
    } satisfies ChatStreamPayload);

    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: {
        enableHistoryCount: true,
        historyCount: 2,
        inputTemplate: 'Summarize {{input}}',
        skillActivateMode: 'manual',
      },
      files: [
        {
          content: 'File content',
          enabled: true,
          id: 'file-1',
          name: 'guide.md',
        },
      ],
      knowledgeBases: [
        {
          description: 'Knowledge base description',
          enabled: true,
          id: 'kb-1',
          name: 'Knowledge Base',
        },
      ],
      model: 'gpt-4',
      plugins: ['plugin-a'],
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Earlier question',
          createdAt: new Date(),
          id: 'prev-user',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: 'Earlier answer',
          createdAt: new Date(),
          id: 'prev-assistant',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: 'Latest question',
          createdAt: new Date(),
          editorData: null,
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });

    mockGetAgentDocuments.mockResolvedValue([
      {
        content: 'Agent document content',
        description: 'Agent document description',
        filename: 'agent.md',
        id: 'doc-1',
        loadRules: [],
        policyLoad: 'always',
        policyLoadFormat: 'raw',
        policyLoadPosition: 'system',
        title: 'Agent Doc',
      },
    ]);

    mockQueryPlugins.mockResolvedValue([
      {
        identifier: 'plugin-a',
        manifest: toolManifest,
        runtimeType: 'default',
        type: 'plugin',
      },
    ]);

    mockGetUserSettings.mockResolvedValue({
      general: { timezone: 'Asia/Shanghai' },
    });

    mockFindAllSkills.mockResolvedValue({
      data: [],
      total: 0,
    });
    mockFindSkillByIdentifier.mockResolvedValue(undefined);
    mockGetDocumentById.mockResolvedValue(undefined);
    mockFindTopicById.mockResolvedValue(null);
    mockFindTopicDocuments.mockResolvedValue([]);
    mockQueryMessages.mockResolvedValue([] as UIChatMessage[]);

    mockGetLobehubSkillManifests.mockResolvedValue([lobehubSkillManifest]);
    mockGetKlavisManifests.mockResolvedValue([klavisManifest]);

    mockGenerateSkillSet.mockReturnValue({ skills: [] });
    mockGenerateToolsDetailed.mockReturnValue({
      enabledManifests: [toolManifest],
      enabledToolIds: ['plugin-a'],
    });
    mockCreateServerAgentToolsEngine.mockReturnValue({
      generateToolsDetailed: mockGenerateToolsDetailed,
    });

    mockServerMessagesEngine.mockResolvedValue(rebuiltMessages);
  });

  it('should resolve staged requests through the user-scoped stage store', async () => {
    const result = await resolveTransportRequest(
      { stageId: 'stage-123', transport: 'staged' },
      { serverDB, userId: 'user-1' },
    );

    expect(mockStageStoreCtor).toHaveBeenCalledWith('user-1');
    expect(mockResolveStage).toHaveBeenCalledWith('stage-123');
    expect(result).toEqual({
      messages: [],
      model: 'gpt-4',
      temperature: 1,
    });
  });

  it('should rebuild compact requests from persisted topic state', async () => {
    const request = createCompactRequest();

    const result = await resolveTransportRequest(request, { serverDB, userId: 'user-1' });

    expect(mockGetAgentConfigById).toHaveBeenCalledWith('agent-1');
    expect(mockGetMessagesAndTopics).toHaveBeenCalledWith({
      agentId: 'agent-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        installedPlugins: [
          expect.objectContaining({
            identifier: 'plugin-a',
          }),
        ],
        isModelSupportToolUse: expect.any(Function),
      }),
      expect.objectContaining({
        additionalManifests: [lobehubSkillManifest, klavisManifest],
        agentConfig: {
          chatConfig: {
            enableHistoryCount: true,
            historyCount: 2,
            inputTemplate: 'Summarize {{input}}',
            skillActivateMode: 'manual',
          },
          plugins: ['plugin-a'],
        },
        globalMemoryEnabled: false,
        hasAgentDocuments: true,
        hasEnabledKnowledgeBases: true,
        isBotConversation: false,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
      }),
    );

    expect(mockGenerateToolsDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        toolIds: ['plugin-a'],
      }),
    );

    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocuments: [
          expect.objectContaining({
            content: 'Agent document content',
            filename: 'agent.md',
            id: 'doc-1',
          }),
        ],
        historyCount: 3,
        inputTemplate: 'Summarize {{input}}',
        knowledge: {
          fileContents: [
            {
              content: 'File content',
              fileId: 'file-1',
              filename: 'guide.md',
            },
          ],
          knowledgeBases: [
            {
              description: 'Knowledge base description',
              id: 'kb-1',
              name: 'Knowledge Base',
            },
          ],
        },
        messages: [
          expect.objectContaining({ id: 'prev-user' }),
          expect.objectContaining({ id: 'prev-assistant' }),
          expect.objectContaining({ id: 'user-1' }),
        ],
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        systemRole: 'You are a helpful assistant.',
        toolsConfig: {
          manifests: [toolManifest],
          tools: ['plugin-a'],
        },
        userTimezone: 'Asia/Shanghai',
      }),
    );

    expect(result).toEqual({
      messages: rebuiltMessages,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      stream: true,
      temperature: 0.6,
    });
  });

  it('should reconstruct GTD context from persisted plan documents in compact requests', async () => {
    const todos = {
      items: [{ status: 'todo', text: 'Implement compact parity' }],
      updatedAt: '2026-04-22T00:00:00.000Z',
    };

    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: {
        enableHistoryCount: true,
        historyCount: 2,
        inputTemplate: 'Summarize {{input}}',
        skillActivateMode: 'manual',
      },
      files: [
        {
          content: 'File content',
          enabled: true,
          id: 'file-1',
          name: 'guide.md',
        },
      ],
      knowledgeBases: [
        {
          description: 'Knowledge base description',
          enabled: true,
          id: 'kb-1',
          name: 'Knowledge Base',
        },
      ],
      model: 'gpt-4',
      plugins: ['plugin-a', GTDIdentifier],
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });
    mockFindTopicDocuments.mockResolvedValue([
      {
        content: 'Current GTD context',
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        id: 'plan-1',
        metadata: { todos },
        title: 'Ship transport migration',
        updatedAt: new Date('2026-04-22T00:00:00.000Z'),
      },
    ] as any);
    mockGenerateToolsDetailed.mockReturnValue({
      enabledManifests: [toolManifest],
      enabledToolIds: ['plugin-a', GTDIdentifier],
    } as any);

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    expect(mockFindTopicDocuments).toHaveBeenCalledWith('topic-1', { type: 'agent/plan' });
    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        gtd: {
          enabled: true,
          plan: expect.objectContaining({
            completed: false,
            context: 'Current GTD context',
            goal: 'Ship transport migration',
            id: 'plan-1',
          }),
          todos,
        },
      }),
    );
  });

  it('should omit GTD context when persisted plan lookup fails in compact requests', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: {
        enableHistoryCount: true,
        historyCount: 2,
        inputTemplate: 'Summarize {{input}}',
        skillActivateMode: 'manual',
      },
      files: [],
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [GTDIdentifier],
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });
    mockFindTopicDocuments.mockRejectedValue(new Error('lookup failed'));
    mockGenerateToolsDetailed.mockReturnValue({
      enabledManifests: [],
      enabledToolIds: [GTDIdentifier],
    });

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    const lastCall = mockServerMessagesEngine.mock.calls.at(-1)?.[0];

    expect(lastCall?.gtd).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should inject mention delegation context for compact requests without full agent management', async () => {
    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Earlier question',
          createdAt: new Date(),
          id: 'prev-user',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: 'Earlier answer',
          createdAt: new Date(),
          id: 'prev-assistant',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: 'Ask Agent B',
          createdAt: new Date(),
          editorData: mentionEditorData,
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });
    mockGenerateToolsDetailed.mockReturnValue({
      enabledManifests: [toolManifest, expect.anything()],
      enabledToolIds: ['plugin-a', AgentManagementIdentifier],
    } as any);

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        additionalManifests: expect.arrayContaining([
          lobehubSkillManifest,
          klavisManifest,
          expect.objectContaining({ identifier: AgentManagementIdentifier }),
        ]),
        agentConfig: expect.objectContaining({
          plugins: ['plugin-a', AgentManagementIdentifier],
        }),
      }),
    );

    expect(mockGenerateToolsDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: ['plugin-a', AgentManagementIdentifier],
      }),
    );

    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        agentManagementContext: {
          mentionedAgents: [{ id: 'agent-b', name: 'Agent B' }],
        },
      }),
    );
  });

  it('should include selected and activated tools from persisted state in compact requests', async () => {
    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Earlier question',
          createdAt: new Date(),
          id: 'prev-user',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: 'Earlier answer',
          createdAt: new Date(),
          id: 'prev-assistant',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: 'Activated Plugin C',
          createdAt: new Date(),
          id: 'tool-1',
          plugin: { identifier: 'lobe-activator' },
          pluginState: { activatedTools: [{ identifier: 'plugin-c' }] },
          role: 'tool',
          updatedAt: new Date(),
        },
        {
          content: 'Use Plugin B',
          createdAt: new Date(),
          editorData: selectedToolEditorData,
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });
    const activatedToolManifest = {
      api: [{ description: 'Run plugin C action', name: 'runC', parameters: {} }],
      identifier: 'plugin-c',
      meta: { title: 'Plugin C' },
      type: 'default' as const,
    };
    mockQueryPlugins.mockResolvedValue([
      {
        identifier: 'plugin-a',
        manifest: toolManifest,
        runtimeType: 'default',
        type: 'plugin',
      },
      {
        identifier: 'plugin-b',
        manifest: selectedToolManifest,
        runtimeType: 'default',
        type: 'plugin',
      },
      {
        identifier: 'plugin-c',
        manifest: activatedToolManifest,
        runtimeType: 'default',
        type: 'plugin',
      },
    ]);
    mockGenerateToolsDetailed.mockReturnValue({
      enabledManifests: [toolManifest, selectedToolManifest, activatedToolManifest],
      enabledToolIds: ['plugin-a', 'plugin-b', 'plugin-c'],
    });

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          plugins: ['plugin-a', 'plugin-b', 'plugin-c'],
        }),
      }),
    );

    expect(mockGenerateToolsDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: ['plugin-a', 'plugin-b', 'plugin-c'],
      }),
    );

    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTools: [
          expect.objectContaining({
            content: expect.stringContaining('Run plugin B action'),
            identifier: 'plugin-b',
            name: 'Plugin B',
          }),
        ],
        toolsConfig: {
          manifests: [toolManifest, selectedToolManifest, activatedToolManifest],
          tools: ['plugin-a', 'plugin-b', 'plugin-c'],
        },
      }),
    );
  });

  it('should include selected skills from persisted editorData in compact requests', async () => {
    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Earlier question',
          createdAt: new Date(),
          id: 'prev-user',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: 'Earlier answer',
          createdAt: new Date(),
          id: 'prev-assistant',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: 'Use Skill B',
          createdAt: new Date(),
          editorData: selectedSkillEditorData,
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });
    mockFindSkillByIdentifier.mockResolvedValue({
      content: 'Skill B instructions',
      id: 'skill-db-1',
      identifier: 'skill-b',
      manifest: null,
      name: 'Skill B',
      resources: null,
    });

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    expect(mockFindSkillByIdentifier).toHaveBeenCalledWith('skill-b');
    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedSkills: [
          expect.objectContaining({
            content: 'Skill B instructions',
            identifier: 'skill-b',
            name: 'Skill B',
          }),
        ],
      }),
    );
  });

  it('should inject persisted page editor context when compact request includes documentId', async () => {
    mockGetDocumentById.mockResolvedValue({
      content: '# Page Title\n\nDocument body',
      editorData: { root: { children: [], type: 'root' } },
      filename: 'page.md',
      title: 'Page Title',
      totalCharCount: 27,
      totalLineCount: 3,
    });

    await resolveTransportRequest(
      createCompactRequest({ compact: { documentId: 'doc-1' } as any }),
      { serverDB, userId: 'user-1' },
    );

    expect(mockGetDocumentById).toHaveBeenCalledWith('doc-1');
    expect(mockGenerateToolsDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolIds: expect.arrayContaining(['plugin-a', 'lobe-page-agent']),
      }),
    );
    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        enableHistoryCount: false,
        pageContentContext: expect.objectContaining({
          markdown: '# Page Title\n\nDocument body',
          metadata: expect.objectContaining({
            charCount: 27,
            lineCount: 3,
            title: 'Page Title',
          }),
          xml: '<root></root>',
        }),
        systemRole: expect.stringContaining('You are a helpful assistant.'),
      }),
    );
  });

  it('should resolve topic references from persisted messages in compact requests', async () => {
    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Earlier question',
          createdAt: new Date(),
          id: 'prev-user',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: 'Earlier answer',
          createdAt: new Date(),
          id: 'prev-assistant',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: '<refer_topic name="Referenced Topic" id="topic-ref" />\nTell me more',
          createdAt: new Date(),
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });
    mockFindTopicById.mockResolvedValue({
      historySummary: 'Referenced topic summary',
      id: 'topic-ref',
      title: 'Referenced Topic',
    } as TopicItem);

    await resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' });

    expect(mockFindTopicById).toHaveBeenCalledWith('topic-ref');
    expect(mockServerMessagesEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        topicReferences: [
          expect.objectContaining({
            summary: 'Referenced topic summary',
            topicId: 'topic-ref',
            topicTitle: 'Referenced Topic',
          }),
        ],
      }),
    );
    expect(mockQueryMessages).not.toHaveBeenCalled();
  });

  it('should reject compact requests when manual skill activation is disabled', async () => {
    mockGetAgentConfigById.mockResolvedValue({
      chatConfig: {
        skillActivateMode: 'auto',
      },
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
    });

    await expect(
      resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' }),
    ).rejects.toEqual(
      new ChatTransportStageStoreError(
        400,
        'Compact chat transport requires manual skill activation mode',
      ),
    );

    expect(mockServerMessagesEngine).not.toHaveBeenCalled();
  });

  it('should reject compact requests when the latest runtime message is not the referenced user message', async () => {
    mockGetMessagesAndTopics.mockResolvedValue({
      messages: [
        {
          content: 'Latest question',
          createdAt: new Date(),
          id: 'user-1',
          role: 'user',
          updatedAt: new Date(),
        },
        {
          content: '',
          createdAt: new Date(),
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          updatedAt: new Date(),
        },
        {
          content: 'Other assistant message',
          createdAt: new Date(),
          id: 'assistant-2',
          role: 'assistant',
          updatedAt: new Date(),
        },
      ],
    });

    await expect(
      resolveTransportRequest(createCompactRequest(), { serverDB, userId: 'user-1' }),
    ).rejects.toEqual(
      new ChatTransportStageStoreError(
        400,
        'Compact chat transport latest user message is invalid',
      ),
    );

    expect(mockServerMessagesEngine).not.toHaveBeenCalled();
  });
});
