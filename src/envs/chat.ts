import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export interface ChatTransportConfig {
  enabled: boolean;
  ttlSeconds: number;
}

export const getChatEnv = () => {
  return createEnv({
    runtimeEnv: {
      CHAT_STAGED_TRANSPORT_ENABLED: process.env.CHAT_STAGED_TRANSPORT_ENABLED,
      CHAT_STAGED_TRANSPORT_TTL_SECONDS: process.env.CHAT_STAGED_TRANSPORT_TTL_SECONDS,
    },
    server: {
      CHAT_STAGED_TRANSPORT_ENABLED: z.coerce.boolean().default(false),
      CHAT_STAGED_TRANSPORT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    },
  });
};

export const chatEnv = getChatEnv();

export const getChatTransportConfig = (): ChatTransportConfig => {
  return {
    enabled: chatEnv.CHAT_STAGED_TRANSPORT_ENABLED,
    ttlSeconds: chatEnv.CHAT_STAGED_TRANSPORT_TTL_SECONDS,
  };
};
