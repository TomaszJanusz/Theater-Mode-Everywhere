import optionsCss from '../options/options.css?inline';
import type { ResetPatch, SetupAnswers } from '../options/setup-answers';
import { mountSetupActions } from '../options/setup-reset';
import { mountSetupWizard, type SetupStorage, type SetupWizardOptions } from '../options/setup-wizard';
import { applyAccentColorPreset } from '../src/accentTheme';
import { observeAppearance } from '../src/appearance-runtime';
import { INSTALL_SHORTCUTS, type SetupState } from '../src/first-run-setup';
import { localizeDocument } from '../src/i18n';

import { beginStage } from './stage-owner';

/** What sync holds right after a fresh install wrote its defaults. */
export const FRESH_SYNC = { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [], autoEnterTheater: false };

export interface SetupStage {
  /** The fixture Settings document the setup renders in. */
  doc: Document;
  ready: Promise<void>;
  /** Settings sections the setup asked to open, in order. */
  left: string[];
  saved: Array<{ settings: Record<string, unknown>; state?: SetupState }>;
}

export interface SetupActionsStage {
  doc: Document;
  ready: Promise<void>;
  /** Resets applied to the in-memory sync, in order. */
  resets: ResetPatch[];
  /** Setup starts requested, with their preselection (`undefined`: the saved settings). */
  started: Array<SetupAnswers | undefined>;
}

declare global {
  interface Window { __setupStage?: SetupStage; __setupActionsStage?: SetupActionsStage }
}

const frameHtml = (css: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Settings fixture</title>
<style>${css}</style></head><body><div class="options-container">${body}</div></body></html>`;

/** A Settings fixture document in the story view; `ready` settles once it loaded and is localized. */
function settingsFrame(body: string) {
  const { scope, view } = beginStage();
  const frame = document.createElement('iframe');
  frame.title = 'Settings fixture';
  view.style.cssText = 'position:fixed;inset:0';
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
  frame.srcdoc = frameHtml(optionsCss, body);
  view.append(frame);
  const loaded = new Promise<Document | undefined>(resolve => frame.addEventListener('load', () => {
    if (scope.isDisposed) return resolve(undefined);
    const doc = frame.contentDocument!;
    window.__storyDocument = doc;
    // The element, not the document: `instanceof Document` is false across realms.
    localizeDocument(doc.documentElement);
    // A named accent: headless engines pair a light system accent with white text, which no real system does.
    applyAccentColorPreset(doc.documentElement, 'purple');
    scope.add(observeAppearance(doc.documentElement));
    resolve(doc);
  }, { once: true }));
  // Shots hold every animation of the fixture document, such as the step entrance, at one fraction.
  window.__storyFrame = progress => {
    const doc = frame.contentDocument;
    if (scope.isDisposed || !doc) return 0;
    const animations = doc.getAnimations();
    for (const animation of animations) {
      const timing = animation.effect?.getComputedTiming();
      animation.pause();
      animation.currentTime = Number(timing?.delay ?? 0) + progress * Number(timing?.duration ?? 0);
    }
    return animations.length;
  };
  scope.add(() => {
    delete window.__storyFrame;
    delete window.__storyDocument;
  });
  return { scope, view, loaded };
}

/**
 * The production setup in a document of its own carrying the Settings stylesheet (it would restyle the preview
 * otherwise), with in-memory storage. Fixture rendering only: no extension storage, sync or install.
 */
export function renderSetup(options: { sync?: Record<string, unknown>; state?: SetupState; start?: SetupWizardOptions['start'] } = {}): HTMLElement {
  const { scope, view, loaded } = settingsFrame('<section id="setup-wizard" class="main-card"></section>');
  const sync = structuredClone(options.sync ?? FRESH_SYNC);
  let state: unknown = options.state;
  const listeners = new Set<() => void>();
  const stage = { left: [], saved: [] } as unknown as SetupStage;
  const storage: SetupStorage = {
    read: async () => ({ sync: structuredClone(sync), state }),
    save: async (settings, next) => { Object.assign(sync, settings); state = next; stage.saved.push({ settings, state: next }); },
    saveState: async next => { state = next; stage.saved.push({ settings: {}, state: next }); },
    onSyncChange: listener => { listeners.add(listener); return () => listeners.delete(listener); }
  };
  stage.ready = loaded.then(async doc => {
    if (!doc) return;
    stage.doc = doc;
    const wizard = mountSetupWizard(doc.getElementById('setup-wizard')!, {
      storage, version: '2.1.0', start: options.start,
      leave: section => { stage.left.push(section); }
    });
    scope.add(() => wizard.dispose());
    await wizard.ready;
  });
  stage.ready.catch(() => {});
  window.__setupStage = stage;
  scope.add(() => { delete window.__setupStage; });
  return view;
}

/**
 * The production "Run setup again" and "Reset to defaults" card of Settings → About, with in-memory sync. The
 * confirmation mounts in the fixture document. Fixture rendering only: no extension storage, sync or setup.
 */
export function renderSetupActions(sync: Record<string, unknown>): HTMLElement {
  const { scope, view, loaded } = settingsFrame('<div class="main-card about-card"><section id="setup-actions" class="about-legal about-setup"></section></div>');
  const stored = structuredClone(sync);
  const stage = { resets: [], started: [] } as unknown as SetupActionsStage;
  stage.ready = loaded.then(doc => {
    if (!doc) return;
    stage.doc = doc;
    scope.add(mountSetupActions(doc.getElementById('setup-actions')!, {
      storage: {
        readSync: async () => structuredClone(stored),
        reset: async patch => {
          for (const key of patch.remove) delete stored[key];
          Object.assign(stored, patch.set);
          stage.resets.push(patch);
        }
      },
      start: initial => { stage.started.push(initial); },
      mount: overlay => doc.body.append(overlay)
    }));
  });
  stage.ready.catch(() => {});
  window.__setupActionsStage = stage;
  scope.add(() => { delete window.__setupActionsStage; });
  return view;
}
