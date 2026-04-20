import { builtinSkills } from '@lobechat/builtin-skills';
import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';
import type {
  ChatStreamPayload,
  ChatTransportRequest,
  CompactTopicChatTransportRequest,
} from '@lobechat/types';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import type { AgentDocumentWithRules } from '@/database/models/agentDocuments';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { PluginModel } from '@/database/models/plugin';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha/AgentToolsEngine';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AiChatService } from '@/server/services/aiChat';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';

import { ChatTransportStageStore, ChatTransportStageStoreError } from './stageStore';

interface ResolveTransportRequestOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

const isCompactTransportRequest = (
  request: ChatTransportRequest,
): request is CompactTopicChatTransportRequest => {
  return 'transport' in request && request.transport === 'compact';
};

const isStagedTransportRequest = (
  request: ChatTransportRequest,
): request is Extract<ChatTransportRequest, { transport: 'staged' }> => {
  return 'transport' in request && request.transport === 'staged';
};

const mapAgentDocuments = (documents: AgentDocumentWithRules[]) => {
  return documents.map((document) => ({
    content: document.content,
    description: document.description ?? undefined,
    filename: document.filename,
    id: document.id,
    loadPosition: document.policyLoadPosition as any,
    loadRules: document.loadRules,
    policyLoad: document.policyLoad,
    policyLoadFormat: document.policyLoadFormat,
    title: document.title,
  }));
};

const resolveCompactTransportRequest = async (
  request: CompactTopicChatTransportRequest,
  { serverDB, userId }: ResolveTransportRequestOptions,
): Promise<ChatStreamPayload> => {
  const { compact } = request;

  if (compact.scope !== 'topic' || compact.version !== 1) {
    throw new ChatTransportStageStoreError(400, 'Unsupported compact chat transport request');
  }

  const aiChatService = new AiChatService(serverDB, userId);
  const agentService = new AgentService(serverDB, userId);
  const agentDocumentsService = new AgentDocumentsService(serverDB, userId);
  const pluginModel = new PluginModel(serverDB, userId);
  const userModel = new UserModel(serverDB, userId);
  const agentSkillModel = new AgentSkillModel(serverDB, userId);
  const marketService = new MarketService({ userInfo: { userId } });
  const klavisService = new KlavisService({ db: serverDB, userId });

  const [
    agentConfig,
    { messages },
    agentDocuments,
    installedPlugins,
    userSettings,
    { data: dbSkills },
    lobehubSkillManifests,
    klavisManifests,
  ] = await Promise.all([
    agentService.getAgentConfigById(compact.agentId),
    aiChatService.getMessagesAndTopics({
      agentId: compact.agentId,
      threadId: compact.threadId,
      topicId: compact.topicId,
    }),
    agentDocumentsService.getAgentDocuments(compact.agentId),
    pluginModel.query(),
    userModel.getUserSettings(),
    agentSkillModel.findAll(),
    marketService.getLobehubSkillManifests().catch(() => [] as LobeToolManifest[]),
    klavisService.getKlavisManifests().catch(() => [] as LobeToolManifest[]),
  ]);

  if (!agentConfig?.model || !agentConfig.provider) {
    throw new ChatTransportStageStoreError(404, 'Compact chat transport agent not found');
  }

  if (agentConfig.chatConfig?.skillActivateMode !== 'manual') {
    throw new ChatTransportStageStoreError(
      400,
      'Compact chat transport requires manual skill activation mode',
    );
  }

  const userMessage = messages.find(
    (message) => message.id === compact.userMessageId && message.role === 'user',
  );
  const assistantMessage = messages.find(
    (message) => message.id === compact.assistantMessageId && message.role === 'assistant',
  );

  if (!userMessage || !assistantMessage) {
    throw new ChatTransportStageStoreError(404, 'Compact chat transport messages not found');
  }

  if (assistantMessage.parentId !== userMessage.id) {
    throw new ChatTransportStageStoreError(
      400,
      'Compact chat transport message linkage is invalid',
    );
  }

  const runtimeMessages = messages.filter((message) => message.id !== compact.assistantMessageId);

  if (runtimeMessages.at(-1)?.id !== compact.userMessageId) {
    throw new ChatTransportStageStoreError(
      400,
      'Compact chat transport latest user message is invalid',
    );
  }

  const generalSettings = userSettings?.general as { timezone?: string } | undefined;
  const userTimezone = generalSettings?.timezone;
  const agentPlugins = agentConfig.plugins ?? [];
  const hasEnabledKnowledgeBases =
    agentConfig.knowledgeBases?.some((knowledgeBase) => knowledgeBase.enabled === true) ?? false;
  const { compact: _compact, transport: _transport, ...payload } = request;
  const model = payload.model ?? agentConfig.model;
  const provider = payload.provider ?? agentConfig.provider;

  const isModelSupportToolUse = (model: string, provider: string) => {
    const info = LOBE_DEFAULT_MODEL_LIST.find(
      (item) => item.id === model && item.providerId === provider,
    );

    return info?.abilities?.functionCall ?? true;
  };

  const toolsEngine = createServerAgentToolsEngine(
    {
      installedPlugins,
      isModelSupportToolUse,
    },
    {
      additionalManifests: [...lobehubSkillManifests, ...klavisManifests],
      agentConfig: {
        chatConfig: agentConfig.chatConfig ?? undefined,
        plugins: agentPlugins,
      },
      globalMemoryEnabled: false,
      hasAgentDocuments: agentDocuments.length > 0,
      hasEnabledKnowledgeBases,
      isBotConversation: false,
      model,
      provider,
    },
  );

  const pluginIds = agentPlugins;

  const toolsResult = toolsEngine.generateToolsDetailed({
    excludeDefaultToolIds: manualModeExcludeToolIds,
    model,
    provider,
    toolIds: pluginIds,
  });

  const builtinSkillMetas = builtinSkills.map((skill) => ({
    content: skill.content,
    description: skill.description,
    identifier: skill.identifier,
    name: skill.name,
  }));
  const dbSkillMetas = dbSkills.map((skill) => ({
    description: skill.description ?? '',
    identifier: skill.identifier,
    name: skill.name,
  }));
  const skillEngine = new SkillEngine({
    enableChecker: (skill) => shouldEnableBuiltinSkill(skill.identifier),
    skills: [...builtinSkillMetas, ...dbSkillMetas],
  });
  const skillSet = skillEngine.generate(agentPlugins);
  const selectedSkillIds = new Set(agentPlugins);
  const enabledSkills = skillSet.skills.filter((skill) => selectedSkillIds.has(skill.identifier));

  const rebuiltMessages = await serverMessagesEngine({
    agentDocuments: mapAgentDocuments(agentDocuments),
    enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
    historyCount: (agentConfig.chatConfig?.historyCount ?? 20) + 1,
    inputTemplate: agentConfig.chatConfig?.inputTemplate ?? undefined,
    knowledge: {
      fileContents: agentConfig.files
        ?.filter((file) => file.enabled === true && !!file.content)
        .map((file) => ({
          content: file.content ?? '',
          fileId: file.id ?? '',
          filename: file.name ?? '',
        })),
      knowledgeBases: agentConfig.knowledgeBases
        ?.filter((knowledgeBase) => knowledgeBase.enabled === true)
        .map((knowledgeBase) => ({
          description: knowledgeBase.description,
          id: knowledgeBase.id,
          name: knowledgeBase.name,
        })),
    },
    messages: runtimeMessages,
    model,
    provider,
    skillsConfig: enabledSkills.length > 0 ? { enabledSkills } : undefined,
    systemRole: agentConfig.systemRole ?? undefined,
    toolsConfig: {
      manifests: toolsResult.enabledManifests,
      tools: toolsResult.enabledToolIds,
    },
    userTimezone,
  });

  return {
    ...payload,
    messages: rebuiltMessages,
    provider,
  };
};

export const resolveTransportRequest = async (
  request: ChatTransportRequest,
  options: ResolveTransportRequestOptions,
): Promise<ChatStreamPayload> => {
  if (isStagedTransportRequest(request)) {
    const stageStore = new ChatTransportStageStore(options.userId);
    return stageStore.resolveStage(request.stageId);
  }

  if (isCompactTransportRequest(request)) {
    return resolveCompactTransportRequest(request, options);
  }

  return request;
};
