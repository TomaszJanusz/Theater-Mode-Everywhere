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

  it('keeps UI tracks and the specified tinted borders above 3:1 on the dark gradient', () => {
    const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    const mix = (a: number[], b: number[], fraction: number) => a.map((value, i) => fraction * value + (1 - fraction) * b[i]);
    const luminance = (color: number[]) => color.reduce((sum, channel, i) => {
      const c = channel / 255;
      return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    }, 0);
    const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    for (const provider of PROVIDER_CAPABILITIES) {
      const { brand } = provider;
      const colors = [brand.primary, ...(brand.secondary ? [brand.secondary] : []), ...(brand.extra ?? [])];
      assert.equal(brand.uiBorder.length, colors.length);
      for (const hex of [...colors, ...brand.uiBorder, brand.uiAccent, ...(brand.tile ?? []), ...(brand.stripes ?? [])]) assert.match(hex, /^#[0-9A-F]{6}$/);
      const backgrounds = brand.tile?.map(rgb) ?? colors.map(color => mix(rgb(color), rgb('#202023'), color === '#FFFFFF' || color === '#FAFCFD' ? 0.08 : 0.14));
      backgrounds.push(rgb('#202023'));
      assert.ok(contrast(rgb(brand.uiAccent), rgb('#141414')) >= 3, `${provider.id}: track against its dark outline`);
      for (const background of backgrounds) {
        assert.ok(contrast(rgb('#d4d4d8'), background) >= 4.5, `${provider.id}: text`);
        // Moving gradients can put any tint beside any border stop.
        for (let i = 0; i < brand.uiBorder.length; i++) for (let step = 0; step <= 10; step++) {
          const color = mix(rgb(brand.uiBorder[i]), rgb(brand.uiBorder[Math.min(i + 1, brand.uiBorder.length - 1)]), step / 10);
          assert.ok(contrast(mix(color, rgb('#27272a'), 0.55), background) >= 3, `${provider.id}: border`);
        }
        // A conservative stripe bound: even its brightest fully unmasked part.
        for (const stripe of brand.stripes ?? []) assert.ok(contrast(rgb('#d4d4d8'), mix(rgb(stripe), background, 0.22)) >= 4.5, `${provider.id}: text over stripes`);
      }
      assert.ok(contrast(rgb('#a1a1aa'), rgb('#202023')) >= 4.5, `${provider.id}: off text`);
      assert.ok(contrast(rgb('#71717a'), rgb('#202023')) >= 3, `${provider.id}: off border`);
    }
  });
});
