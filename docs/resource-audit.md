# Resource mechanism fixtures

This is the portable companion to the [Linux headed Chromium CPU suite](cpu-suite.md),
for TME-35 / TME-25. Its small separate runner avoids making the YouTube CPU
state/validation model pretend to cover unrelated pages. It reuses build identity
and verification from that suite. It does not change product code.

## Run and compare

Install the matching Playwright Chromium/Firefox builds as described in
[browser-tests.md](browser-tests.md). Supply an **already built unpacked directory**:

```sh
pnpm resource:audit --build-a /tmp/te-tme35/build-head --output /tmp/te-tme35/results --sha SOURCE_SHA --rounds 3 --cycles 20
pnpm resource:audit --build-a /tmp/te-tme35/build-head --output /tmp/te-tme35/results --browser firefox --rounds 3
pnpm resource:audit --build-a /tmp/build-a --build-b /tmp/build-b --output /tmp/resource-ab --rounds 3
pnpm resource:audit --build-a /tmp/build-a --output /tmp/resource-heap --heap true --cycles 100 --fixtures chat-portals
```

Headless fixtures work in both engines; Firefox cannot use CDP heap diagnostics.
No Git query, build, version inference, profile reuse or extension installation is
performed by the runner. `--sha` is an optional **declared A revision**, never
inferred from the harness checkout. For B, attach its source revision/build
provenance separately; the hash of every build file is always recorded and
checked before/after each sample. `--build-b` accepts another worktree's unpacked
output, without copying its sources. A/B members have fresh contexts, share the
same fixture and round, alternate A→B/B→A, and a rejected member excludes both.
`--fixtures` selects a comma-separated subset for focused repeats. There are no silent retries. Exit 2 means rejected samples, exit 1 means invalid
input or executor failure. Successful execution is a measurement, not an
optimization pass/fail gate.

For an immutable baseline without repository build output, archive the intended
revision to a temporary directory, link its `node_modules` to the existing
installation, and run `CI=true ./node_modules/.bin/tsx scripts/build.ts` **there**.
Unset release/tag overrides to preserve the package version. Copy that temporary
`dist/chrome-unpacked` to `/tmp/te-tme35/build-head`. Do not run the build in a
checkout containing concurrent product changes and label it as the old HEAD.

Every run creates a unique output subdirectory with `manifest.json`, raw
`samples.jsonl`, `server-requests.json`, and `SUMMARY.md`. The manifest includes
build version/hash/source declaration, harness/media hashes, browser version,
OS/CPU/memory, geometry/DPR, clock/audio and installation status. Keep results,
profiles, allocation files, heap snapshots and traces outside source control.
Rejected rows retain phase evidence and errors; do not drop them from review.

## Workloads and evidence

The fixture server binds loopback on an ephemeral port. Host routes proxy local
documents/media/data under Twitch, YouTube and Disney URLs, with no real host
requests. Unmapped requests are aborted. Bundles are loaded from the supplied
build, scoped separately to avoid collisions between MAIN and content globals.
Storage is mocked with explicit enabled integrations, persistent controls, and
Twitch dark-theme/visibility preferences. RTE attributes and visible state are
recorded and checked; this is **diagnostic injection in one page world**, not
proof of installation, background handling, permissions or cross-world wiring.

- Generic: 20,000 unrelated divs without video and 100 composed mousemove
  events; 12 same-origin iframe startups with individual counter readouts; late
  open-shadow video insertion, theater entry and exit.
- Chat: generic absent; Twitch live and native VOD replay; native-hidden chat
  despite a saved open preference; hide/show round trip; 20–100 portal add/remove cycles with alternating
  light/dark theme selections; theater exit and removal of chat ownership.
  DOM absence alone cannot establish that detached portals were collected.
- Disney: catalog without player; playback; paused extension seek through the
  media-seek event to the Hive stub and seek-complete callback; simulated hidden
  document; SPA media/player replacement, reentry when needed, and exit. The
  stub exposes the host's discovery/timeline/event shape, with the timed-text
  shadow region used in `src/providers/disney/stage.test.ts`. Playhead getter
  counts and published clock/media identity are in raw state. Stub time is fixed
  except on seek; it is not a playback timing or proprietary API fidelity test.
- YouTube: unrelated 4 MiB response and a separate VTT timedtext response.
  Fetch passes through the build's real wrapper; the driver reads its returned
  response and waits for instrumented body readers to settle. Clone/body-read
  counts and supplied/consumed bytes expose transport mechanisms. This does not
  exercise caption overlay rendering, all cache budgets, account tokens or
  language switching; those require the memory procedure below.

Clock horizons are explicit (startup/settling 1 s, steady 4 s, portal 1 s before
and after removal), using Playwright's controlled clock rather than wall sleeps.
The 30 s wall watchdog fails and closes a stalled context; it is not a settling
heuristic. Native media loading waits on metadata/error. Native media decoding
and events are not controlled by the fake JS clock, so incidental query/layout
counts can vary; compare repeated ranges rather than requiring exact totals.
Counter instrumentation is installed after clock replacement and before either
bundle, then read via `page.evaluate`. It wraps document/element/fragment queries,
rect/computed-style reads, observer callbacks/registrations, timeout/interval/rAF
scheduling and cancellation, Response clone/body readers, stringify and decode.
Counts include driver work within the phase (e.g. portal queries). Endpoint readout work is
outside its delta; state assertions inside a fixture action are included. Input
and output states are both saved for each phase. Wrappers preserve native dispatch and do not keep DOM target
registries. Active observers mean explicit observe minus disconnect operations,
not a GC-derived count of native observer objects. Layout-read calls do not prove
forced layout. Synthetic movement does not measure mouse frequency or jank.

The local server writes data in 64 KiB chunks with backpressure; Playwright route
fulfillment buffers it **before delivery to the browser**. The browser response
still exposes a stream and its clone uses native tee semantics, but fixture
allocation/peak results do not reproduce a paced network or authenticated CDN.
Server bytes are supplied bytes, not proof of retained clone bytes. Host clock,
visibility throttling, iframe process topology and extension isolation differ
from these fixtures. CPU and GPU are deliberately not measured by this runner.

## Heap, allocations, bloat and leak

Chromium phase endpoints use `Performance.getMetrics().JSHeapUsedSize`.
`--heap true` additionally saves `HeapProfiler.startSampling/stopSampling`
allocation profiles (32 KiB sampling, including collected objects), post-GC heap,
and, for portal churn, post-GC heap/DOM counters before churn, after churn and
after exit, plus snapshots for both latter states. Raw byte counts and phase
endpoints are available separately from sampled allocations. Firefox records
heap as unavailable rather than substituting a different metric. Profiling/GC
changes execution; run it separately from CPU trials.

For a real YouTube memory investigation, use the intended installed build and
verify RTE/caption state first. Keep the same video/fragment/quality/codec/fps,
DPR, geometry, controls and audio. In separate profiling runs:

1. Compare streaming fetch with original consumption and with ignored/consumed
   clone branches. Record response size, byte reads and native/network buffering.
   Capture frequent heap metrics and an allocation timeline during the transfer;
   phase endpoints and sampled profiles alone can miss the peak.
2. Measure post-GC retained baseline before and after 20/50/100 language,
   navigation and enter/exit cycles. Verify visible cues, current media/adapter
   identity, host-caption ownership and old-session cleanup at each boundary.
3. Inspect snapshot retainer paths in the appropriate frame and MAIN/isolated
   world. Short-lived allocation is transient; a stable retained working set is
   bloat; growing reachable objects across equal cycles with a concrete retaining
   owner support a leak claim. GC/noise and sampled bytes are not a leak verdict.

For portals, compare `after-churn` (session still alive) with `after-exit`, inspect
detached nodes retained by theme ownership, and repeat with 20 and 100 cycles.
Harness snapshots do not automatically classify retainers or prove an installed
extension leak. They preserve evidence for that analysis.

## Real-host CPU/timing procedure and gaps

Use existing `pnpm cpu:suite compare --build-a /tmp/build-a --build-b /tmp/build-b`
for its supported YouTube states on **Linux headed Chromium**, including Xvfb
when required. Keep video, fragment, quality, codec, declared fps, DPR, viewport,
controls and audio constant. Pair rounds and alternate order; retain rejected
samples and environment/build hashes. Take CPU windows **without** JS/heap/trace
profilers, then record JS/render/audio traces separately with the same workload.
GPU-process CPU is not GPU utilization; Xvfb/software rendering is a coverage gap.
The mechanism companion adds no CPU-suite states, so it cannot be used to claim
CPU savings for generic/chat/Disney. Do not force the headed suite on macOS or
Firefox; Firefox mechanism support does not imply Firefox CPU support.

Disney real-host work remains an authenticated-host gap: load the intended
extension build, prove installation and active Disney RTE, then separately
record catalog, playing, paused seek-complete, hidden/visible, SPA replacement
and theater exit. Save native playhead/extension-clock timing, CPU windows,
post-GC heap/retainers and timing video where useful. Repeat paired builds with
the same content and media conditions. Without an account these fixtures are
baseline mechanism evidence only, never a real Disney result.

## Verification

```sh
pnpm typecheck
RESOURCE_AUDIT_BUILD=/tmp/te-tme35/build-head pnpm exec tsx --test tools/cpu-suite/suite.test.ts tools/cpu-suite/browser.test.ts tools/cpu-suite/resource.test.ts tools/cpu-suite/resource.browser.test.ts
git diff --check
```

The browser smoke runs every fixture in Chromium and Firefox on unpacked built
bundles. It defaults to `dist/chrome-unpacked`; absence of the default build or
browser is a reported skip. An explicitly supplied invalid build fails. Separate
instrumentation checks cover repeated observe/disconnect, cross-cancellation of
timeout/interval IDs, rAF cancellation and clone/body byte accounting. Unit tests
cover CLI limits, counter validation, reports and incomplete pair exclusion.
