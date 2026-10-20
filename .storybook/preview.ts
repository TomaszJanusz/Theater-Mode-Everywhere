import type { Preview } from '@storybook/html-vite';

import '../src/content.css';
import { languageRuntime } from '../src/i18n-runtime';
import { LANGUAGES } from '../src/language';
import { setPlayerUiCss } from '../src/ui/root';
import shadowCss from '../src/ui/shadow.css?inline';

import { installChromeStub, setSyncStorage } from './chrome-stub';
import './preview.css';

installChromeStub();
setPlayerUiCss(shadowCss);

const preview: Preview = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  initialGlobals: { backdrop: 'dark', locale: 'en', reduceMotion: 'on' },
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
      toolbar: { title: 'Motion', items: ['on', 'off'], dynamicTitle: true }
    }
  },
  loaders: [async ({ globals }) => {
    document.body.dataset.backdrop = String(globals.backdrop);
    setSyncStorage({ reduceMotion: globals.reduceMotion === 'off' ? 'off' : 'on' });
    await languageRuntime.set(globals.locale);
    // The bundled Roboto loads lazily; layout that measures text (title marquee) must not run on fallback metrics.
    await Promise.all(['400', '500', '600', '700'].map(weight => document.fonts.load(`${weight} 16px Roboto`)));
  }]
};

export default preview;
