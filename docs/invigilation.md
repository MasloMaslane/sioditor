# Invigilation: what is worth building, and what is not

A proposal, not a plan of record. Nothing here is implemented, and the decisions at the
end need answering before any of it should be.

## The honest starting point

sioditor runs in the contestant's own browser, on the contestant's own machine. Every
signal it could collect is produced by code they control and could switch off. So:

**This cannot prevent cheating, and must never be described as if it can.**

What it can do is narrower and still worth having:

1. **Produce evidence** of how a solution came to exist, for a human to look at when
   something else has already raised a question.
2. **Deter** the laziest forms of cheating, because contestants know the editor records
   how the code appeared.
3. **Let an honest contestant demonstrate their own work**, which is the use that gets
   least attention and may be the most valuable.

Anything beyond that is theatre, and theatre in this area is worse than nothing: it
produces confident-looking output that a reviewer may believe.

### What the threat model actually looks like in 2026

| How someone cheats                            | Can we see it?                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pastes a solution from anywhere               | **Yes** - content, size, and that it never existed in this session                    |
| Drags text into the editor                    | **Yes** - a separate event that paste-only monitoring misses                          |
| Writes elsewhere, pastes at the end           | **Yes** - one enormous insertion                                                      |
| Retypes a solution from an LLM in another tab | **No.** Keystrokes look ordinary. Weakly visible in replay as unnaturally linear work |
| Reads an LLM on a second device               | **No. Structurally impossible**                                                       |
| Has someone else at the keyboard              | **No**                                                                                |
| Another browser tab, any origin               | **No. Structurally impossible** - and this is the big one                             |

The last rows matter more than the first. The dominant risk today is a language model in
another window, and that is exactly what a web page cannot observe. A system that catches
pasting but not retyping does not catch the modern case; it catches the careless.

Saying so plainly is part of the proposal. An invigilation feature that organisers
_believe_ is comprehensive is more dangerous than none.

## What to collect

Ordered by how much it is worth, not how easy it is.

### 1. The edit log - the whole point

Every change as `{from, to, inserted, at, source}`, which
`packages/editor/src/events.ts` already emits and currently discards. This replays a
session keystroke by keystroke.

It is worth more than every derived metric combined. A reviewer watching a solution
appear - the false starts, the debugging, the moment a finished function materialises
whole - learns more in thirty seconds than any score conveys. It costs tens to low
hundreds of KB per hour, against tens of MB for screen capture, and unlike video it
cannot capture anything the contestant did not type into this editor.

### 2. Paste and drop, with provenance

Content, length, and whether that text existed anywhere earlier in the session. The
distinction that matters is not "did they paste" - everyone pastes their own code - but
"did 180 lines arrive that this session has never seen".

Store a hash plus length by default and the content only for insertions above a threshold,
so the common case carries no copy of the contestant's work.

### 3. Focus and visibility timeline

`visibilitychange`, `blur`, `fullscreenchange`. Genuinely hard to suppress from page
script, because they reflect real OS-level focus changes. Also genuinely noisy: alt-tab to
re-read the statement is indistinguishable from alt-tab to read an answer.

**Context in a replay, never a flag.** "Left the tab 40 times" is not evidence of
anything, and presenting it as a number invites exactly that reading.

### 4. Duplicate tabs, via BroadcastChannel

Cheap, and detects one real scenario: the same problem open twice. Says nothing about
other origins.

### Derived, and only as a way to sort a review queue

- **Burst insertion** - a large diff with no preceding keystrokes and an implausibly low
  correction rate.
- **Typing rate** - you asked for WPM. Honestly: as a cheating signal on its own it is
  close to worthless. Fast typists exist, and it is trivial to defeat by typing slowly.
  It is worth _displaying_ on a replay timeline, where a reviewer can see it alongside
  what was being typed. It is not worth a threshold.
- **Keystroke timing** - a January 2026 paper demonstrates timing-forgery attacks that
  synthesise plausible human cadence. Treat any timing analysis as corroboration for a
  human, never as proof.

### What not to build

- **DevTools detection.** Every technique has a documented trivial bypass. It would fail
  exactly against the people worth catching while producing false positives against
  curious honest ones.
- **Blocking copy, paste, or the context menu.** Defeated by a browser extension, and it
  breaks legitimate use - moving your own code between problems.
- **Any ML scoring.** See the legal section: it changes the regulatory class of the whole
  system.
- **Webcam or screen capture.** Disproportionate for a practice editor, and it would make
  this a different product.

## Adversarial reality

The recorder is client-side JavaScript. A contestant can disable it, run a modified
build, or edit elsewhere and paste once at the end.

Two consequences the design must hold to:

- **Absence of suspicious events is not evidence of innocence.** A clean log means the
  recorder saw nothing, which is not the same as nothing happening.
- **A broken stream is itself informative.** Sequence numbers, a hash chain over events,
  and periodic heartbeats make gaps and tampering visible. A session with a chain that
  does not verify should be reported as _unverifiable_, not as clean and not as guilty.

## Legal, and this is not optional

**EU AI Act.** Annex III 3(d) classifies AI systems used to monitor and detect prohibited
behaviour by students during tests as **high-risk**, enforceable since 2 August 2026.
Keeping every derived signal **rule-based and published** keeps this outside the
definition of an AI system. Introducing an ML similarity or anomaly model pulls in risk
management, technical documentation, human-oversight design, logging, and conformity
assessment before deployment. That is the single largest architectural constraint here,
and it argues for simple thresholds a contestant can read.

**GDPR - and consent is the wrong instrument here.** For an official round, do _not_
build this on consent. Consent must be freely given, and it is not freely given when
refusing means not competing; a regulator would treat it as invalid, and it would leave
the whole recording without a lawful basis. The basis belongs in the **contest
regulations** accepted at registration.

What is required instead:

- **A transparency notice** before recording starts, listing every signal. Mandatory
  whatever the basis. Implemented as `InvigilationNotice`, and it has to be kept in step
  with what the recorder actually emits.
- **A DPIA.** Systematic monitoring of individuals, and minors involved, so almost
  certainly required.
- **Information for guardians**, since school-age contestants cannot meaningfully consent
  and the basis does not rest on them doing so.

Keystroke timing would be behavioural biometric data; whether it is Article 9 special
category is contested, because it is used for anomaly flagging rather than identification.
That question is currently moot - no timing analysis is recorded beyond the edit log's own
timestamps.

**Human in the loop, always.** Flags order a review queue. No automated verdict, no
automated accusation, no score shown to anyone that looks like a probability of guilt.

## What is built

Phases 0 to 2 are implemented, for official rounds.

- `packages/integrity` - the recorder, the hash-chained queue, and delivery.
- `server/` - ingest and review, append-only JSON lines, no dependencies.
- `InvigilationNotice` - shown before anything is captured; the editor is unreachable
  until it is acknowledged.
- `InvigilationBadge` - a standing indicator, showing what has not yet reached the
  organiser.

Recording happens only when the page is opened with a session link
(`?session=...&participant=...`). Ordinary practice use records nothing and contacts no
server, which is asserted by a test rather than merely intended.

### Surviving a bad network

The requirement that shaped the design: **no recorded event may be lost to the network.**

- Every chunk is written to IndexedDB before any attempt to send it, and marked delivered
  only on acknowledgement.
- Retries back off exponentially to a one-minute ceiling, rather than hammering a server
  that is down.
- Ingest is idempotent by sequence number, because a lost acknowledgement means the client
  will send the same chunk again - and it must be accepted, not rejected or duplicated.
- `sendBeacon` on page hide catches what a closing tab would otherwise strand; it returns
  no acknowledgement, so those chunks stay pending and are re-sent, which is safe for the
  same reason.
- A reload continues the chain rather than starting a new one.

Covered by tests at both levels: unit tests for a dead server, a partial acknowledgement,
a lost acknowledgement, and backoff; end-to-end tests that take the server away mid-round
and take the network away mid-round, and check afterwards that the chain still verifies.

## Original phasing

### Phase 0 - agree the rules (no code)

The consent notice, the retention period, the DPIA, and who may look at a recording. This
has to exist before anything records, and it is the part most likely to change the design.

### Phase 1 - local only, no backend

The recorder runs entirely in the browser. Sessions are stored in IndexedDB alongside the
workspace and can be **exported as a file next to the solution**. A built-in replay viewer
plays one back.

This is worth doing on its own merits, and it is where I would start:

- No transmission, so no privacy surface and no backend to deploy.
- An organiser who wants to check a submission asks for the session file.
- A contestant under suspicion can _volunteer_ their recording to clear themselves.
- The replay viewer is the piece everything else depends on, so it gets built and tested
  before any data leaves a machine.

Consent is still required, because recording starts here.

### Phase 2 - supervised sessions

An organiser creates a session; a contestant joins it explicitly and sees the consent
screen. Events queue in IndexedDB, hash-chained, and flush with `sendBeacon` on
`visibilitychange` and Background Sync where it exists - Chromium only, absent in Firefox
and Safari, so it can never be the only path. Recording is off in ordinary practice use
and there is no way to turn it on remotely.

### Phase 3 - reviewer tooling

A queue ordered by rule-based flags, opening into the replay. Every flag states the rule
that produced it in words. No aggregate score.

## Rough data shape

```ts
type IntegrityEvent =
  | { t: 'edit'; at: number; from: number; to: number; len: number; src: EditSource }
  | { t: 'paste'; at: number; len: number; hash: string; novel: boolean; text?: string }
  | { t: 'focus'; at: number; visible: boolean }
  | { t: 'fullscreen'; at: number; active: boolean }
  | { t: 'tabs'; at: number; count: number }
  | { t: 'run'; at: number; problemId: string; outcome: string }
  | { t: 'beat'; at: number }; // heartbeat, so gaps are visible

interface SessionChunk {
  sessionId: string;
  seq: number; // gaps are detectable
  prevHash: string; // chain, so edits to history show up
  events: IntegrityEvent[];
}
```

`text` is carried only above a size threshold. Everything else is a length and a hash, so
an ordinary session contains no copy of the contestant's code beyond the edit log needed
to replay it.

## What I would build first

Phase 1, and specifically the **replay viewer**, because it is the part that makes every
other decision concrete. Once you can watch a session back, it is obvious which signals
carry information and which are noise - and that judgement is much better made against a
real recording than against a specification.

## Decisions I need from you

1. **Is this for official rounds, or practice?** An official round run by the OI committee
   needs Phase 2 and a real DPIA. A practice tool arguably stops at Phase 1, and Phase 1
   is a fraction of the work and the risk.
2. **Who reviews a recording, and under what rule?** This decides retention and access
   control, and it is a policy question rather than a technical one.
3. **Retention.** I would propose something short - the duration of the round plus an
   appeal window - and automatic deletion after.
4. **Minors.** Polish OI includes school-age contestants. Does consent come from the
   contestant, a guardian, or the school? This may be the constraint that decides whether
   Phase 2 is worth attempting at all.
5. **Are you comfortable with the honest framing?** The tool will catch pasting and will
   not catch a language model in another window. If invigilation is going to be described
   to contestants or organisers as stronger than that, I would rather not build it.
