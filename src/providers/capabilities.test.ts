import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { buildSync } from 'esbuild';
import { MEDIA_PROVIDER_IDS } from '../media-features/provider-flags';
import { MEDIA_CAPABILITIES, PROVIDER_CAPABILITIES } from './capabilities';
import { VimeoAdapter } from '../media-features/vimeo-adapter';
import { NetflixAdapter } from '../media-features/netflix-adapter';
import { TILE_LEVELS, brandRoles, hexRgb, luminance, over, tileGlows } from '../../options/rte-colors';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
const folders: Record<string, string> = { bilibiliIntl: 'bilibili-intl' };
const localAdapters = new Set(['bilibili', 'bilibiliIntl', 'tencent', 'crunchyroll']);

/** Static method/source checks deliberately complement the existing behavioral
 * adapter and service-action suites without reproducing their host fixtures.
 * Required interface stubs are checked behaviorally below, never counted as support. */
function methods(source: string) {
  const file = ts.createSourceFile('adapter.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.body) names.add(node.name.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return names;
}

function registeredFrom(source: string, module: string): boolean {
  const file = ts.createSourceFile('factory.ts', source, ts.ScriptTarget.Latest, true);
  const imports = new Set<string>();
  const calls = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === module) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const entry of bindings.elements) imports.add(entry.name.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...imports].some(name => calls.has(name));
}

describe('provider capability declarations', () => {
  it('declares every provider once, with all six capabilities and no orphan declarations', () => {
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
      const folder = folders[provider.id] ?? provider.id;
      const source = read(localAdapters.has(provider.id) ? `./${folder}/adapter.ts` : `../media-features/${provider.id}-adapter.ts`);
      const implemented = methods(source);
      const adapterMethods = {
        title: ['getTitle'], subtitles: ['listCaptionTracks', 'activateCaptionTrack'],
        chapters: ['getChapters'], heatmap: ['getHeatmap'], thumbnails: ['getPreviewSource', 'getPreviewFrame']
      } as const;
      for (const [key, names] of Object.entries(adapterMethods)) {
        const capability = key as keyof typeof adapterMethods;
        // These interface compatibility methods intentionally have no feature data.
        const stub = (provider.id === 'vimeo' && key === 'subtitles') || (provider.id === 'netflix' && key === 'chapters');
        const actual = names.every(name => implemented.has(name)) && !stub;
        assert.equal(actual, provider.capabilities[capability].status !== 'no', `${provider.id}.${key}`);
        if (stub) assert.equal(provider.capabilities[capability].status, 'no');
      }
      const actions = read('./service-actions.ts');
      const navigation = read('./navigation/factory.ts');
      // Follow imports that are actually called, so adding a registered source
      // to a previously unsupported provider also trips the declaration guard.
      const navFile = provider.id === 'vimeo' ? 'vimeo-showcase' : folder;
      const hasActions = registeredFrom(actions, `./${folder}/service-actions`);
      const hasNavigation = registeredFrom(navigation, `./${navFile}`);
      assert.equal(hasActions || hasNavigation, provider.capabilities.quickActions.status !== 'no');
      if (hasActions) assert.match(read(`./${folder}/service-actions.ts`), /activate|nativeServiceActionSource/);
      if (hasNavigation) assert.match(read(`./navigation/${navFile}.ts`), /next|collectElement/i);
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
      disney: ['#091C2A', '#2EB3BF', '#186A7C'],
      netflix: ['#E50914', '#B20710', '#141414', '#1F1F1F'],
      patreon: ['#F06352', '#F7F7F7', '#012B47'],
      tencent: ['#FF8800', '#0098FF', '#43E702', '#FFFFFF'],
      twitch: ['#A441F7', '#000000', '#F7F7F7'],
      youtube: ['#F70000', '#EAEAEA'],
      vimeo: ['#15D5FF', '#141A20'],
    };
    assert.deepEqual(Object.fromEntries(PROVIDER_CAPABILITIES.map(provider => [provider.id, [...provider.brandColors]])), palettes);
  });

  it('keeps tile text above 4.5:1 on every brand surface, on and off', () => {
    const contrast = (a: readonly number[], b: readonly number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const pageBlack = hexRgb('#09090b');
    // Title and note on; the dimmer title and secondary text off. Badges sit on dark glass.
    const text = { on: ['#f4f4f5', '#d4d4d8'], off: ['#d4d4d8', '#a1a1aa'] };
    for (const provider of PROVIDER_CAPABILITIES) {
      const { base, accents } = brandRoles(provider.brandColors);
      for (const state of ['on', 'off'] as const) {
        const { glows, rim } = tileGlows(accents, base, TILE_LEVELS[state].peak);
        const [first, second = first] = accents;
        // The brightest places: each corner's glow under the shared rim, and the bare base.
        const surfaces = [first, second].map((color, i) => over(hexRgb(first), rim, over(hexRgb(color), glows[i], hexRgb(base))));
        for (const surface of [...surfaces, hexRgb(base)]) {
          for (const color of text[state]) assert.ok(contrast(hexRgb(color), surface) >= 4.5, `${provider.id} ${state}: ${color}`);
          const glass = over(pageBlack, 0.7, surface);
          assert.ok(contrast(hexRgb(state === 'on' ? '#e4e4e7' : '#a1a1aa'), glass) >= 4.5, `${provider.id} ${state}: badge`);
        }
      }
    }
  });
});
