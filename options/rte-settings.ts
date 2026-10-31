import { t } from '../src/i18n';
import { languageRuntime } from '../src/i18n-runtime';
import {
  MEDIA_PROVIDER_FLAG_KEYS, mediaProviderFlagLegacyDefaults, mediaProviderFlagStorageKeys, mediaProviderFlagStorageUpdate,
  resolveMediaProviderFlags, type MediaProviderId
} from '../src/media-features/provider-flags';
import { MEDIA_CAPABILITIES, PROVIDER_CAPABILITIES, type MediaCapability } from '../src/providers/capabilities';
import { PROVIDER_SETTINGS } from '../src/providers/catalog';
import { createProviderSettings } from '../src/providers/settings';

import { openProviderSettings } from './provider-settings';
import { settingsMessage } from './provider-settings-copy';
import { serviceColorProperties } from './rte-colors';

export async function setupRteSettings(notify: () => Promise<void>): Promise<() => void> {
  const tiles = document.getElementById('rte-tiles')!;
  const filters = document.getElementById('rte-filter-buttons')!;
  const master = document.getElementById('rte-all') as HTMLInputElement;
  const clear = document.getElementById('rte-clear') as HTMLButtonElement;
  const error = document.getElementById('rte-error')!;
  const selected = new Set<MediaCapability>();
  const keys = mediaProviderFlagStorageKeys();
  let stored: Record<string, unknown> = {};
  let flags = resolveMediaProviderFlags(stored);
  let revision = 0;
  let disposed = false;
  let ready = false;
  const events = new AbortController();
  const providerSettings = createProviderSettings(PROVIDER_SETTINGS);
  void providerSettings.ready.catch(() => { error.textContent = t('rteSaveError'); error.hidden = false; });
  const inputs = new Map<MediaProviderId, HTMLInputElement>();
  const badges = new Map<MediaProviderId, Map<MediaCapability, HTMLElement>>();
  const tileElements = new Map<MediaProviderId, HTMLDivElement>();
  const filterButtons = new Map<MediaCapability, HTMLButtonElement>();

  function visibleProviders() {
    return PROVIDER_CAPABILITIES.filter(provider => [...selected].every(key => provider.capabilities[key].status !== 'no'));
  }

  // Keep the actual controls while sorting/localizing, preserving keyboard focus.
  for (const provider of PROVIDER_CAPABILITIES) {
    const tile = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'rte-control';
    tile.className = 'rte-tile te-animated-border';
    tile.dataset.provider = provider.id;
    tile.dataset.newFeature = `rte${provider.id[0].toUpperCase()}${provider.id.slice(1)}`;
    for (const [key, value] of Object.entries(serviceColorProperties(provider))) tile.style.setProperty(key, value);
    // The NEW badge joins the title row but stays out of the switch's accessible name.
    const title = document.createElement('span');
    title.className = 'rte-name';
    const name = document.createElement('bdi');
    name.id = `rte-name-${provider.id}`;
    name.textContent = provider.name;
    title.append(name);
    const control = document.createElement('span');
    control.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.role = 'switch';
    input.disabled = true;
    input.id = `rte-${provider.id}`;
    input.setAttribute('aria-labelledby', name.id);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    slider.setAttribute('aria-hidden', 'true');
    control.append(input, slider);
    const badgeList = document.createElement('span');
    badgeList.className = 'rte-badges';
    badgeList.id = `rte-badges-${provider.id}`;
    const providerBadges = new Map<MediaCapability, HTMLElement>();
    for (const key of MEDIA_CAPABILITIES) {
      if (provider.capabilities[key].status === 'no') continue;
      const badge = document.createElement('span');
      badge.className = 'rte-badge';
      badge.dataset.capability = key;
      badgeList.append(badge);
      providerBadges.set(key, badge);
    }
    const note = document.createElement('span');
    note.className = 'rte-note';
    note.id = `rte-note-${provider.id}`;
    if (provider.noteKey) note.dataset.i18n = provider.noteKey;
    input.setAttribute('aria-describedby', `${badgeList.id}${provider.noteKey ? ` ${note.id}` : ''}`);
    label.append(title, control, badgeList);
    if (provider.noteKey) label.append(note);
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'rte-details-toggle';
    details.setAttribute('aria-expanded', 'false');
    details.setAttribute('aria-controls', `rte-details-${provider.id}`);
    details.setAttribute('aria-describedby', name.id);
    const description = document.createElement('div');
    const detailsTitle = document.createElement('h3');
    const detailsText = document.createElement('p');
    const content = document.createElement('div');
    content.append(detailsTitle, detailsText);
    description.append(content);
    const region = document.createElement('div');
    region.className = 'rte-details-region';
    region.append(description);
    description.className = 'rte-details';
    description.id = `rte-details-${provider.id}`;
    description.inert = true;
    description.setAttribute('aria-hidden', 'true');
    details.addEventListener('click', () => {
      const expanded = details.getAttribute('aria-expanded') !== 'true';
      details.setAttribute('aria-expanded', String(expanded));
      description.inert = !expanded;
      description.setAttribute('aria-hidden', String(!expanded));
      region.classList.toggle('is-expanded', expanded);
    }, { signal: events.signal });
    const settings = PROVIDER_SETTINGS.find(item => item.id === provider.id);
    if (settings) {
      const actions = document.createElement('div');
      actions.className = 'rte-card-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rte-settings-button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-describedby', name.id);
      button.addEventListener('click', () => {
        openProviderSettings({ ...settings, name: provider.name }, providerSettings, { signal: events.signal, returnFocus: () => button });
      }, { signal: events.signal });
      actions.append(button, details);
      tile.append(label, actions, region);
    } else tile.append(label, details, region);
    tiles.append(tile);
    inputs.set(provider.id, input);
    badges.set(provider.id, providerBadges);
    tileElements.set(provider.id, tile);
    input.addEventListener('change', () => { void save([provider.id], input.checked); }, { signal: events.signal });
  }

  for (const key of MEDIA_CAPABILITIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.capability = key;
    button.addEventListener('click', () => {
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      render();
    }, { signal: events.signal });
    filters.append(button);
    filterButtons.set(key, button);
  }

  function render() {
    const visible = visibleProviders();
    const on = visible.filter(provider => flags[provider.id]).length;
    master.checked = visible.length > 0 && on === visible.length;
    master.indeterminate = on > 0 && on < visible.length;
    master.disabled = !ready || visible.length === 0;
    document.getElementById('rte-all-label')!.textContent = t(selected.size ? 'rteAllShown' : 'rteAll');
    document.getElementById('rte-shown')!.textContent = t('rteShown', [String(visible.length), String(PROVIDER_CAPABILITIES.length)]);
    document.getElementById('rte-empty')!.hidden = visible.length !== 0;
    clear.hidden = selected.size === 0;
    const locale = languageRuntime.language === 'automatic' ? t('@@ui_locale') : languageRuntime.language;
    const collator = new Intl.Collator(locale.startsWith('@@') ? undefined : locale.replace('_', '-'));
    const focused = document.activeElement;
    for (const [index, provider] of [...PROVIDER_CAPABILITIES].sort((a, b) => collator.compare(a.name, b.name)).entries()) {
      const tile = tileElements.get(provider.id)!;
      tile.hidden = !visible.includes(provider);
      inputs.get(provider.id)!.checked = flags[provider.id];
      inputs.get(provider.id)!.disabled = !ready;
      for (const [key, badge] of badges.get(provider.id)!) {
        badge.textContent = t(`rteCapability${key[0].toUpperCase()}${key.slice(1)}`);
        badge.classList.toggle('is-matching', selected.has(key));
        const support = provider.capabilities[key];
        badge.title = support.status === 'conditional' ? t(support.noteKey) : '';
      }
      const settingsButton = tile.querySelector<HTMLButtonElement>('.rte-settings-button');
      if (settingsButton) settingsButton.textContent = settingsMessage('providerSettingsButton');
      tile.querySelector<HTMLButtonElement>('.rte-details-toggle')!.textContent = t('rteDetails');
      tile.querySelector<HTMLElement>('.rte-details h3')!.textContent = t(`${provider.id}IntegrationTitle`);
      tile.querySelector<HTMLElement>('.rte-details p')!.textContent = t(`${provider.id}IntegrationDescription`);
      if (provider.noteKey) {
        const note = tile.querySelector<HTMLElement>('.rte-note')!;
        note.textContent = t(provider.noteKey);
        note.title = t(provider.noteKey);
      }
      if (tiles.children[index] !== tile) tiles.insertBefore(tile, tiles.children[index] ?? null);
    }
    if (focused instanceof HTMLElement && tiles.contains(focused) && !focused.closest('[hidden]')) focused.focus({ preventScroll: true });
    for (const [key, button] of filterButtons) {
      const count = PROVIDER_CAPABILITIES.filter(provider => provider.capabilities[key].status !== 'no').length;
      button.textContent = `${t(`rteCapability${key[0].toUpperCase()}${key.slice(1)}`)} · ${count}`;
      button.setAttribute('aria-pressed', String(selected.has(key)));
    }
    if (!error.hidden) error.textContent = t('rteSaveError');
    clear.textContent = t('rteClear');
  }

  async function save(ids: MediaProviderId[], enabled: boolean) {
    const next = { ...flags };
    for (const id of ids) next[id] = enabled;
    // The existing helper owns storage key mapping; write only the affected flags.
    const update = mediaProviderFlagStorageUpdate(next);
    const affected = Object.fromEntries(ids.map(id => [MEDIA_PROVIDER_FLAG_KEYS[id], update[MEDIA_PROVIDER_FLAG_KEYS[id]]]));
    flags = next;
    render();
    try {
      await chrome.storage.sync.set(affected);
      if (disposed) return;
      error.hidden = true;
      await notify();
    } catch (reason) {
      if (disposed) return;
      flags = resolveMediaProviderFlags(stored);
      render();
      error.textContent = t('rteSaveError');
      error.hidden = false;
      console.error('Error saving service integrations:', reason);
    }
  }

  const onMaster = () => { void save(visibleProviders().map(provider => provider.id), master.checked); };
  const onClear = () => { selected.clear(); filterButtons.values().next().value?.focus(); render(); };
  master.addEventListener('change', onMaster);
  clear.addEventListener('click', onClear);
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || !keys.some(key => key in changes)) return;
    revision++;
    for (const key of keys) if (key in changes) {
      stored[key] = changes[key].newValue;
    }
    flags = resolveMediaProviderFlags(stored);
    render();
  };
  chrome.storage.onChanged.addListener(onStorage);
  const stopLanguage = languageRuntime.subscribe(render);
  master.disabled = true;
  const initialRevision = revision;
  try {
    const initial = await chrome.storage.sync.get(keys);
    if (revision === initialRevision) stored = initial;
    else {
      // Preserve events that arrived while the initial snapshot was in flight.
      stored = { ...initial, ...stored };
    }
    flags = resolveMediaProviderFlags(stored);
    // Older RTE-off installs may store only the original five flags. Persist
    // inferred off defaults once: enabling an original service must not make
    // missing newer flags silently fall back to on. Ordinary controls can then
    // keep writing exactly their own keys, including under a capability filter.
    const legacyDefaults = mediaProviderFlagLegacyDefaults(stored);
    if (Object.keys(legacyDefaults).length > 0) {
      const migrationRevision = revision;
      await chrome.storage.sync.set(legacyDefaults);
      // Storage events may already contain a newer choice from another page.
      if (revision === migrationRevision) Object.assign(stored, legacyDefaults);
    }
    ready = true;
  } catch (reason) {
    console.error('Error loading service integrations:', reason);
    // A failed migration cannot safely expose controls that could re-enable
    // other integrations. A reload retries using the authoritative storage.
    error.textContent = t('rteSaveError');
    error.hidden = false;
  }
  render();
  return () => {
    disposed = true;
    events.abort();
    providerSettings.dispose();
    chrome.storage.onChanged.removeListener(onStorage);
    stopLanguage();
    master.removeEventListener('change', onMaster);
    clear.removeEventListener('click', onClear);
  };
}
