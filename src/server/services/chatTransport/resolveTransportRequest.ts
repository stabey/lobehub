import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
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
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { type LobeToolManifest, SkillEngine } from '@lobechat/context-engine';
import type { PageContentContext } from '@lobechat/prompts';
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
import { DocumentService } from '@/server/services/document';
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

const escapeXmlText = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeXmlAttribute = (value: string) =>
  escapeXmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const buildXmlAttributes = (attributes: Record<string, number | string | undefined>) => {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(String(value))}"`)
    .join('');
};

const serializePageEditorNodeToXml = (node: Record<string, any> | null | undefined): string => {
  if (!node || typeof node !== 'object') return '';

  if (node.type === 'text') {
    return escapeXmlText(String(node.text ?? ''));
  }

  if (node.type === 'linebreak') {
    return '<br />';
  }

  const childXml = Array.isArray(node.children)
    ? node.children.map((child) => serializePageEditorNodeToXml(child)).join('')
    : '';
  const id = typeof node.id === 'string' ? node.id : undefined;

  switch (node.type) {
    case 'root': {
      return `<root>${childXml}</root>`;
    }
    case 'paragraph': {
      return `<p${buildXmlAttributes({ id })}>${childXml}</p>`;
    }
    case 'heading': {
      const tag = typeof node.tag === 'string' ? node.tag : 'h1';

      return `<${tag}${buildXmlAttributes({ id })}>${childXml}</${tag}>`;
    }
    case 'list': {
      const tag =
        typeof node.tag === 'string' ? node.tag : node.listType === 'number' ? 'ol' : 'ul';
      const attributes =
        tag === 'ol' && typeof node.start === 'number' && node.start !== 1
          ? { id, start: node.start }
          : { id };

      return `<${tag}${buildXmlAttributes(attributes)}>${childXml}</${tag}>`;
    }
    case 'listitem': {
      return `<li${buildXmlAttributes({ id })}>${childXml}</li>`;
    }
    case 'quote': {
      return `<blockquote${buildXmlAttributes({ id })}>${childXml}</blockquote>`;
    }
    case 'link': {
      return `<a${buildXmlAttributes({ id, href: typeof node.url === 'string' ? node.url : undefined })}>${childXml}</a>`;
    }
    case 'horizontalrule': {
      return `<hr${buildXmlAttributes({ id })} />`;
    }
    case 'code':
    case 'codeblock': {
      const codeXml = childXml || escapeXmlText(String(node.text ?? ''));

      return node.type === 'codeblock'
        ? `<pre${buildXmlAttributes({ id })}><code>${codeXml}</code></pre>`
        : `<code${buildXmlAttributes({ id })}>${codeXml}</code>`;
    }
    case 'table': {
      return `<table${buildXmlAttributes({ id })}>${childXml}</table>`;
    }
    case 'tablerow': {
      return `<tr${buildXmlAttributes({ id })}>${childXml}</tr>`;
    }
    case 'tablecell': {
      const tag = node.headerState ? 'th' : 'td';

      return `<${tag}${buildXmlAttributes({ id })}>${childXml}</${tag}>`;
    }
    case 'image': {
      return `<img${buildXmlAttributes({
        alt: typeof node.altText === 'string' ? node.altText : undefined,
        id,
        src:
          typeof node.src === 'string'
            ? node.src
            : typeof node.url === 'string'
              ? node.url
              : undefined,
      })} />`;
    }
    default: {
      if (typeof node.tag === 'string' && /^[a-z][\w-]*$/i.test(node.tag)) {
        return `<${node.tag}${buildXmlAttributes({ id })}>${childXml}</${node.tag}>`;
      }

      return childXml;
    }
  }
};

const serializePageEditorDataToXml = (editorData: Record<string, any> | null | undefined) => {
  if (!editorData?.root) return undefined;

  const xml = serializePageEditorNodeToXml(editorData.root);

  return xml || undefined;
};

const createPageContentContextFromDocument = (document: {
  content: string | null;
  editorData?: Record<string, any> | null;
  filename?: string | null;
  title?: string | null;
  totalCharCount?: number | null;
  totalLineCount?: number | null;
}): PageContentContext => {
  const title = document.title || document.filename || 'Untitled';
  const markdown = document.content ?? undefined;
  const xml = serializePageEditorDataToXml(document.editorData);

  return {
    ...(markdown ? { markdown } : undefined),
    metadata: {
      charCount: document.totalCharCount ?? markdown?.length ?? 0,
      lineCount: document.totalLineCount ?? markdown?.split('\n').length ?? 0,
      title,
    },
    ...(xml ? { xml } : undefined),
  };
};

const resolvePageContentContext = async ({
  documentId,
  documentService,
}: {
  documentId?: string;
  documentService: DocumentService;
}): Promise<PageContentContext | undefined> => {
  if (!documentId) return undefined;

  const document = await documentService.getDocumentById(documentId);

  if (!document) {
    throw new ChatTransportStageStoreError(404, 'Compact chat transport document not found');
  }

  return createPageContentContextFromDocument(document);
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
  const documentService = new DocumentService(serverDB, userId);

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

  const isPageScope = !!compact.documentId;
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

  let effectiveAgentPlugins = shouldInjectMentionDelegation
    ? [...new Set([...agentPlugins, AgentManagementIdentifier])]
    : agentPlugins;

  if (isPageScope && !effectiveAgentPlugins.includes(PageAgentIdentifier)) {
    effectiveAgentPlugins = [PageAgentIdentifier, ...effectiveAgentPlugins];
  }

  const effectiveToolIds = [
    ...new Set([...effectiveAgentPlugins, ...selectedTools.map((tool) => tool.identifier)]),
  ];

  const pageAgentRuntimeConfig = isPageScope
    ? getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {})
    : undefined;
  const effectiveSystemRole = (() => {
    if (!isPageScope) return agentConfig.systemRole ?? undefined;

    const pageAgentSystemRole = pageAgentRuntimeConfig?.systemRole;

    if (!pageAgentSystemRole) return agentConfig.systemRole ?? undefined;

    if ((agentConfig as any).slug === BUILTIN_AGENT_SLUGS.pageAgent) {
      return agentConfig.systemRole ?? pageAgentSystemRole;
    }

    return agentConfig.systemRole
      ? `${agentConfig.systemRole}\n\n${pageAgentSystemRole}`
      : pageAgentSystemRole;
  })();
  const effectiveChatConfig = isPageScope
    ? { ...agentConfig.chatConfig, enableHistoryCount: false }
    : (agentConfig.chatConfig ?? undefined);
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
  const pageContentContext = await resolvePageContentContext({
    documentId: compact.documentId,
    documentService,
  });

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
        chatConfig: effectiveChatConfig,
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
  const skillSet = skillEngine.generate(effectiveAgentPlugins);
  const selectedSkillIds = new Set(effectiveAgentPlugins);
  const enabledSkills = skillSet.skills.filter((skill) => selectedSkillIds.has(skill.identifier));

  const rebuiltMessages = await serverMessagesEngine({
    agentDocuments: mapAgentDocuments(agentDocuments),
    enableHistoryCount: effectiveChatConfig?.enableHistoryCount ?? undefined,
    historyCount: (effectiveChatConfig?.historyCount ?? 20) + 1,
    inputTemplate: effectiveChatConfig?.inputTemplate ?? undefined,
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
    pageContentContext,
    provider,
    selectedSkills: selectedSkills.length > 0 ? selectedSkills : undefined,
    selectedTools: selectedTools.length > 0 ? selectedTools : undefined,
    skillsConfig: enabledSkills.length > 0 ? { enabledSkills } : undefined,
    systemRole: effectiveSystemRole,
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
