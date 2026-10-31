import optionsCss from '../options/options.css?inline';
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

declare global {
  interface Window { __setupStage?: SetupStage }
}

const frameHtml = (css: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Settings fixture</title>
<style>${css}</style></head><body><div class="options-container"><section id="setup-wizard" class="main-card"></section></div></body></html>`;

/**
 * The production setup in a document of its own carrying the Settings stylesheet (it would restyle the preview
 * otherwise), with in-memory storage. Fixture rendering only: no extension storage, sync or install.
 */
export function renderSetup(options: { sync?: Record<string, unknown>; state?: SetupState; start?: SetupWizardOptions['start'] } = {}): HTMLElement {
  const { scope, view } = beginStage();
  const frame = document.createElement('iframe');
  frame.title = 'Settings fixture';
  view.style.cssText = 'position:fixed;inset:0';
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
  frame.srcdoc = frameHtml(optionsCss);
  view.append(frame);
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
  stage.ready = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true })).then(async () => {
    if (scope.isDisposed) return;
    const doc = frame.contentDocument!;
    stage.doc = doc;
    window.__storyDocument = doc;
    // The element, not the document: `instanceof Document` is false across realms.
    localizeDocument(doc.documentElement);
    // A named accent: headless engines pair a light system accent with white text, which no real system does.
    applyAccentColorPreset(doc.documentElement, 'purple');
    scope.add(observeAppearance(doc.documentElement));
    const wizard = mountSetupWizard(doc.getElementById('setup-wizard')!, {
      storage, version: '2.1.0', start: options.start,
      leave: section => { stage.left.push(section); }
    });
    scope.add(() => wizard.dispose());
    await wizard.ready;
  });
  stage.ready.catch(() => {});
  window.__setupStage = stage;
  // Shots hold every animation of the fixture document, such as the step entrance, at one fraction.
  window.__storyFrame = progress => {
    const doc = stage.doc;
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
    delete window.__setupStage;
  });
  return view;
}
