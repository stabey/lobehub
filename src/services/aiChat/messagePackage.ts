import type {
  AppendMessagePackageChunkParams,
  CreateMessagePackageParams,
  FinalizeMessagePackageParams,
  SendNewMessage,
} from '@lobechat/types';

export const MESSAGE_PACKAGE_INLINE_THRESHOLD_BYTES = 700;
export const MESSAGE_PACKAGE_CHUNK_BYTES = 384;

const encoder = new TextEncoder();

export interface MessagePackageTransport {
  appendMessagePackageChunk: (
    params: AppendMessagePackageChunkParams,
    abortController?: AbortController,
  ) => Promise<unknown>;
  createMessagePackage: (
    params: CreateMessagePackageParams,
    abortController?: AbortController,
  ) => Promise<{ id: string }>;
  finalizeMessagePackage: (
    params: FinalizeMessagePackageParams,
    abortController?: AbortController,
  ) => Promise<unknown>;
}

export interface ResolveMessagePackageOptions {
  abortController?: AbortController;
  chunkBytes?: number;
  inlineThresholdBytes?: number;
}

export const utf8ByteLength = (value: string) => encoder.encode(value).byteLength;

export const splitByUtf8Bytes = (value: string, maxBytes: number): string[] => {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = utf8ByteLength(char);

    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }

    current += char;
    currentBytes += charBytes;
  }

  if (current) chunks.push(current);

  return chunks;
};

export const shouldUseMessagePackageRef = (
  message: SendNewMessage,
  inlineThresholdBytes = MESSAGE_PACKAGE_INLINE_THRESHOLD_BYTES,
) => utf8ByteLength(JSON.stringify(message)) > inlineThresholdBytes;

export const resolveMessagePackageForSend = async (
  message: SendNewMessage,
  transport: MessagePackageTransport,
  options: ResolveMessagePackageOptions = {},
): Promise<SendNewMessage> => {
  const inlineThresholdBytes =
    options.inlineThresholdBytes ?? MESSAGE_PACKAGE_INLINE_THRESHOLD_BYTES;
  const serialized = JSON.stringify(message);
  const byteLength = utf8ByteLength(serialized);

  if (byteLength <= inlineThresholdBytes) return message;

  const chunkBytes = options.chunkBytes ?? MESSAGE_PACKAGE_CHUNK_BYTES;
  const chunks = splitByUtf8Bytes(serialized, chunkBytes);
  const { id } = await transport.createMessagePackage(
    { byteLength, totalChunks: chunks.length },
    options.abortController,
  );

  for (const [index, chunk] of chunks.entries()) {
    await transport.appendMessagePackageChunk({ chunk, id, index }, options.abortController);
  }

  await transport.finalizeMessagePackage({ id }, options.abortController);

  return { messagePackageRef: { id } };
};
