import { builtinSkills } from '@lobechat/builtin-skills';
import {
  AgentManagementIdentifier,
  createCallAgentManifest,
} from '@lobechat/builtin-tool-agent-management';
import {
  CredsIdentifier,
  type CredSummary,
  injectCredsContext,
} from '@lobechat/builtin-tool-creds';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type {
  ChatStreamPayload,
  ChatTransportRequest,
  CompactTopicChatTransportRequest,
  RuntimeMentionedAgent,
  RuntimeSelectedSkill,
  RuntimeSelectedTool,
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

interface ParsedActionTag {
  category: string;
  label: string;
  type: string;
}

const parseActionTagsFromEditorData = (
  editorData: Record<string, any> | null | undefined,
): ParsedActionTag[] => {
  if (!editorData) return [];

  const actionTags: ParsedActionTag[] = [];

  const walk = (node: any): void => {
    if (!node) return;

    if (node.type === 'action-tag') {
      actionTags.push({
        category: node.actionCategory,
        label: node.actionLabel,
        type: node.actionType,
      });
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };

  walk(editorData.root);

  return actionTags;
};

const parseSelectedSkillsFromEditorData = (
  editorData: Record<string, any> | null | undefined,
): RuntimeSelectedSkill[] => {
  const actionTags = parseActionTagsFromEditorData(editorData);
  const selectedSkills = actionTags.filter((tag) => tag.category === 'skill');

  if (selectedSkills.length === 0) return [];

  const seen = new Set<string>();

  return selectedSkills.reduce<RuntimeSelectedSkill[]>((acc, skill) => {
    const identifier = String(skill.type);
    if (!identifier || seen.has(identifier)) return acc;

    seen.add(identifier);
    acc.push({
      identifier,
      name: skill.label || identifier,
    });

    return acc;
  }, []);
};

const parseSelectedToolsFromEditorData = (
  editorData: Record<string, any> | null | undefined,
): RuntimeSelectedTool[] => {
  const actionTags = parseActionTagsFromEditorData(editorData);
  const selectedTools = actionTags.filter((tag) => tag.category === 'tool');

  if (selectedTools.length === 0) return [];

  const seen = new Set<string>();

  return selectedTools.reduce<RuntimeSelectedTool[]>((acc, tool) => {
    const identifier = String(tool.type);
    if (!identifier || seen.has(identifier)) return acc;

    seen.add(identifier);
    acc.push({
      identifier,
      name: tool.label || identifier,
    });

    return acc;
  }, []);
};

const formatSelectedToolContent = (manifest: LobeToolManifest): string | undefined => {
  const parts: string[] = [];

  if (manifest.systemRole) {
    parts.push(manifest.systemRole);
  }

  if (manifest.api?.length > 0) {
    const apiDescriptions = manifest.api
      .map((api) => `- ${api.name}: ${api.description}`)
      .join('\n');
    parts.push(`Available APIs:\n${apiDescriptions}`);
  }

  const content = parts.join('\n\n');

  return content || undefined;
};

const resolveSelectedToolsWithContent = (
  selectedTools: RuntimeSelectedTool[],
  installedPlugins: Awaited<ReturnType<PluginModel['query']>>,
): RuntimeSelectedTool[] => {
  const builtinManifestMap = new Map(
    builtinTools.map((tool) => [tool.identifier, tool.manifest as LobeToolManifest]),
  );
  const installedManifestMap = new Map(
    installedPlugins.map((plugin) => [plugin.identifier, plugin.manifest as LobeToolManifest]),
  );

  return selectedTools.map((tool) => {
    const manifest =
      installedManifestMap.get(tool.identifier) ?? builtinManifestMap.get(tool.identifier);
    if (!manifest) return tool;

    const content = formatSelectedToolContent(manifest);

    return content ? { ...tool, content } : tool;
  });
};

const resolveSelectedSkillsWithContent = async ({
  marketService,
  selectedSkills,
  skillModel,
}: {
  marketService: MarketService;
  selectedSkills: RuntimeSelectedSkill[];
  skillModel: AgentSkillModel;
}): Promise<RuntimeSelectedSkill[]> => {
  if (selectedSkills.length === 0) return [];

  const requiresCredsContext = selectedSkills.some((skill) => skill.identifier === CredsIdentifier);

  let credsSummary: CredSummary[] = [];

  if (requiresCredsContext) {
    const credsResult = await marketService.market.creds.list().catch(() => ({ data: [] }));
    credsSummary = (credsResult.data ?? []).map((cred) => ({
      description: cred.description,
      key: cred.key,
      name: cred.name,
      type: cred.type,
    }));
  }

  return Promise.all(
    selectedSkills.map(async (skill) => {
      const builtinSkill = builtinSkills.find((item) => item.identifier === skill.identifier);

      if (builtinSkill) {
        const content =
          skill.identifier === CredsIdentifier
            ? injectCredsContext(builtinSkill.content, {
                creds: credsSummary,
                settingsUrl: '/settings/creds',
              })
            : builtinSkill.content;

        return content ? { ...skill, content } : skill;
      }

      const detail = await skillModel.findByIdentifier(skill.identifier);

      if (!detail?.content) return skill;

      const hasResources = !!(detail.resources && Object.keys(detail.resources).length > 0);
      const content = hasResources
        ? detail.content + '\n\n' + resourcesTreePrompt(detail.name, detail.resources)
        : detail.content;

      return content ? { ...skill, content } : skill;
    }),
  );
};

const parseMentionedAgentsFromEditorData = (
  editorData: Record<string, any> | null | undefined,
): RuntimeMentionedAgent[] => {
  if (!editorData) return [];

  const agents: RuntimeMentionedAgent[] = [];
  const seen = new Set<string>();

  const walk = (node: any): void => {
    if (!node) return;

    if (node.type === 'mention' && node.metadata?.type === 'agent') {
      const id = typeof node.metadata.id === 'string' ? node.metadata.id : undefined;

      if (id && !seen.has(id)) {
        seen.add(id);
        agents.push({ id, name: node.label || id });
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };

  walk(editorData.root);

  return agents;
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
  const mentionedAgents = parseMentionedAgentsFromEditorData(userMessage.editorData);
  const selectedSkills = await resolveSelectedSkillsWithContent({
    marketService,
    selectedSkills: parseSelectedSkillsFromEditorData(userMessage.editorData),
    skillModel: agentSkillModel,
  });
  const selectedTools = resolveSelectedToolsWithContent(
    parseSelectedToolsFromEditorData(userMessage.editorData),
    installedPlugins,
  );
  const shouldInjectMentionDelegation =
    mentionedAgents.length > 0 && !agentPlugins.includes(AgentManagementIdentifier);
  const effectiveAgentPlugins = shouldInjectMentionDelegation
    ? [...new Set([...agentPlugins, AgentManagementIdentifier])]
    : agentPlugins;
  const effectiveToolIds = [
    ...new Set([...effectiveAgentPlugins, ...selectedTools.map((tool) => tool.identifier)]),
  ];
  const hasEnabledKnowledgeBases =
    agentConfig.knowledgeBases?.some((knowledgeBase) => knowledgeBase.enabled === true) ?? false;
  const { compact: _compact, transport: _transport, ...payload } = request;
  const model = payload.model ?? agentConfig.model;
  const provider = payload.provider ?? agentConfig.provider;
  const additionalManifests = [
    ...lobehubSkillManifests,
    ...klavisManifests,
    ...(shouldInjectMentionDelegation ? [createCallAgentManifest() as LobeToolManifest] : []),
  ];
  const agentManagementContext = mentionedAgents.length > 0 ? { mentionedAgents } : undefined;

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
      additionalManifests,
      agentConfig: {
        chatConfig: agentConfig.chatConfig ?? undefined,
        plugins: effectiveToolIds,
      },
      globalMemoryEnabled: false,
      hasAgentDocuments: agentDocuments.length > 0,
      hasEnabledKnowledgeBases,
      isBotConversation: false,
      model,
      provider,
    },
  );

  const toolsResult = toolsEngine.generateToolsDetailed({
    excludeDefaultToolIds: manualModeExcludeToolIds,
    model,
    provider,
    toolIds: effectiveToolIds,
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
    agentManagementContext,
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
    selectedSkills: selectedSkills.length > 0 ? selectedSkills : undefined,
    selectedTools: selectedTools.length > 0 ? selectedTools : undefined,
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
