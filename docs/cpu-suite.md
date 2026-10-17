# YouTube CPU suite

The suite measures Linux **headed Chromium** with an unpacked extension. It is a
manual diagnostic benchmark, not a CI performance gate. It never changes the
extension's runtime or uses your normal browser profile.

Install dependencies and the matching browser (`pnpm install`,
`pnpm exec playwright install chromium`), then run `pnpm build` and
`pnpm verify:bundles`. With no `DISPLAY`, the suite starts its own Xvfb; install
`Xvfb` if needed. An existing `DISPLAY` is reused and left alone. Firefox and
non-Linux measurement environments are unsupported. Report generation does not
require a browser.

## Commands

```sh
pnpm cpu:suite --help
pnpm cpu:suite probe
pnpm cpu:suite run
pnpm cpu:suite run --states reference,neutral,voice-only
pnpm cpu:suite compare --build-a /tmp/build-a --build-b /tmp/build-b --states neutral,active
pnpm cpu:suite report --run-dir /tmp/te-cpu-suite/results/run-EXAMPLE
pnpm cpu:suite topup --run-dir /tmp/te-cpu-suite/results/run-EXAMPLE
```

`compare` consumes already-built unpacked directories, without Git checkouts or
builds. Native scenarios are measured once per round as shared references;
extension scenarios measure both builds. A/B order alternates, scenario order
rotates, and failed pairs are retried in full. Only complete pairs from the same
round and attempt enter comparisons. Codecs, declared frame rate and DPR must
match across builds, and measurement start positions must be within 500 ms;
incompatible pairs are rejected and retried. A/A with the same directory is useful for
checking repeatability, but provides no evidence of an improvement between builds.

`CHROME_PATH` selects a Chromium/Chrome executable that supports unpacked
extension loading; the Playwright Chromium build is the default. `CPU_SUITE_CONFIG` or
`--config` selects a config; CLI state/profile selection overrides that config
for new runs. Paths inside config resolve against the repository root. The
[default config](../tools/cpu-suite/suite.config.json) selects a 360p video,
6-second warmup, 20-second measurement, three rounds and at most three attempts
per slot. Large renderer scatter adds at most two rounds or complete pairs.
A new non-probe experiment first observes background load for 60 seconds.

Unknown options and commands fail before opening a browser. Exit codes are:
`0` complete, `1` invalid input/execution failure, `2` incomplete measurements or
a failed probe. Missing native features are recorded as `native-unavailable`,
not silently treated as disabled. YouTube experiments, account state, region,
consent pages and available encodings can make scenarios unavailable.

## States and extended profile

- `reference`, `native-cinematic`, `native-voice`, `native-stable`, `native-all`:
  no extension; the named native effects are requested. YouTube may switch off
  stable volume when voice boost is enabled; the actual combination is recorded.
- `neutral`: theater, RTE enabled, extension audio effects neutral.
- `boost-focused`, `boost-hidden`: 3× gain, with the volume slider focused and
  focus-visible, or the controls hidden.
- `active`, `paused`: all three extension audio effects active; playing or paused.
- `effects-disabled`: first activate effects, then restore all effects and gain
  to neutral in the same session. This replaces the ambiguous old `disabled`.
- `extension-loaded`: extension loaded, outside theater, RTE disabled.
- `rte-off`: theater active with RTE disabled.
- `voice-only`, `leveling-only`, `bass-only`: individual extension audio effects.
- `captions`: `neutral` with extension captions on. An overlay cue must be visible
  at both ends of warmup and of the measurement window, after the status chip
  has cleared. It is not part of the default matrix; select it with
  `--states captions`.
- `after-exit`: activate theater/audio, exit, verify restored host inline styles,
  neutral effects and gain, then measure ongoing playback.
- `after-navigation`: activate theater/audio, perform same-document YouTube
  navigation to another video, verify new content, enter theater if needed and
  measure the new player. Reload fallback is intentionally rejected.

`--profile extended` adds 1080p/60 fps for the same selected states. Without an
explicit `states` list it also adds `after-exit` and `after-navigation`. To use
navigation, provide a second video in a custom config:

```json
"navigationVideo": {
  "url": "https://www.youtube.com/watch?v=SECOND_ID_HERE",
  "id": "SECOND_ID_HERE",
  "startSec": 10
}
```

Replace both placeholders with the same actual 11-character video id, different
from the primary video. Choose films that actually offer 1080p/60 fps when using
the extended profile. Without a navigation target you can explicitly select
other extended scenarios, for example `--profile extended --states active,paused,after-exit`.

Native volume is verified at the player's 100% setting. YouTube can normalize
the media element below 1.0; its effective volume must remain stable during
measurement, rather than being mistaken for a user turning volume down.

Quality, codecs and declared stream fps must be available and match the scenario.
Native preferences are applied, then the page is reloaded before theater
activation to avoid measuring a stream replaced by a native audio toggle. The
final validation confirms that those preferences survived the reload.
Setup resets playback position after controls/settings preparation, so builds
start their warmup on the same fragment. Paused scenarios use the same position.
The suite checks both ends of warmup/measurement, including content and media
identity, focus, effects, graph readiness, gain and native settings. It does not
continuously poll during the CPU window; an intervening transient that resolves
before the end may escape endpoint validation.

## Results and interpretation

Each experiment receives a unique directory under `$TMPDIR/te-cpu-suite/results`
(or the OS temp directory). It contains `manifest.json`, append-only
`samples.jsonl`, `SUMMARY.md`, `samples.csv`, fresh profiles and bounded setup
logs/screenshots. Generated data is outside the repository. Profiles retain
cookies from that slot and are never reused by another experiment.

The manifest records resolved scenarios, deterministic hashes of **all** build
files, extension versions, optional declared source SHA, CPU/memory information,
Chromium version/path, available GPU/renderer data, display backend, viewport and
DPR. Current Git HEAD is never inferred as the build's source revision. Build hashes
are checked before and after every extension sample, so rebuilding a directory
mid-run cannot silently mix versions.
Unavailable environment information is recorded explicitly as null/unavailable.

`report` reads only the saved experiment, regardless of the current checkout.
`topup` verifies saved configuration, build hashes and environment, fills missing
rounds and applies the bounded scatter policy. An explicit config must resolve to
the saved config exactly. Legacy results remain untouched and cannot be resumed.
A lock prevents two executors modifying the same experiment, including a report
writer racing with an active run. Generate reports after the executor finishes. After a hard kill,
verify that its recorded PID is no longer executing before manually removing a
stale `executor.lock`.

CPU percentages use **100% for one fully occupied CPU core**, and can exceed
100%. GPU process CPU is CPU time of that process, not GPU utilization. Reports
show medians/ranges, required and obtained rounds, instability, rejection
reasons, dropped-frame deltas and paired differences B minus A. Relative
change is unavailable for a zero baseline. Three rounds do not establish
statistical significance. Renderer scatter is an indication to investigate,
not an automatic pass/fail threshold for performance regressions.

The browser uses `--mute-audio` while media itself is unmuted at full volume.
The AudioContext probe adds diagnostic instrumentation. Xvfb/software rendering
can differ from a desktop with hardware acceleration. Keep those conditions
identical across builds and do not generalize results to other browsers,
hardware, authenticated hosts or video qualities. The suite rejects missing/reset
counters and process churn; other Chrome instances count as external load.

Owned browsers and Xvfb are closed on completion, failure, SIGINT and SIGTERM.
External displays and other browser processes are never stopped. A hard kill or
OS crash cannot run cleanup; keep the experiment directory for diagnosis.

## Verification

Run `pnpm typecheck` and
`pnpm exec tsx --test tools/cpu-suite/suite.test.ts tools/cpu-suite/browser.test.ts`.
`pnpm test` also discovers these tests. They check pure logic, persistence,
pair retries and fixture-based browser instrumentation/transitions/cleanup.
Fixtures do not establish real YouTube availability or installed-extension
behavior. For that, build first, run `probe`, then a real A/B experiment, and
separately check extended quality and transition scenarios. An unavailable host
or native feature is a verification gap, never a passed measurement.

## Generic, chat, Disney and transport mechanisms

Use the separate [resource fixture audit](resource-audit.md) for portable
Chromium/Firefox query/layout/observer/timer counters, portal retention evidence,
Disney Hive-clock states and routed YouTube clone/caption-body diagnostics. It
accepts arbitrary prebuilt unpacked A/B directories and records its injection
status explicitly. These fixtures complement the headed CPU suite; they do not
add real-host CPU coverage or establish installed-extension behavior. The guide
also describes separate peak-allocation/retention and authenticated Disney
measurement procedures.
