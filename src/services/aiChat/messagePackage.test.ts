import { describe, expect, it, vi } from 'vitest';

import {
  MESSAGE_PACKAGE_CHUNK_BYTES,
  resolveMessagePackageForSend,
  splitByUtf8Bytes,
  utf8ByteLength,
} from './messagePackage';

describe('messagePackage', () => {
  it('keeps short messages inline', async () => {
    const transport = {
      appendMessagePackageChunk: vi.fn(),
      createMessagePackage: vi.fn(),
      finalizeMessagePackage: vi.fn(),
    };
    const message = { content: 'short message' };

    const result = await resolveMessagePackageForSend(message, transport);

    expect(result).toEqual(message);
    expect(transport.createMessagePackage).not.toHaveBeenCalled();
  });

  it('uploads oversized messages in chunks and returns only a reference', async () => {
    const transport = {
      appendMessagePackageChunk: vi.fn().mockResolvedValue({ success: true }),
      createMessagePackage: vi.fn().mockResolvedValue({ id: 'pkg-1' }),
      finalizeMessagePackage: vi.fn().mockResolvedValue({ id: 'pkg-1' }),
    };
    const message = {
      content: 'x'.repeat(1400),
      editorData: { root: { children: [{ text: 'rich' }] } },
      pageSelections: [{ id: 'page-1', content: 'selection' }],
    } as any;

    const result = await resolveMessagePackageForSend(message, transport, {
      chunkBytes: MESSAGE_PACKAGE_CHUNK_BYTES,
      inlineThresholdBytes: 100,
    });

    expect(result).toEqual({ messagePackageRef: { id: 'pkg-1' } });
    expect(result).not.toHaveProperty('content');
    expect(transport.createMessagePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        byteLength: utf8ByteLength(JSON.stringify(message)),
      }),
      undefined,
    );
    expect(transport.appendMessagePackageChunk).toHaveBeenCalled();
    for (const call of transport.appendMessagePackageChunk.mock.calls) {
      expect(utf8ByteLength(call[0].chunk)).toBeLessThanOrEqual(MESSAGE_PACKAGE_CHUNK_BYTES);
    }
    expect(transport.finalizeMessagePackage).toHaveBeenCalledWith({ id: 'pkg-1' }, undefined);
  });

  it('splits by UTF-8 byte length without corrupting unicode', () => {
    const chunks = splitByUtf8Bytes('a你好b', 4);

    expect(chunks.join('')).toBe('a你好b');
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(4);
    }
  });
});
