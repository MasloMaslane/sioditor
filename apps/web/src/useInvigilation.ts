import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChunkQueue,
  HttpTransport,
  Recorder,
  SyncLoop,
  type IntegrityEvent,
  type SyncState,
} from '@sioditor/integrity';

const ACK_KEY = 'sioditor.invigilation.acknowledged';

export interface SupervisedSession {
  readonly sessionId: string;
  readonly participantId: string;
  readonly endpoint: string;
}

export interface InvigilationState {
  readonly session: SupervisedSession | undefined;
  /** True once the notice has been read and the round joined. */
  readonly active: boolean;
  /** Set when a session was requested but the notice has not been acknowledged. */
  readonly awaitingAcknowledgement: boolean;
  readonly sync: SyncState | undefined;
  readonly acknowledge: () => void;
  readonly record: (event: IntegrityEvent) => void;
  readonly recordEdit: (problemId: string, edit: EditLike) => void;
  readonly noteDocument: (problemId: string, source: string) => void;
}

interface EditLike {
  at: number;
  from: number;
  to: number;
  inserted: string;
  source: string;
}

/**
 * Reads the session a contestant was sent to.
 *
 * From the URL, because that is how an organiser distributes a round: a link per
 * participant. There is deliberately no way for the page to enrol itself, and no way for
 * a server to turn recording on remotely.
 */
function sessionFromUrl(): SupervisedSession | undefined {
  if (typeof location === 'undefined') return undefined;
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session');
  const participantId = params.get('participant');
  if (!sessionId || !participantId) return undefined;
  return {
    sessionId,
    participantId,
    endpoint: params.get('ingest') ?? location.origin,
  };
}

/**
 * Recording for a supervised round.
 *
 * Inert unless the page was opened with a session link, and even then nothing is captured
 * until the notice has been acknowledged. Ordinary practice use records nothing and talks
 * to no server.
 */
export function useInvigilation(): InvigilationState {
  const [session] = useState(sessionFromUrl);
  const [acknowledged, setAcknowledged] = useState(() => {
    const current = sessionFromUrl();
    if (!current) return false;
    try {
      return localStorage.getItem(`${ACK_KEY}.${current.sessionId}`) === 'yes';
    } catch {
      return false;
    }
  });
  const [sync, setSync] = useState<SyncState>();

  const recorder = useRef<Recorder>(null);
  const loop = useRef<SyncLoop>(null);
  const transport = useRef<HttpTransport>(null);
  const queue = useRef<ChunkQueue>(null);

  const active = Boolean(session) && acknowledged;

  useEffect(() => {
    if (!session || !acknowledged) return;

    const chunkQueue = new ChunkQueue();
    const http = new HttpTransport(session.endpoint, session.sessionId, session.participantId);
    const rec = new Recorder({
      sessionId: session.sessionId,
      participantId: session.participantId,
      queue: chunkQueue,
      // Sealing promptly means a closed laptop loses at most a few seconds of events.
      onChunkSealed: () => void syncLoop.flush(),
    });
    const syncLoop = new SyncLoop({
      queue: chunkQueue,
      transport: http,
      onStateChange: setSync,
    });

    queue.current = chunkQueue;
    transport.current = http;
    recorder.current = rec;
    loop.current = syncLoop;

    // `resume` rather than `start` when the queue already holds chunks: a reload during a
    // round is normal and should be visible as one session, not two.
    void chunkQueue.nextSeq().then((seq) => rec.start(seq === 0 ? 'start' : 'resume'));
    syncLoop.start();

    /**
     * A last attempt as the page goes away. sendBeacon gives no acknowledgement, so the
     * chunks stay pending and are re-sent next time - which is safe because ingest is
     * idempotent, and is the reason it had to be.
     */
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      void rec.seal().then(async () => {
        const pending = await chunkQueue.pending();
        http.beacon(pending);
      });
    };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      syncLoop.stop();
      void rec.stop().then(() => chunkQueue.close());
    };
  }, [session, acknowledged]);

  // The signals that do not come from the editor.
  useEffect(() => {
    if (!active) return;
    const rec = () => recorder.current;

    const onVisibility = () =>
      rec()?.record({
        t: 'focus',
        at: Date.now(),
        visible: document.visibilityState === 'visible',
      });
    const onFullscreen = () =>
      rec()?.record({
        t: 'fullscreen',
        at: Date.now(),
        active: document.fullscreenElement !== null,
      });

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);

    // Counts tabs of this origin only. Says nothing about any other site, and cannot.
    const channel = new BroadcastChannel('sioditor-presence');
    let peers = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.data === 'ping') channel.postMessage('pong');
      if (event.data === 'pong') {
        peers++;
        rec()?.record({ t: 'tabs', at: Date.now(), count: peers + 1 });
      }
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage('ping');

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [active]);

  const acknowledge = useCallback(() => {
    setAcknowledged(true);
    const current = sessionFromUrl();
    if (!current) return;
    try {
      localStorage.setItem(`${ACK_KEY}.${current.sessionId}`, 'yes');
    } catch {
      // Not remembering means the notice is shown again, which is the safe direction.
    }
  }, []);

  return {
    session,
    active,
    awaitingAcknowledgement: Boolean(session) && !acknowledged,
    sync,
    acknowledge,
    record: useCallback((event) => recorder.current?.record(event), []),
    recordEdit: useCallback(
      (problemId, edit) => void recorder.current?.recordEdit(problemId, edit),
      [],
    ),
    noteDocument: useCallback(
      (problemId, source) => recorder.current?.noteDocument(problemId, source),
      [],
    ),
  };
}
