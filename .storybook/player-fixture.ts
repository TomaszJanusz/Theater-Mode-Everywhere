import latin400 from '@fontsource/roboto/latin-400.css?inline';
import latin500 from '@fontsource/roboto/latin-500.css?inline';
import latin600 from '@fontsource/roboto/latin-600.css?inline';
import latin700 from '@fontsource/roboto/latin-700.css?inline';
import playerScript from 'virtual:player-fixture';

import { resolveReduceMotion } from '../src/appearance-preferences';
import pageCss from '../src/content.css?inline';
import { createChromeStub, type ChromeStub } from '../src/test-utils/page-chrome-stub';
import { ENTRY_SHORTCUT_ATTRIBUTE } from '../src/ui/entry-shortcuts';
import uiCss from '../src/ui/shadow.css?inline';
import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../src/whatsNew-release';
import vod from '../test/fixtures/vod.webm?url';

import { waitForFonts } from './fonts';
import { beginStage } from './stage-owner';

// Menus that the production bar pins open on click. Volume and speed open on hover or focus, which tests drive with real input.
export const SCENARIOS = ['watching', 'settings', 'captions', 'help'] as const;
export type Scenario = typeof SCENARIOS[number];

export interface PlayerEnvironment { locale: string; backdrop: string; reduceMotion: string }

/** Fixed position in the two-second clip, so every capture shows the same decoded frame. */
const MEDIA_TIME = 1;
const MENU_TRIGGER: Record<Exclude<Scenario, 'watching' | 'help'>, string> = { settings: '.player-settings-btn', captions: '.cc-btn' };

type FixtureWindow = Window & typeof globalThis;
/** The global the fixture bundle defines (see player-runtime-entry.ts). */
interface Runtime { setPlayerUiCss(css: string): void; bootstrapPlayerRuntime(): void }

declare global {
  interface Window {
    /** The document the Player story's production runtime lives in, for harnesses that inspect it. */
    __storyDocument?: Document;
    __playerFixture?: PlayerFixture;
  }
}

const frameHtml = (css: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture clip</title>
<style>${css}</style>
<style>html,body{margin:0;height:100%;background:#000}
video{width:100vw;height:100vh;object-fit:contain}
/* Bright backdrop: the same local clip, inverted. Deterministic, and no second asset. */
html[data-backdrop="light"] video{filter:invert(1)}</style></head>
<body><video src="${vod}" muted playsinline preload="auto"></video></body></html>`;

function tick(win: Window): Promise<void> {
  return new Promise(done => win.requestAnimationFrame(() => win.requestAnimationFrame(() => done())));
}

function waitFor(win: Window, condition: () => boolean, what: string): Promise<void> {
  return new Promise((done, fail) => {
    const started = performance.now();
    const check = () => {
      if (condition()) done();
      else if (performance.now() - started > 8000) fail(new Error(`Player fixture: timed out waiting for ${what}`));
      else win.requestAnimationFrame(check);
    };
    check();
  });
}

/** Resolves when the video has presented a frame, or after two paints if it already had. */
function frameShown(video: HTMLVideoElement, win: Window): Promise<void> {
  return Promise.race([
    new Promise<void>(done => video.requestVideoFrameCallback?.(() => done())),
    tick(win)
  ]).then(() => tick(win));
}

function once(target: EventTarget, type: string): Promise<void> {
  return new Promise(done => target.addEventListener(type, () => done(), { once: true }));
}

/**
 * The shipped player runtime on local fixture media, in a fixture document of its own. The
 * runtime is a page-lifetime singleton with its own listeners and timers; removing the document
 * is the single disposer that retires all of them. Only the extension edge is stubbed.
 */
export class PlayerFixture {
  readonly view = document.createElement('div');
  private readonly frame = document.createElement('iframe');
  private readonly stub: ChromeStub;
  private revision = 0;
  private disposed = false;
  private pending: Promise<void>;

  constructor(environment: PlayerEnvironment, private scenario: Scenario) {
    this.stub = createChromeStub({
      // Controls stay up for captures. New-feature badges follow the release's version, so they stay off
      // and a version bump does not change what the Player shows.
      sync: { keepControlsVisible: true, pictureAlign: 'center', highlightNewFeatures: false, ...this.preferences(environment) },
      local: { [WHATS_NEW_ACK_STORAGE_KEY]: WHATS_NEW_RELEASE.id }
    });
    this.view.style.cssText = 'position:fixed;inset:0';
    this.frame.title = 'Fixture document';
    this.frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
    this.frame.srcdoc = frameHtml([latin400, latin500, latin600, latin700, pageCss].join('\n'));
    const loaded = once(this.frame, 'load');
    this.view.append(this.frame);
    this.pending = loaded.then(() => this.boot()).then(() => this.settle(environment, this.revision));
    // A rejected setup surfaces through the story's play function; do not also report it unhandled.
    this.pending.catch(() => {});
  }

  /** Settles when the player bar is showing a decoded frame at the fixed time. */
  get ready(): Promise<void> { return this.pending; }

  get window(): FixtureWindow {
    const win = this.frame.contentWindow;
    if (!win) throw new Error('Player fixture document is gone');
    return win as FixtureWindow;
  }

  get chromeStub(): ChromeStub { return this.stub; }

  get root(): ShadowRoot {
    const root = this.window.document.getElementById('theater-everywhere-ui')?.shadowRoot;
    if (!root) throw new Error('Player UI root is not mounted');
    return root;
  }

  private preferences({ locale, reduceMotion }: PlayerEnvironment): Record<string, unknown> {
    return { language: locale, reduceMotion: resolveReduceMotion(reduceMotion) };
  }

  private async boot(): Promise<void> {
    const win = this.window;
    const doc = win.document;
    Object.defineProperty(win, 'chrome', { configurable: true, value: this.stub.chrome });
    const script = doc.createElement('script');
    script.textContent = playerScript;
    doc.head.append(script);
    const runtime = Reflect.get(win, 'TheaterTest') as Runtime;
    runtime.setPlayerUiCss(uiCss);
    runtime.bootstrapPlayerRuntime();
    const video = doc.querySelector('video')!;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) await once(video, 'loadedmetadata');
    // Native TextTracks are the first caption slice: the production CC menu lists them as it does on a host page.
    for (const [label, language, text] of [['English', 'en', 'Fixture captions'], ['Deutsch', 'de', 'Fixture-Untertitel']]) {
      const track = video.addTextTrack('subtitles', label, language);
      track.addCue(new win.VTTCue(0, 2, text));
    }
    await waitForFonts(doc);
    // Settings are read asynchronously; the runtime publishes its entry shortcuts once its key handler is live.
    await waitFor(win, () => doc.documentElement.hasAttribute(ENTRY_SHORTCUT_ATTRIBUTE), 'the runtime to initialize');
    // Seek before entering theater, so the frame at MEDIA_TIME is shown before the bar's backdrop exists.
    const seeked = once(video, 'seeked');
    video.currentTime = MEDIA_TIME;
    await seeked;
    await frameShown(video, win);
    // The same user action as pressing the theater key; the runtime enters through its own handler.
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
    await waitFor(win, () => Boolean(doc.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-controls-wrapper.visible')), 'the player bar');
    video.pause();
    window.__storyDocument = doc;
  }

  /** Applies environment and scenario to the live document, then waits until it is painted. */
  private async settle(environment: PlayerEnvironment, revision: number): Promise<void> {
    if (this.disposed) return;
    const win = this.window;
    const doc = win.document;
    doc.documentElement.dataset.backdrop = environment.backdrop;
    const wanted = this.preferences(environment);
    const host = () => doc.getElementById('theater-everywhere-ui');
    this.stub.setSyncStorage(wanted);
    // The production language runtime loads the catalog and rebuilds the bar; media is untouched.
    await waitFor(win, () => host()?.lang === environment.locale, `locale ${environment.locale}`);
    await tick(win);
    if (revision !== this.revision || this.disposed) return;
    this.showScenario(this.scenario);
    // Finite transitions (menu fade, bar reveal) end before anything is read or captured.
    await Promise.all([...doc.getAnimations(), ...this.root.getAnimations()].filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
    await tick(win);
  }

  private showScenario(scenario: Scenario): void {
    // The shortcuts help is a dialog, not a menu: it opens from the help button and closes with its own button.
    const help = this.root.querySelector<HTMLElement>('.theater-help-overlay');
    if (scenario === 'help') {
      if (!help) this.root.querySelector<HTMLElement>('.help-btn')?.click();
      if (!this.root.querySelector('.theater-help-overlay')) throw new Error('Player fixture: no control for help');
      return;
    }
    help?.querySelector<HTMLElement>('.te-dialog-close')?.click();
    // Production menus exclude each other: opening one closes another, so only a menu to retire needs a click.
    for (const trigger of this.root.querySelectorAll<HTMLElement>('[aria-expanded="true"]')) {
      if (scenario === 'watching' || !trigger.matches(MENU_TRIGGER[scenario])) trigger.click();
    }
    if (scenario === 'watching') return;
    const trigger = this.root.querySelector<HTMLElement>(MENU_TRIGGER[scenario]);
    if (!trigger) throw new Error(`Player fixture: no control for ${scenario}`);
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  }

  update(environment: PlayerEnvironment, scenario: Scenario): void {
    this.scenario = scenario;
    const revision = ++this.revision;
    this.pending = this.pending.then(() => this.settle(environment, revision));
    this.pending.catch(() => {});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.stub.dispose();
    if (window.__storyDocument === this.frame.contentDocument) window.__storyDocument = undefined;
    this.frame.remove();
    if (window.__playerFixture === this) window.__playerFixture = undefined;
  }
}

/** Mounts the fixture once per story render, and updates it in place for arg and global changes. */
export function renderPlayer(environment: PlayerEnvironment, scenario: Scenario): HTMLElement {
  const existing = window.__playerFixture;
  if (existing) {
    existing.update(environment, scenario);
    return existing.view;
  }
  const { scope } = beginStage();
  const fixtureView = new PlayerFixture(environment, scenario);
  window.__playerFixture = fixtureView;
  scope.add(() => fixtureView.dispose());
  return fixtureView.view;
}
