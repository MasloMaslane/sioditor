import { describe, expect, it } from 'vitest';
import {
  attachStdinChannel,
  closeStdin,
  createStdinChannel,
  provideStdin,
  readStdinBlocking,
  STDIN_EOF,
  STDIN_READY,
  STDIN_WAITING,
} from '../src/stdin-channel.js';

describe('stdin channel', () => {
  it('hands the worker exactly what the page wrote', () => {
    const channel = createStdinChannel();
    provideStdin(channel, 'hello\n');
    // The worker is not actually blocked here, so the read returns straight away.
    const bytes = readStdinBlocking(channel, () => provideStdin(channel, 'hello\n'));
    expect(new TextDecoder().decode(bytes)).toBe('hello\n');
  });

  it('reports end of input as zero bytes, which every runtime reads as EOF', () => {
    const channel = createStdinChannel();
    const bytes = readStdinBlocking(channel, () => closeStdin(channel));
    expect(bytes).toHaveLength(0);
    expect(Atomics.load(channel.header, 0)).toBe(STDIN_EOF);
  });

  it('marks itself waiting before it blocks, so the page can say so', () => {
    const channel = createStdinChannel();
    let stateWhenAsked = -1;
    readStdinBlocking(channel, () => {
      stateWhenAsked = Atomics.load(channel.header, 0);
      closeStdin(channel);
    });
    expect(stateWhenAsked).toBe(STDIN_WAITING);
  });

  it('shares one buffer between page and worker views', () => {
    const channel = createStdinChannel();
    const worker = attachStdinChannel(channel.header.buffer as SharedArrayBuffer);
    provideStdin(channel, 'x');
    expect(Atomics.load(worker.header, 0)).toBe(STDIN_READY);
    expect(worker.bytes[0]).toBe('x'.charCodeAt(0));
  });

  it('truncates rather than wedging a program blocked on an over-long line', () => {
    const channel = createStdinChannel(8);
    provideStdin(channel, 'abcdefghijkl');
    expect(Atomics.load(channel.header, 1)).toBe(8);
  });

  it('round-trips multi-byte characters', () => {
    const channel = createStdinChannel();
    const bytes = readStdinBlocking(channel, () => provideStdin(channel, 'zażółć\n'));
    expect(new TextDecoder().decode(bytes)).toBe('zażółć\n');
  });
});
