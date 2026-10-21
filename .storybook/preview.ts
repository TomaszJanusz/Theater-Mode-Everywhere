import type { Preview } from '@storybook/html-vite';

import '../src/content.css';
import { resolveReduceMotion } from '../src/appearance-preferences';
import { languageRuntime } from '../src/i18n-runtime';
import { LANGUAGES } from '../src/language';
import { setPlayerUiCss } from '../src/ui/root';
import shadowCss from '../src/ui/shadow.css?inline';

import { installChromeStub, setSyncStorage } from './chrome-stub';
import { disposeStage } from './stage-owner';
import './preview.css';

installChromeStub();
setPlayerUiCss(shadowCss);

const preview: Preview = {
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
  initialGlobals: { backdrop: 'dark', locale: 'en', reduceMotion: 'off' },
  globalTypes: {
    backdrop: {
      description: 'Picture behind the player UI. The UI itself has one dark skin.',
      toolbar: { title: 'Backdrop', items: ['dark', 'light'], dynamicTitle: true }
    },
    locale: {
      description: 'Catalog from _locales, loaded through the production language runtime.',
      toolbar: { title: 'Locale', items: LANGUAGES.map(({ locale }) => locale), dynamicTitle: true }
    },
    reduceMotion: {
      description: 'Reduce motion preference, written to storage like the options page.',
      toolbar: { title: 'Reduce motion', items: ['auto', 'on', 'off'], dynamicTitle: true }
    }
  },
  beforeEach: () => () => disposeStage(),
  decorators: [(story, context) => {
    window.__storyState = { globals: { ...context.globals }, args: { ...context.args } };
    return story();
  }],
  loaders: [async ({ globals }) => {
    document.body.dataset.backdrop = String(globals.backdrop);
    setSyncStorage({ reduceMotion: resolveReduceMotion(globals.reduceMotion) });
    await languageRuntime.set(globals.locale);
    // The bundled Roboto loads lazily; layout that measures text (title marquee) must not run on fallback metrics.
    // Failed or stalled font requests must still let the interactive preview render with fallback fonts.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(['400', '500', '600', '700'].map(weight => document.fonts.load(`${weight} 16px Roboto`))),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 3000); })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }]
};

export default preview;
