# Hosting sioditor

The app is static, but not _any_ static host will do: it needs response headers a
platform like GitHub Pages cannot set. Hosting is self-managed, so this is all under our
control — `deploy/` holds a working Caddy config, an nginx equivalent, and a Dockerfile.

## What the server must do

**1. Cross-origin isolation.**

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`SharedArrayBuffer` is gated on these, and it backs Pyodide's interrupt buffer (so a
runaway program can be stopped with a real `KeyboardInterrupt` rather than by destroying
the interpreter) and blocking stdin. Without the headers the app still runs — it falls
back to terminating the worker — but it is strictly worse, and the failure is silent.
So the app asserts `crossOriginIsolated` and an e2e test checks it.

**The consequence that decides asset hosting:** under `require-corp`, every cross-origin
subresource must carry `Cross-Origin-Resource-Policy`. We cannot set that on GitHub
Releases or jsDelivr, so the Pyodide and clang payloads are vendored at build time and
served from our own origin. That also removes any dependency on a third party being
reachable during a contest.

**2. `application/wasm`.** Anything else disables streaming compilation _and_ Chrome's
wasm code cache. Both failures are invisible; the app is just slower on every load.

**3. Immutable caching on version-stamped URLs.** Chrome's compiled-wasm code cache is
keyed on resource URL, so a cache-busting query string throws away the compiled machine
code on every visit. Asset paths already carry their version (`/pyodide/0.29.4/…`), so
they can be pinned for a year. The shell (`/`, `/index.html`, `/sw.js`) must be
`no-cache` or updates never land.

**4. Build-time brotli.** Compression is done once during the build and the `.br` files
are served directly. brotli-11 on the sysroot image takes about 47 seconds — that is not
something to do per request. Measured: the packed sysroot goes from 22.7 MB to 3.88 MB.

**5. HTTPS.** Service workers, OPFS and `SharedArrayBuffer` all require a secure
context. `localhost` is exempt, so local development needs nothing special.

## Verifying a deployment

```
node scripts/check-headers.mjs https://sioditor.example.org
```

Run it after every deploy. It checks COOP/COEP, the wasm content type, and the caching
rules, and reports whether brotli is actually being served.

## A room with no internet

The Docker image is self-contained: build it, run it on a laptop on the local network,
and point the room at it. Everything the app needs is inside — no CDN, no GitHub. Each
machine still downloads the packs once from that laptop, then works entirely offline.

## Storage, and the iOS trap

Toolchains live in OPFS and Cache Storage, which are subject to eviction. The app calls
`navigator.storage.persist()` on first install; Chrome grants it silently from
engagement heuristics, Firefox prompts.

Safari is the problem. Under ITP, an origin not interacted with for seven days loses all
script-writable storage — **unless it is an installed Home Screen web app**, which is
exempt. So iOS users get an explicit install prompt rather than a suggestion to
bookmark. Without it they re-download everything after a week away, quite possibly on
the morning of a round.
