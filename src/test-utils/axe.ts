import axe, { type AxeResults, type Result } from 'axe-core';

// Accessibility scan for component tests. axe-core runs in the page, so it composes with Vitest browser
// mode directly and sees into the player UI's open shadow root; no Playwright page is needed.

export interface AppearanceMode {
  name: string;
  /** Applies the mode the way a user does: the preference in storage, or the page language and direction. */
  apply(host: HTMLElement): void;
  /** Whether the host now shows the mode, so a mode that silently did nothing fails the scan. */
  applied(host: HTMLElement): boolean;
}

const preference = (name: string, key: string, dataset: 'contrast' | 'transparency' | 'motion', value: string): AppearanceMode => ({
  name, apply: () => { void chrome.storage.sync.set({ [key]: 'on' }); }, applied: host => host.dataset[dataset] === value
});

export const APPEARANCE_MODES: AppearanceMode[] = [
  { name: 'default', apply: () => {}, applied: host => host.dataset.contrast === 'normal' && host.dataset.motion === 'normal' },
  preference('High contrast', 'highContrast', 'contrast', 'high'),
  preference('Reduce transparency', 'reduceTransparency', 'transparency', 'reduced'),
  { name: 'RTL (ar)', apply: host => { host.dir = 'rtl'; host.lang = 'ar'; }, applied: host => host.dir === 'rtl' },
  preference('Reduce motion', 'reduceMotion', 'motion', 'reduced')
];

/**
 * Known false positives only. Each entry names the rule and a selector it may report, with the reason it is
 * not a defect. Never disable a rule wholesale: a rule stays on everywhere an entry does not match.
 */
interface AxeAllowance { rule: string; selector: string; reason: string }
export const AXE_ALLOW_LIST: readonly AxeAllowance[] = [];

const BLOCKING = new Set<Result['impact']>(['serious', 'critical']);

function allowed(rule: string, target: string): boolean {
  return AXE_ALLOW_LIST.some(entry => entry.rule === rule && target.includes(entry.selector));
}

/** Serious and critical violations inside `scope`, as readable lines. Empty when the scope is accessible. */
export async function blockingViolations(scope: Element): Promise<string[]> {
  const results: AxeResults = await axe.run(scope, { resultTypes: ['violations'] });
  return results.violations.filter(violation => BLOCKING.has(violation.impact))
    .flatMap(violation => violation.nodes
      .filter(node => !allowed(violation.id, node.target.join(' ')))
      .map(node => `${violation.id} (${violation.impact}): ${node.target.join(' ')} — ${node.failureSummary?.replace(/\s+/g, ' ')}`));
}
