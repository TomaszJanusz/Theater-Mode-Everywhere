import { DisposableScope } from '../src/core/disposable-scope';
import {
  withFeatureHighlightsLocal, FEATURE_HIGHLIGHTS_LOCAL_KEYS, HIGHLIGHT_NEW_FEATURES_STORAGE_KEY, isNewFeature,
  resolveFeatureHighlights, resolveHighlightNewFeatures,
  NEW_FEATURE_ITEMS
} from '../src/feature-highlights';
import { installedVersion, readFeatureHighlightsLocal } from '../src/feature-highlights-storage';
import { languageRuntime } from '../src/i18n-runtime';
import { t } from '../src/i18n';
import { createNewBadge, defineNewBadge, ensureNewBadgeStyles } from '../src/ui/new-badge';

/** Page-owned storage subscription, installed before either asynchronous snapshot. */
export function setupFeatureHighlights(initialSync: Promise<Record<string, unknown>>, version = installedVersion()) {
  const scope = new DisposableScope();
  let state = resolveFeatureHighlights(version);
  let syncRevision = 0;
  const localOverrides: Record<string, unknown> = {};
  defineNewBadge();
  ensureNewBadgeStyles(document);
  const toggle = document.querySelector<HTMLInputElement>('#highlight-new-features-toggle');

  function setPill(label: Element | null, visible: boolean) {
    const old = label?.querySelector('.te-new-badge');
    if (visible && old) { old.textContent = t('badgeNew'); return; }
    if (old?.previousSibling?.nodeType === Node.TEXT_NODE && old.previousSibling.textContent === ' ') {
      old.previousSibling.remove();
    }
    old?.remove();
    if (visible) label?.append(' ', createNewBadge());
  }

  function render() {
    const newBlocks: Element[] = [];
    // Player items have no home on this page; their query simply finds nothing.
    for (const { id } of NEW_FEATURE_ITEMS) {
      const block = document.querySelector(`[data-new-feature="${id}"]`);
      if (!block) continue;
      const label = block.querySelector('.appearance-block-label, .feature-label, .rte-name') ?? block;
      const visible = isNewFeature(id, state);
      setPill(label, visible);
      if (visible) newBlocks.push(block);
    }
    for (const tab of document.querySelectorAll('[data-new-feature-tab]')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      setPill(tab, newBlocks.some(block => panel?.contains(block)));
    }
    if (toggle) toggle.checked = state.enabled;
    const button = document.getElementById('whats-new-btn');
    const unseen = NEW_FEATURE_ITEMS.some(item => isNewFeature(item.id, state));
    button?.classList.toggle('has-unseen', unseen);
    button?.toggleAttribute('data-unseen', unseen);
    if (unseen) button?.setAttribute('aria-description', t('badgeNew'));
    else button?.removeAttribute('aria-description');
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && changes[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]) {
        syncRevision++;
        state = { ...state, enabled: resolveHighlightNewFeatures(changes[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY].newValue) };
      } else if (area === 'local' && FEATURE_HIGHLIGHTS_LOCAL_KEYS.some(key => changes[key])) {
        for (const key of FEATURE_HIGHLIGHTS_LOCAL_KEYS) {
          if (changes[key]) localOverrides[key] = changes[key].newValue;
        }
        state = withFeatureHighlightsLocal(state, localOverrides);
      } else return;
      render();
    };
    chrome.storage.onChanged.addListener(onChanged);
    scope.add(() => chrome.storage.onChanged.removeListener(onChanged));
  }
  // Let options' document localization run first, since it replaces label children.
  const renderAfterLocalization = () => queueMicrotask(() => { if (!scope.isDisposed) render(); });
  scope.add(languageRuntime.subscribe(renderAfterLocalization));
  let pendingWrite = Promise.resolve();
  if (toggle) scope.listen(toggle, 'change', () => {
    const enabled = toggle.checked;
    pendingWrite = pendingWrite.then(async () => {
      try {
        await chrome.storage.sync.set({ [HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]: enabled });
      } catch (error) {
        render();
        console.error('Error saving feature highlights:', error);
      }
    });
  });
  const ready = Promise.all([
    initialSync,
    readFeatureHighlightsLocal()
  ]).then(([sync, local]) => {
    if (scope.isDisposed) return;
    const snapshot = resolveFeatureHighlights(version, sync, { ...local, ...localOverrides });
    state = { ...state,
      enabled: syncRevision ? state.enabled : snapshot.enabled,
      seenThrough: snapshot.seenThrough, development: snapshot.development };
    render();
  }).catch(error => { if (!scope.isDisposed) render(); console.error('Error loading feature highlights:', error); });
  scope.listen(window, 'unload', () => scope.dispose(), { once: true });
  return { ready, render, dispose: () => scope.dispose() };
}
