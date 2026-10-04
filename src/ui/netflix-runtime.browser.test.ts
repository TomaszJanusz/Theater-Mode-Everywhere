import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function compile(relativePath: string): string {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

function esbuildBundle(): string {
  const esbuild = require('esbuild') as {
    buildSync: (options: {
      entryPoints: string[];
      bundle: boolean;
      write: boolean;
      format: 'iife';
      platform: 'browser';
      target: string;
      logLevel: 'silent';
    }) => { outputFiles: Array<{ text: string }> };
  };
  const result = esbuild.buildSync({
    entryPoints: [new URL('../entries/main-world.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  });
  return result.outputFiles[0].text;
}

describe('netflix runtime browser regressions', () => {
  it('hides ancestor videos, rebinds after a style-only hide, restores mask longhands, and boots MAIN without a player id', async () => {
    let executable = '';
    const { chromium } = await import('playwright');
    try {
      executable = chromium.executablePath();
    } catch {
      return;
    }
    if (!existsSync(executable)) return;

    const playback = compile('./netflix-playback.ts');
    const stage = compile('./netflix-stage.ts');
    const bundle = esbuildBundle();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(4000);
      await page.setContent(`<!doctype html><style>
        video { display: block; width: 100%; height: 100%; }
        #hidden-hero { width: 400px; height: 220px; visibility: hidden; }
        #modal-wrap { width: 420px; height: 236px; opacity: 1; }
        #visible { width: 320px; height: 180px; }
      </style><body>
        <div id="hidden-hero"><video id="hero"></video></div>
        <div id="modal-wrap" class="nf-player-container"><video id="modal"></video></div>
        <video id="visible"></video>
        <div id="shell" style="position:fixed; mask-image: linear-gradient(#000, transparent); background-image: linear-gradient(#111, #222); background-color: rgb(1, 2, 3);"><video id="pinned"></video></div>
      </body>`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({
        content: `${playback}\n${stage}\nwindow.__nf = { readNetflixVideoFacts, netflixPlaybackRank, shouldFollowNetflixVideo, createNetflixVideoBinding, holdNetflixViewport, releaseNetflixViewport };`,
        type: 'module'
      });

      const facts = await page.evaluate(`(() => {
        const api = window.__nf;
        return {
          hero: api.readNetflixVideoFacts(document.querySelector('#hero')).usable,
          modal: api.readNetflixVideoFacts(document.querySelector('#modal')).usable,
          visible: api.readNetflixVideoFacts(document.querySelector('#visible')).usable
        };
      })()`) as { hero: boolean; modal: boolean; visible: boolean };
      assert.equal(facts.hero, false);
      assert.equal(facts.modal, true);
      assert.equal(facts.visible, true);

      const switched = await page.evaluate(`(async () => {
        const api = window.__nf;
        const modal = document.querySelector('#modal');
        const visible = document.querySelector('#visible');
        let active = modal;
        const stabilized = [];
        const binding = api.createNetflixVideoBinding({
          root: document.documentElement,
          current: () => active,
          pick: () => [...document.querySelectorAll('video')].sort((left, right) => (
            api.netflixPlaybackRank(api.readNetflixVideoFacts(right))
            - api.netflixPlaybackRank(api.readNetflixVideoFacts(left))
          ))[0],
          shouldSwitch: (current, next) => api.shouldFollowNetflixVideo(
            api.readNetflixVideoFacts(current),
            api.readNetflixVideoFacts(next)
          ),
          onSwitch: (next) => { active = next; },
          onStabilize: (video) => { stabilized.push(video.id); }
        });
        binding.bind(modal);
        document.querySelector('#modal-wrap').style.visibility = 'hidden';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        modal.dispatchEvent(new Event('loadedmetadata'));
        visible.dispatchEvent(new Event('loadedmetadata'));
        return { id: binding.listeningTo()?.id || '', stabilized };
      })()`) as { id: string; stabilized: string[] };
      assert.equal(switched.id, 'visible');
      assert.deepEqual(switched.stabilized, ['visible']);

      const restored = await page.evaluate(`(() => {
        const shell = document.querySelector('#shell');
        const before = {
          mask: shell.style.getPropertyValue('mask-image'),
          backgroundImage: shell.style.getPropertyValue('background-image'),
          backgroundColor: shell.style.getPropertyValue('background-color')
        };
        window.__nf.holdNetflixViewport(document.querySelector('#pinned'));
        window.__nf.releaseNetflixViewport();
        return {
          before,
          after: {
            mask: shell.style.getPropertyValue('mask-image'),
            backgroundImage: shell.style.getPropertyValue('background-image'),
            backgroundColor: shell.style.getPropertyValue('background-color')
          }
        };
      })()`) as {
        before: { mask: string; backgroundImage: string; backgroundColor: string };
        after: { mask: string; backgroundImage: string; backgroundColor: string };
      };
      assert.equal(restored.after.mask, restored.before.mask);
      assert.equal(restored.after.backgroundImage, restored.before.backgroundImage);
      assert.equal(restored.after.backgroundColor, restored.before.backgroundColor);
      assert.match(restored.after.mask, /gradient/i);
      assert.match(restored.after.backgroundImage, /gradient/i);

      const boot = async (html: string): Promise<number> => {
        const bootPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        bootPage.setDefaultTimeout(4000);
        await bootPage.route('https://www.netflix.com/**', (route) => route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html
        }));
        await bootPage.goto('https://www.netflix.com/pl/title/80057281', { waitUntil: 'domcontentloaded' });
        await bootPage.evaluate(`(() => {
          let count = 0;
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              const target = record.target instanceof Element ? record.target : record.target.parentElement;
              const nodes = [...record.addedNodes, ...record.removedNodes];
              if (target?.id === 'theater-everywhere-netflix-snapshot' || nodes.some((node) => node instanceof Element && node.id === 'theater-everywhere-netflix-snapshot')) {
                count += 1;
              }
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
          window.__snapMutations = () => count;
        })()`);
        await bootPage.addScriptTag({ content: bundle });
        const started = Date.now();
        await bootPage.evaluate('document.title');
        assert.ok(Date.now() - started < 2000);
        await bootPage.waitForTimeout(250);
        const mutations = await bootPage.evaluate('window.__snapMutations()') as number;
        await bootPage.close();
        return mutations;
      };

      const heroMutations = await boot('<!doctype html><title>Oglądaj: Stranger Things | Oficjalna witryna Netflix</title><body><video></video></body>');
      const modalMutations = await boot('<!doctype html><title>Oglądaj: Stranger Things | Oficjalna witryna Netflix</title><body><div class="nf-player-container"><video></video></div></body>');
      assert.ok(heroMutations < 8, `hero snapshot mutations ${heroMutations}`);
      assert.ok(modalMutations < 8, `modal snapshot mutations ${modalMutations}`);
    } finally {
      await browser.close();
    }
  });
});
