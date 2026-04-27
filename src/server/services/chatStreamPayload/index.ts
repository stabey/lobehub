import type {
  AgentContextDocument,
  AgentGroupConfig,
  LobeToolManifest,
} from '@lobechat/context-engine';
import {
  AGENT_DOCUMENT_INJECTION_POSITIONS,
  generateToolsFromManifest,
  resolveTopicReferences,
} from '@lobechat/context-engine';
import { parse } from '@lobechat/conversation-flow';
import type {
  ChatCompletionTool,
  ChatStreamPayload,
  ChatStreamRequestPayload,
  CompactChatStreamPayload,
  UIChatMessage,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import type { LobeChatDatabase } from '@/database/type';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AgentGroupService } from '@/server/services/agentGroup';
import { FileService } from '@/server/services/file';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';

const VALID_DOCUMENT_POSITIONS = new Set<AgentContextDocument['loadPosition']>(
  AGENT_DOCUMENT_INJECTION_POSITIONS,
);
const DEFAULT_TEMPERATURE = 1;

const normalizeDocumentPosition = (
  position: string | null | undefined,
): AgentContextDocument['loadPosition'] | undefined => {
  if (!position) return undefined;
  return VALID_DOCUMENT_POSITIONS.has(position as AgentContextDocument['loadPosition'])
    ? (position as AgentContextDocument['loadPosition'])
    : undefined;
};

const hasTextContent = (message: UIChatMessage, pattern: string) =>
  typeof message.content === 'string' && message.content.includes(pattern);

const dedupeBy = <T>(items: T[], getKey: (item: T) => string | undefined): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
};

export const isCompactChatStreamPayload = (
  payload: ChatStreamRequestPayload,
): payload is CompactChatStreamPayload =>
  !!payload &&
  typeof payload === 'object' &&
  (payload as CompactChatStreamPayload).compact === true &&
  !!(payload as CompactChatStreamPayload).chatRef?.assistantMessageId;

export interface ResolveChatStreamPayloadParams {
  db: LobeChatDatabase;
  payload: ChatStreamRequestPayload;
  provider: string;
  userId: string;
}

export const resolveChatStreamPayload = async ({
  db,
  payload,
  provider,
  userId,
}: ResolveChatStreamPayloadParams): Promise<ChatStreamPayload> => {
  if (!isCompactChatStreamPayload(payload)) return payload;

  const service = new ChatStreamPayloadService(db, userId);
  return service.resolveCompactPayload(payload, provider);
};

class ChatStreamPayloadService {
  private readonly agentDocumentsService: AgentDocumentsService;
  private readonly agentGroupService: AgentGroupService;
  private readonly agentModel: AgentModel;
  private readonly db: LobeChatDatabase;
  private readonly fileService: FileService;
  private readonly marketService: MarketService;
  private readonly messageModel: MessageModel;
  private readonly pluginModel: PluginModel;
  private readonly topicModel: TopicModel;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.agentDocumentsService = new AgentDocumentsService(db, userId);
    this.agentGroupService = new AgentGroupService(db, userId);
    this.agentModel = new AgentModel(db, userId);
    this.fileService = new FileService(db, userId);
    this.marketService = new MarketService({ userInfo: { userId } });
    this.messageModel = new MessageModel(db, userId);
    this.pluginModel = new PluginModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
  }

  resolveCompactPayload = async (
    payload: CompactChatStreamPayload,
    routeProvider: string,
  ): Promise<ChatStreamPayload> => {
    const {
      chatRef,
      compact: _compact,
      parentMessageId: _parentMessageId,
      ...modelPayload
    } = payload as CompactChatStreamPayload & { parentMessageId?: string };
    const agentConfig = chatRef.agentId
      ? await this.agentModel.getAgentConfigById(chatRef.agentId)
      : null;
    const model = modelPayload.model ?? agentConfig?.model;
    const provider = modelPayload.provider ?? agentConfig?.provider ?? routeProvider;

    if (!model) throw new Error('Compact chat payload is missing model');
    if (!provider) throw new Error('Compact chat payload is missing provider');

    const messages = await this.loadMessages(payload);
    const messagesForEngine = this.resolveMessagesForEngine(messages, chatRef.assistantMessageId);

    if (!agentConfig) {
      return {
        ...modelPayload,
        messages: messagesForEngine as ChatStreamPayload['messages'],
        model,
        temperature: modelPayload.temperature ?? DEFAULT_TEMPERATURE,
      };
    }

    const userRuntimeSettings = await this.resolveUserRuntimeSettings(agentConfig);
    const { enabledManifests, enabledToolIds, tools } = await this.resolveTools({
      agentConfig,
      model,
      payload,
      provider,
      userMemoryEnabled: userRuntimeSettings.memoryEnabled,
    });
    const agentDocuments = await this.resolveAgentDocuments(chatRef.agentId);
    const agentGroup = await this.resolveAgentGroup(chatRef);
    const agentManagementContext = chatRef.initialContext?.mentionedAgents?.length
      ? { mentionedAgents: chatRef.initialContext.mentionedAgents }
      : undefined;
    const topicReferences = await this.resolveTopicReferences(messagesForEngine);

    const processedMessages = await serverMessagesEngine({
      agentDocuments,
      agentGroup,
      agentManagementContext,
      capabilities: await this.resolveModelCapabilities(),
      enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
      historyCount: (agentConfig.chatConfig?.historyCount ?? 20) + 1,
      initialContext: chatRef.initialContext,
      inputTemplate: agentConfig.chatConfig?.inputTemplate,
      knowledge: {
        fileContents: agentConfig.files
          ?.filter((file: { enabled?: boolean | null }) => file.enabled === true)
          .map((file: { content?: string | null; id?: string; name?: string }) => ({
            content: file.content ?? '',
            fileId: file.id ?? '',
            filename: file.name ?? '',
          })),
        knowledgeBases: agentConfig.knowledgeBases
          ?.filter((knowledgeBase: { enabled?: boolean | null }) => knowledgeBase.enabled === true)
          .map((knowledgeBase: { id?: string; name?: string }) => ({
            id: knowledgeBase.id ?? '',
            name: knowledgeBase.name ?? '',
          })),
      },
      messages: messagesForEngine,
      model,
      provider,
      stepContext: chatRef.stepContext,
      systemRole: agentConfig.systemRole ?? undefined,
      toolsConfig: {
        manifests: enabledManifests,
        tools: enabledToolIds,
      },
      topicReferences,
      userMemory: userRuntimeSettings.userMemory,
      userTimezone: userRuntimeSettings.timezone,
    });

    return {
      ...modelPayload,
      messages: processedMessages,
      model,
      temperature: modelPayload.temperature ?? DEFAULT_TEMPERATURE,
      tools,
    };
  };

  private loadMessages = async (payload: CompactChatStreamPayload) => {
    const { agentId, groupId, threadId, topicId } = payload.chatRef;

    return this.messageModel.query(
      { agentId, groupId, threadId, topicId },
      { postProcessUrl: (path) => this.fileService.getFullFileUrl(path) },
    );
  };

  private resolveMessagesForEngine = (
    messages: UIChatMessage[],
    assistantMessageId: string,
  ): UIChatMessage[] => {
    const { flatList } = parse(messages);

    return flatList.filter((message) => message.id !== assistantMessageId) as UIChatMessage[];
  };

  private resolveAgentDocuments = async (
    agentId?: string,
  ): Promise<AgentContextDocument[] | undefined> => {
    if (!agentId) return;

    try {
      const docs = await this.agentDocumentsService.getAgentDocuments(agentId);
      if (docs.length === 0) return;

      return docs.map((doc) => ({
        content: doc.content,
        description: doc.description ?? undefined,
        filename: doc.filename,
        id: doc.id,
        loadPosition: normalizeDocumentPosition(
          doc.policy?.context?.position || doc.policyLoadPosition,
        ),
        loadRules: doc.loadRules,
        policyId: doc.templateId,
        policyLoad: doc.policyLoad as 'always' | 'progressive',
        policyLoadFormat: doc.policy?.context?.policyLoadFormat || doc.policyLoadFormat,
        title: doc.title,
      }));
    } catch (error) {
      console.error('[chatStreamPayload] Failed to resolve agent documents:', error);
      return;
    }
  };

  private resolveAgentGroup = async (
    chatRef: CompactChatStreamPayload['chatRef'],
  ): Promise<AgentGroupConfig | undefined> => {
    if (!chatRef.groupId) return;

    const groupDetail = await this.agentGroupService.getGroupDetail(chatRef.groupId);
    if (!groupDetail?.agents?.length) return;

    const agentMap: AgentGroupConfig['agentMap'] = {};
    const members: AgentGroupConfig['members'] = [];
    let currentAgentName: string | undefined;
    let currentAgentRole: 'supervisor' | 'participant' | undefined;

    for (const agent of groupDetail.agents) {
      const role = agent.isSupervisor ? 'supervisor' : 'participant';
      const name = agent.title || 'Untitled Agent';

      agentMap[agent.id] = { name, role };
      members.push({ id: agent.id, name, role });

      if (chatRef.agentId && agent.id === chatRef.agentId) {
        currentAgentName = name;
        currentAgentRole = role;
      }
    }

    return {
      agentMap,
      currentAgentId: chatRef.agentId,
      currentAgentName,
      currentAgentRole,
      groupTitle: groupDetail.title || undefined,
      members,
      systemPrompt: groupDetail.content || undefined,
    };
  };

  private resolveModelCapabilities = async () => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    return {
      isCanUseFC: (model: string, provider: string) => {
        const info = LOBE_DEFAULT_MODEL_LIST.find(
          (item) => item.id === model && item.providerId === provider,
        );
        return info?.abilities?.functionCall ?? true;
      },
      isCanUseVideo: (model: string, provider: string) => {
        const info = LOBE_DEFAULT_MODEL_LIST.find(
          (item) => item.id === model && item.providerId === provider,
        );
        return info?.abilities?.video ?? false;
      },
      isCanUseVision: (model: string, provider: string) => {
        const info =
          LOBE_DEFAULT_MODEL_LIST.find(
            (item) => item.id === model && item.providerId === provider,
          ) ?? LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === model);
        return info?.abilities?.vision ?? false;
      },
    };
  };

  private resolveTools = async ({
    agentConfig,
    model,
    payload,
    provider,
    userMemoryEnabled,
  }: {
    agentConfig: NonNullable<Awaited<ReturnType<AgentModel['getAgentConfigById']>>>;
    model: string;
    payload: CompactChatStreamPayload;
    provider: string;
    userMemoryEnabled: boolean;
  }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const installedPlugins = await this.pluginModel.query();
    const additionalManifests = await this.resolveAdditionalManifests();

    const isModelSupportToolUse = (candidateModel: string, candidateProvider: string) => {
      const info = LOBE_DEFAULT_MODEL_LIST.find(
        (item) => item.id === candidateModel && item.providerId === candidateProvider,
      );
      return info?.abilities?.functionCall ?? true;
    };

    const activatedToolIds = payload.chatRef.stepContext?.activatedToolIds ?? [];
    const toolIds = [...new Set([...(agentConfig.plugins ?? []), ...activatedToolIds])];
    const toolsEngine = createServerAgentToolsEngine(
      { installedPlugins, isModelSupportToolUse },
      {
        additionalManifests,
        agentConfig: {
          chatConfig: agentConfig.chatConfig ?? undefined,
          plugins: toolIds,
        },
        globalMemoryEnabled: userMemoryEnabled,
        hasAgentDocuments: !!payload.chatRef.agentId,
        hasEnabledKnowledgeBases:
          agentConfig.knowledgeBases?.some(
            (knowledgeBase: { enabled?: boolean | null }) => knowledgeBase.enabled === true,
          ) ?? false,
        model,
        provider,
      },
    );

    const generated = toolsEngine.generateToolsDetailed({
      model,
      provider,
      toolIds,
    });
    const injectedManifests = payload.chatRef.initialContext?.injectedManifests as
      | LobeToolManifest[]
      | undefined;
    const injectedTools = injectedManifests?.flatMap((manifest) =>
      generateToolsFromManifest(manifest),
    );

    return {
      enabledManifests: dedupeBy(
        [...generated.enabledManifests, ...(injectedManifests ?? [])],
        (manifest) => manifest.identifier,
      ),
      enabledToolIds: [
        ...new Set([
          ...generated.enabledToolIds,
          ...(injectedManifests ?? []).map((manifest) => manifest.identifier),
        ]),
      ],
      tools: dedupeBy(
        [...(generated.tools ?? []), ...(injectedTools ?? [])],
        (tool: ChatCompletionTool) => tool.function?.name,
      ),
    };
  };

  private resolveAdditionalManifests = async (): Promise<LobeToolManifest[]> => {
    const klavisService = new KlavisService({ db: this.db, userId: this.userId });
    const [lobehubSkillManifests, klavisManifests] = await Promise.all([
      this.marketService.getLobehubSkillManifests().catch((error) => {
        console.error('[chatStreamPayload] Failed to resolve LobeHub skill manifests:', error);
        return [];
      }),
      klavisService.getKlavisManifests().catch((error) => {
        console.error('[chatStreamPayload] Failed to resolve Klavis manifests:', error);
        return [];
      }),
    ]);

    return [...lobehubSkillManifests, ...klavisManifests];
  };

  private resolveTopicReferences = async (messages: UIChatMessage[]) => {
    const alreadyHasTopicRefs = messages.some((message) =>
      hasTextContent(message, 'topic_reference_context'),
    );
    if (alreadyHasTopicRefs) return;

    return resolveTopicReferences(
      messages,
      (topicId) => this.topicModel.findById(topicId),
      async (topicId) => {
        const topic = await this.topicModel.findById(topicId);
        return this.messageModel.query(
          {
            agentId: topic?.agentId ?? undefined,
            groupId: topic?.groupId ?? undefined,
            topicId,
          },
          { postProcessUrl: (path) => this.fileService.getFullFileUrl(path) },
        );
      },
    );
  };

  private resolveUserRuntimeSettings = async (
    agentConfig: NonNullable<Awaited<ReturnType<AgentModel['getAgentConfigById']>>>,
  ) => {
    const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
    let memoryEnabled = agentMemoryEnabled ?? false;
    let timezone: string | undefined;

    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      const memorySettings = settings?.memory as { enabled?: boolean } | undefined;
      memoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;
      timezone = (settings?.general as { timezone?: string } | undefined)?.timezone;
    } catch (error) {
      console.error('[chatStreamPayload] Failed to resolve user settings:', error);
    }

    if (!memoryEnabled) return { memoryEnabled, timezone };

    try {
      const personaModel = new UserPersonaModel(this.db, this.userId);
      const persona = await personaModel.getLatestPersonaDocument();

      return {
        memoryEnabled,
        timezone,
        userMemory: persona?.persona
          ? {
              fetchedAt: Date.now(),
              memories: {
                contexts: [],
                experiences: [],
                persona: {
                  narrative: persona.persona,
                  tagline: persona.tagline,
                },
                preferences: [],
              },
            }
          : undefined,
      };
    } catch (error) {
      console.error('[chatStreamPayload] Failed to resolve user memory:', error);
      return { memoryEnabled, timezone };
    }
  };
}
