import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export interface ChatTransportConfig {
  compactEnabled: boolean;
  enabled: boolean;
  ttlSeconds: number;
}

export const getChatEnv = () => {
  return createEnv({
    runtimeEnv: {
      CHAT_COMPACT_TRANSPORT_ENABLED: process.env.CHAT_COMPACT_TRANSPORT_ENABLED,
      CHAT_STAGED_TRANSPORT_ENABLED: process.env.CHAT_STAGED_TRANSPORT_ENABLED,
      CHAT_STAGED_TRANSPORT_TTL_SECONDS: process.env.CHAT_STAGED_TRANSPORT_TTL_SECONDS,
    },
    server: {
      CHAT_COMPACT_TRANSPORT_ENABLED: z.coerce.boolean().default(false),
      CHAT_STAGED_TRANSPORT_ENABLED: z.coerce.boolean().default(false),
      CHAT_STAGED_TRANSPORT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    },
  });
};

export const chatEnv = getChatEnv();

export const getChatTransportConfig = (): ChatTransportConfig => {
  return {
    compactEnabled: chatEnv.CHAT_COMPACT_TRANSPORT_ENABLED,
    enabled: chatEnv.CHAT_STAGED_TRANSPORT_ENABLED,
    ttlSeconds: chatEnv.CHAT_STAGED_TRANSPORT_TTL_SECONDS,
  };
};
