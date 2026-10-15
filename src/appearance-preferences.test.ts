import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveHighContrast, resolveReduceTransparency, effectiveAppearanceMode } from './appearance-preferences';
import { ACCENT_COLOR_OPTIONS } from './accentTheme';
import { accentForeground, contrastRatio, contrastSafeAccent } from './contrast';

const css = readFileSync(new URL('./appearance-tokens.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const value = css.match(new RegExp(`--appearance-${name}: (#[0-9a-f]{6});`))?.[1];
  assert.ok(value, `Missing actual CSS token ${name}`);
  return value;
};

describe('appearance choices', () => {
  for (const resolve of [resolveHighContrast, resolveReduceTransparency]) {
    it(`${resolve.name} validates stored values and defaults to Auto`, () => {
      for (const value of [undefined, null, true, false, 1, 'yes', {}, 'ON']) assert.equal(resolve(value), 'auto');
      for (const value of ['auto', 'on', 'off'] as const) assert.equal(resolve(value), value);
    });
  }
  it('resolves system choices, overrides and unsupported queries', () => {
    for (const system of [true, false]) {
      assert.equal(effectiveAppearanceMode('auto', system), system);
      assert.equal(effectiveAppearanceMode('on', system), true);
      assert.equal(effectiveAppearanceMode('off', system), false);
    }
    assert.equal(effectiveAppearanceMode('auto'), false);
  });
});

describe('actual appearance palette contrast (WCAG 2 luminance)', () => {
  it('matches reference black/white and equal-color ratios', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#18181b', '#18181b'), 1);
  });
  for (const mode of ['normal', 'high']) {
    it(`${mode}: text, accent fills and component indicators`, () => {
      for (const surface of ['background', 'panel']) {
        const background = token(`${mode}-${surface}`);
        assert.ok(contrastRatio(token(`${mode}-text`), background) >= 7);
        assert.ok(contrastRatio(token(`${mode}-secondary`), background) >= 4.5);
        if (mode === 'high') assert.ok(contrastRatio(token('high-border'), background) >= 3);
      }
      for (const option of ACCENT_COLOR_OPTIONS) {
        const base = option.preset === 'system' ? ACCENT_COLOR_OPTIONS.find(o => o.preset === 'purple')!.swatch : option.swatch;
        const accent = mode === 'high' ? contrastSafeAccent(base) : base;
        assert.ok(contrastRatio(accentForeground(accent), accent) >= 4.5, `${option.preset} filled text`);
        assert.ok(contrastRatio(accent, token(`${mode}-panel`)) >= (mode === 'high' ? 7 : 3), `${option.preset} indicator`);
      }
    });
  }
});

describe('appearance listener ownership', () => {
  it('rejects stale storage hydration, follows media changes and releases every listener', async () => {
    const { observeAppearance } = await import('./appearance-runtime');
    const { mock } = await import('node:test');
    const events = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    const media: Array<{ matches: boolean; listeners: Set<() => void> }> = [];
    let hydrate: (data: Record<string, unknown>) => void = () => {};
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const remove = mock.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => {
      const query = { matches: false, listeners: new Set<() => void>() };
      media.push(query);
      return { get matches() { return query.matches; },
        addEventListener: (_name: string, listener: () => void) => query.listeners.add(listener),
        removeEventListener: (_name: string, listener: () => void) => { remove(); query.listeners.delete(listener); } };
    } } });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
      runtime: {}, storage: { sync: { get: (_keys: string[], callback: typeof hydrate) => { hydrate = callback; } },
        onChanged: { addListener: (fn: Parameters<typeof events.add>[0]) => events.add(fn), removeListener: (fn: Parameters<typeof events.add>[0]) => events.delete(fn) } }
    } });
    try {
      const target = { dataset: {} } as HTMLElement;
      const dispose = observeAppearance(target);
      assert.equal(target.dataset.contrast, 'normal');
      for (const notify of events) notify({ highContrast: { newValue: 'on' } }, 'sync');
      hydrate({ highContrast: 'off', reduceTransparency: 'auto' });
      assert.equal(target.dataset.contrast, 'high', 'stale hydration cannot override an observed write');
      media[1].matches = true;
      for (const notify of media[1].listeners) notify();
      assert.equal(target.dataset.transparency, 'reduced');
      for (const notify of events) notify({ reduceTransparency: { newValue: 'off' } }, 'sync');
      assert.equal(target.dataset.transparency, 'normal');
      const lateNotifications = [...media[1].listeners];
      dispose(); dispose();
      hydrate({ highContrast: 'on' });
      for (const notify of lateNotifications) notify();
      assert.deepEqual(target.dataset, {});
      assert.equal(events.size, 0);
      assert.equal(media.reduce((n, query) => n + query.listeners.size, 0), 0);
      assert.equal(remove.mock.callCount(), 2);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
      if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome); else Reflect.deleteProperty(globalThis, 'chrome');
    }
  });
});
