/**
 * A blocking stdin channel between a worker and the page.
 *
 * Programs read stdin synchronously - `scanf`, `cin >>`, `input()` all expect the call to
 * return with data - but the data comes from a text box on the main thread. The only way
 * to bridge that is a SharedArrayBuffer the worker can block on with Atomics.wait, which
 * is why the app insists on cross-origin isolation.
 *
 * Layout: one Int32Array header followed by a byte buffer.
 *   [0] state   see below
 *   [1] length  bytes written by the page, valid when state is READY
 */
export const STDIN_IDLE = 0;
/** The worker is blocked, waiting for the page to supply a line. */
export const STDIN_WAITING = 1;
/** The page has written bytes; the worker may take them. */
export const STDIN_READY = 2;
/** No more input is coming. Reads return zero bytes, which every runtime reads as EOF. */
export const STDIN_EOF = 3;

const HEADER_INTS = 2;
const DEFAULT_CAPACITY = 64 * 1024;

export interface StdinChannel {
  readonly header: Int32Array;
  readonly bytes: Uint8Array;
}

export function createStdinChannel(capacity = DEFAULT_CAPACITY): StdinChannel {
  const buffer = new SharedArrayBuffer(HEADER_INTS * 4 + capacity);
  return {
    header: new Int32Array(buffer, 0, HEADER_INTS),
    bytes: new Uint8Array(buffer, HEADER_INTS * 4),
  };
}

/** Rebuilds the views inside a worker, from the buffer that was posted to it. */
export function attachStdinChannel(buffer: SharedArrayBuffer): StdinChannel {
  return {
    header: new Int32Array(buffer, 0, HEADER_INTS),
    bytes: new Uint8Array(buffer, HEADER_INTS * 4),
  };
}

/**
 * Called from the page. Hands the worker a chunk and wakes it.
 *
 * Truncates rather than failing if the text does not fit: losing the tail of an
 * implausibly long typed line is better than wedging a program that is blocked on it.
 */
export function provideStdin(channel: StdinChannel, text: string): void {
  const encoded = new TextEncoder().encode(text);
  const length = Math.min(encoded.byteLength, channel.bytes.byteLength);
  channel.bytes.set(encoded.subarray(0, length));
  Atomics.store(channel.header, 1, length);
  Atomics.store(channel.header, 0, STDIN_READY);
  Atomics.notify(channel.header, 0);
}

/** Called from the page. Tells a blocked program that nothing more is coming. */
export function closeStdin(channel: StdinChannel): void {
  Atomics.store(channel.header, 1, 0);
  Atomics.store(channel.header, 0, STDIN_EOF);
  Atomics.notify(channel.header, 0);
}

/**
 * Called from a worker. Blocks until the page provides input or closes the stream.
 *
 * Returns the bytes, or an empty array at end of input. `onWait` fires immediately before
 * blocking, so the caller can tell the page that a program is waiting - the page cannot
 * discover that any other way, since the worker is about to stop responding to messages.
 */
export function readStdinBlocking(channel: StdinChannel, onWait: () => void): Uint8Array {
  Atomics.store(channel.header, 0, STDIN_WAITING);
  onWait();

  // Atomics.wait returns on notify, but a spurious wake is permitted, so loop.
  while (Atomics.load(channel.header, 0) === STDIN_WAITING) {
    Atomics.wait(channel.header, 0, STDIN_WAITING);
  }

  if (Atomics.load(channel.header, 0) === STDIN_EOF) return new Uint8Array(0);

  const length = Atomics.load(channel.header, 1);
  const copy = new Uint8Array(length);
  copy.set(channel.bytes.subarray(0, length));
  Atomics.store(channel.header, 0, STDIN_IDLE);
  return copy;
}
