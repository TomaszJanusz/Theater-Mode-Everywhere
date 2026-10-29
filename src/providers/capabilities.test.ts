import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { buildSync, transformSync } from 'esbuild';
import { parseAst } from 'vite';

import { brightestStop, hexRgb, luminance, over } from '../../options/rte-colors';
import { NetflixAdapter } from '../media-features/netflix-adapter';
import { MEDIA_PROVIDER_IDS } from '../media-features/provider-flags';
import { VimeoAdapter } from '../media-features/vimeo-adapter';

import { MEDIA_CAPABILITIES, PROVIDER_CAPABILITIES } from './capabilities';
import { PROVIDER_CATALOG } from './catalog';
import { providerDefinition } from './registry';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
const folders: Record<string, string> = { bilibiliIntl: 'bilibili-intl' };
const localAdapters = new Set(['bilibili', 'bilibiliIntl', 'tencent', 'crunchyroll', 'iqiyi', 'soop']);

/** Static method/source checks deliberately complement the existing behavioral
 * adapter and service-action suites without reproducing their host fixtures.
 * Required interface stubs are checked behaviorally below, never counted as support. */
type AstNode = { type: string; [key: string]: unknown };

/** esbuild strips the types, then rollup's parser (via Vite) yields an ESTree. */
function parse(source: string): AstNode {
  return parseAst(transformSync(source, { loader: 'ts' }).code) as unknown as AstNode;
}

function walk(node: AstNode, visit: (node: AstNode) => void) {
  visit(node);
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof (child as AstNode).type === 'string') walk(child as AstNode, visit);
    }
  }
}

function methods(source: string) {
  const names = new Set<string>();
  walk(parse(source), node => {
    const key = node.key as AstNode | undefined;
    if (node.type === 'MethodDefinition' && key?.type === 'Identifier') names.add(key.name as string);
  });
  return names;
}

function registeredFrom(source: string, module: string): boolean {
  const imports = new Set<string>();
  const calls = new Set<string>();
  walk(parse(source), node => {
    if (node.type === 'ImportDeclaration' && (node.source as AstNode).value === module) {
      for (const specifier of node.specifiers as AstNode[]) {
        if (specifier.type === 'ImportSpecifier') imports.add((specifier.local as AstNode).name as string);
      }
    }
    const callee = node.callee as AstNode | undefined;
    if (node.type === 'CallExpression' && callee?.type === 'Identifier') calls.add(callee.name as string);
  });
  return [...imports].some(name => calls.has(name));
}

describe('provider capability declarations', () => {
  it('declares every provider once, with all capabilities and no orphan declarations', () => {
    assert.deepEqual(PROVIDER_CAPABILITIES.map(p => p.id).sort(), [...MEDIA_PROVIDER_IDS].sort());
    const declarations = readdirSync(__dirname, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .flatMap(entry => readdirSync(resolve(__dirname, entry.name)).includes('capabilities.ts') ? [entry.name] : []);
    assert.deepEqual(declarations.sort(), MEDIA_PROVIDER_IDS.map(id => folders[id] ?? id).sort());
    for (const provider of PROVIDER_CAPABILITIES) {
      assert.deepEqual(Object.keys(provider.capabilities).sort(), [...MEDIA_CAPABILITIES].sort());
      for (const support of Object.values(provider.capabilities)) {
        assert.ok(['yes', 'conditional', 'no'].includes(support.status));
        if (support.status === 'conditional') assert.ok(support.noteKey);
      }
    }
  });

  it('keeps the aggregate import graph limited to pure declarations', () => {
    const bundle = buildSync({ entryPoints: [resolve(__dirname, 'capabilities.ts')], bundle: true, write: false, metafile: true });
    for (const input of Object.keys(bundle.metafile!.inputs)) assert.ok(input.endsWith('/capabilities.ts') || input.endsWith('/capability-types.ts'), input);
  });

  for (const provider of PROVIDER_CAPABILITIES) {
    it(`${provider.id}: adapter methods and registered actions match the declaration`, () => {
      const extracted = PROVIDER_CATALOG.some(item => item.id === provider.id);
      const entry = extracted ? read(`./${provider.id}/isolated.ts`) : '';
      assert.equal(extracted ? /launcherPlacement:/.test(entry) : Boolean(providerDefinition(provider.id).launcherPlacement), provider.capabilities.launcher.status !== 'no', `${provider.id}.launcher`);
      assert.equal(extracted ? /watchPlayback:/.test(entry) : Boolean(providerDefinition(provider.id).watchPlayback), provider.capabilities.autoTheater.status !== 'no', `${provider.id}.autoTheater`);
      const folder = folders[provider.id] ?? provider.id;
      const source = read(localAdapters.has(provider.id) ? `./${folder}/adapter.ts` : `../media-features/${provider.id}-adapter.ts`);
      const implemented = methods(source);
      const adapterMethods = {
        title: ['getTitle'], subtitles: ['listCaptionTracks', 'activateCaptionTrack'], audio: ['listAudioTracks', 'selectAudioTrack'],
        chapters: ['getChapters'], heatmap: ['getHeatmap'], thumbnails: ['getPreviewSource', 'getPreviewFrame']
      } as const;
      for (const [key, names] of Object.entries(adapterMethods)) {
        const capability = key as keyof typeof adapterMethods;
        // These interface compatibility methods intentionally have no feature data.
        const stub = (['vimeo', 'soop'].includes(provider.id) && key === 'subtitles') || (provider.id === 'netflix' && key === 'chapters');
        // A provider that leaves its title to the page's metadata implements no title method.
        const pageTitle = providerDefinition(provider.id).titleFromPage === true && key === 'title';
        const actual = (names.every(name => implemented.has(name)) && !stub) || pageTitle;
        assert.equal(actual, provider.capabilities[capability].status !== 'no', `${provider.id}.${key}`);
        if (stub) assert.equal(provider.capabilities[capability].status, 'no');
      }
      const actions = read('./service-actions.ts');
      const navigation = read('./navigation/factory.ts');
      // Follow imports that are actually called, so adding a registered source
      // to a previously unsupported provider also trips the declaration guard.
      const navFile = provider.id === 'vimeo' ? 'vimeo-showcase' : folder;
      // A provider migrating hook by hook may still register a feature through the shared factory.
      const entryNavigation = extracted && /readControls:/.test(entry);
      const hasActions = (extracted && registeredFrom(entry, './service-actions')) || registeredFrom(actions, `./${folder}/service-actions`);
      const hasNavigation = entryNavigation || registeredFrom(navigation, `./${navFile}`);
      // Playlists use the registered PlaylistAction contract, not caption HLS
      // playlists or contextual skip/up-next actions (such as Crunchyroll's).
      assert.equal(hasNavigation, provider.capabilities.playlists.status !== 'no', `${provider.id}.playlists`);
      if (hasNavigation) assert.equal(provider.capabilities.playlists.status, 'conditional');
      assert.equal(hasActions || hasNavigation, provider.capabilities.quickActions.status !== 'no');
      if (hasActions) assert.match(read(`./${folder}/service-actions.ts`), /activate|nativeServiceActionSource/);
      if (hasNavigation) assert.match(read(entryNavigation ? `./${folder}/navigation.ts` : `./navigation/${navFile}.ts`), /next|collectElement/i);
    });
  }

  it('does not advertise empty Vimeo caption and Netflix chapter interface stubs', async () => {
    const vimeo = new VimeoAdapter();
    assert.deepEqual(await vimeo.listCaptionTracks(), []);
    assert.equal((await vimeo.activateCaptionTrack('anything')).status, 'failed');
    assert.deepEqual(await NetflixAdapter.prototype.getChapters(), []);
  });

  it('declares the specified brand palettes in order', () => {
    const palettes: Record<string, string[]> = {
      bilibili: ['#06AEEC', '#FFFFFF'],
      bilibiliIntl: ['#06AEEC', '#FFFFFF'],
      crunchyroll: ['#FF640C', '#272727'],
      iqiyi: ['#00CC36', '#000000'],
      soop: ['#0099FF', '#00D0FF', '#000000'],
      disney: ['#091C2A', '#2EB3BF', '#186A7C'],
      netflix: ['#E50914', '#B20710', '#141414', '#1F1F1F'],
      patreon: ['#F06352', '#F7F7F7', '#012B47'],
      tencent: ['#FF8800', '#0098FF', '#43E702', '#FFFFFF'],
      twitch: ['#A441F7', '#000000', '#F7F7F7'],
      youtube: ['#F70000', '#EAEAEA'],
      vimeo: ['#15D5FF', '#141A20'],
      viki: ['#0C9BFF', '#1A1A1A'],
    };
    assert.deepEqual(Object.fromEntries(PROVIDER_CAPABILITIES.map(provider => [provider.id, [...provider.brandColors]])), palettes);
  });

  it('keeps orbit highlights saturated instead of ramping to white', () => {
    for (const provider of PROVIDER_CAPABILITIES) {
      const rgb = brightestStop(provider.brandColors);
      assert.ok(Math.max(...rgb) - Math.min(...rgb) >= 100, `${provider.id}: saturated brightest stop`);
    }
  });

  it('keeps tile text above 4.5:1 on the resting row and under the veil on every brand', () => {
    const contrast = (a: readonly number[], b: readonly number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const pageBlack = hexRgb('#09090b');
    const css = read('../../options/options.css');
    const veil = Number(/--te-veil:\s*(\d+)%/.exec(css)![1]) / 100;
    const offOpacity = Number(/input:not\(:checked\)\):is\(:hover[^}]*opacity:\s*([\d.]+)/.exec(css)![1]);
    // Title and note on; the dimmer title and secondary text off. Badges sit on dark glass.
    const text = { on: ['#f4f4f5', '#b2b2b9'], off: ['#d4d4d8', '#b2b2b9'] };
    const badge = { on: '#e4e4e7', off: '#a1a1aa' };
    for (const state of ['on', 'off'] as const) {
      const check = (surface: readonly number[], label: string) => {
        for (const color of text[state]) assert.ok(contrast(hexRgb(color), surface) >= 4.5, `${label} ${state}: ${color}`);
        assert.ok(contrast(hexRgb(badge[state]), over(pageBlack, 0.7, surface)) >= 4.5, `${label} ${state}: badge`);
      };
      check(pageBlack, 'rest');
      // The brightest orbit stop under the veil is the worst the hovered interior shows; an off tile shows it at partial opacity.
      for (const provider of PROVIDER_CAPABILITIES) {
        const veiled = over(pageBlack, veil, brightestStop(provider.brandColors));
        check(state === 'on' ? veiled : over(veiled, offOpacity, pageBlack), provider.id);
      }
    }
  });
});
