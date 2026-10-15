import { LANGUAGES, LANGUAGE_STORAGE_KEY, resolveLanguage } from '../src/language';
import { languageRuntime, observeLanguageStorage } from '../src/i18n-runtime';
import { AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater } from '../src/ui/auto-theater';
import { VOLUME_BOOST_STORAGE_KEY, resolveVolumeBoostEnabled } from '../src/ui/volume-boost-settings';
/* Options script for Theater Everywhere */
import { createShortcutEditor } from './shortcut-editor';
import { setupSettingsTabs } from './tabs';
import licenseText from '../LICENSE?raw';
import { KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolveKeepControlsVisible } from '../src/ui/controls-visibility';
import { fetchAndApplyTheme } from '../src/themeHelper';
import {
  ACCENT_COLOR_OPTIONS,
  ACCENT_COLOR_STORAGE_KEY,
  DEFAULT_ACCENT_COLOR,
  applyAccentColorPreset,
  resolveAccentColorPreset,
  type AccentColorPreset
} from '../src/accentTheme';
import {
  DEFAULT_PICTURE_ALIGN,
  PICTURE_ALIGN_STORAGE_KEY,
  PICTURE_ALIGNS,
  RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY,
  resolvePictureAlign,
  resolveRaiseOnlyWithSubtitles,
  type PictureAlign
} from '../src/ui/appearance';
import {
  definePrivacyThingLogo,
  type PrivacyThingLogoElement
} from '@privacy-thing/brand';
import { localizeDocument, t } from '../src/i18n';
import { hasUnseenWhatsNew, openWhatsNewDialog, syncWhatsNewButtonState } from '../src/whatsNew';
import {
  mediaProviderFlagStorageKeys,
  mediaProviderFlagStorageUpdate,
  mediaProviderFlagsForRichTheaterExperience,
  resolveMediaProviderFlags,
  richTheaterExperienceEnabled
} from '../src/media-features/provider-flags';

definePrivacyThingLogo();

function configurePrivacyThingLogo(): void {
  const logo = document.querySelector<PrivacyThingLogoElement>('privacy-thing-logo');
  logo?.configure({
    animateIcon: true,
    animateCursor: true,
    trackPointer: true,
    hoverReaction: 'boop',
    tapReaction: 'jelly',
    timing: {
      pointer: {
        directionDelayMs: 60,
        idleHoldMs: 700,
        transitionMs: 140,
        inactivityTimeoutMs: 3500
      }
    }
  });
}

// Apply browser theme colors immediately
fetchAndApplyTheme();

function safeGetStorage(keys: string | string[]): Promise<any> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[Theater Everywhere] Storage request timed out, using fallback.');
      resolve({});
    }, 800);

    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(keys, (result) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.warn('[Theater Everywhere] chrome.runtime.lastError inside safeGetStorage:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(result || {});
          }
        });
      } else {
        clearTimeout(timeout);
        resolve({});
      }
    } catch (e) {
      clearTimeout(timeout);
      console.error('[Theater Everywhere] Exception in safeGetStorage:', e);
      resolve({});
    }
  });
}

const FEATURE_TOGGLES = [
  { id: 'auto-enter-theater-toggle', key: AUTO_THEATER_STORAGE_KEY, resolve: resolveAutoEnterTheater },
  { id: 'keep-controls-visible-toggle', key: KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolve: resolveKeepControlsVisible },
  { id: 'volume-boost-toggle', key: VOLUME_BOOST_STORAGE_KEY, resolve: resolveVolumeBoostEnabled }
] as const;

async function init() {
  const stopLanguageStorage = observeLanguageStorage();
  window.addEventListener('unload', stopLanguageStorage, { once: true });
  const languageRevision = languageRuntime.revision;
  const initialSettings = await safeGetStorage(['blacklist', LANGUAGE_STORAGE_KEY]);
  await languageRuntime.set(initialSettings[LANGUAGE_STORAGE_KEY], languageRevision);
  localizeDocument();
  setupSettingsTabs(document.getElementById('settings-tabs') as HTMLElement);
  document.getElementById('license-text')!.textContent = licenseText.trim();
  configurePrivacyThingLogo();
  let raiseOnlyWithSubtitles = false;

  const form = document.getElementById('add-domain-form') as HTMLFormElement;
  const input = document.getElementById('domain-input') as HTMLInputElement;
  const validationMsg = document.getElementById('validation-msg') as HTMLElement;
  const container = document.getElementById('blacklist-container') as HTMLElement;
  const countBadge = document.getElementById('blacklist-count') as HTMLElement;

  const shortcutEditor = createShortcutEditor(notifyAllTabs);
  const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
  for (const { locale, name } of LANGUAGES) {
    const option = new Option(name, locale);
    option.lang = locale.replace('_', '-');
    option.dir = locale === 'ar' ? 'rtl' : 'ltr';
    languageSelect.add(option);
  }
  languageSelect.value = languageRuntime.language;
  languageSelect.addEventListener('change', async () => {
    try {
      await chrome.storage.sync.set({ [LANGUAGE_STORAGE_KEY]: resolveLanguage(languageSelect.value) });
    } catch (error) {
      languageSelect.value = languageRuntime.language;
      console.error('Error saving language:', error);
    }
  });
  const stopLanguageRendering = languageRuntime.subscribe(() => {
    localizeDocument();
    languageSelect.value = languageRuntime.language;
    const focusedAccent = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.accentColor : undefined;
    const selectedAccent = document.querySelector<HTMLElement>('[data-accent-color][aria-checked="true"]');
    renderAccentColorOptions(resolveAccentColorPreset(selectedAccent?.dataset.accentColor));
    if (focusedAccent) document.querySelector<HTMLElement>(`[data-accent-color="${focusedAccent}"]`)?.focus();
    renderPictureAlignOptions(selectedPictureAlign());
    shortcutEditor.localize();
    validationMsg.textContent = '';
  });
  window.addEventListener('unload', stopLanguageRendering, { once: true });
  await loadAndRenderBlacklist(initialSettings);
  await shortcutEditor.initialize();

  // Load and bind features toggles
  await loadAndRenderFeatures();
  setupFeatureListeners();
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes.shortcuts) shortcutEditor.applyStored(changes.shortcuts.newValue);
      if (changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]) {
        raiseOnlyWithSubtitles = resolveRaiseOnlyWithSubtitles(changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY].newValue);
      }
      if (changes[PICTURE_ALIGN_STORAGE_KEY] || changes[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]) {
        const align = changes[PICTURE_ALIGN_STORAGE_KEY]
          ? resolvePictureAlign(changes[PICTURE_ALIGN_STORAGE_KEY].newValue)
          : selectedPictureAlign();
        renderPictureAlignOptions(align);
      }
      if (changes[VOLUME_BOOST_STORAGE_KEY]) {
        const toggle = document.getElementById('volume-boost-toggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = resolveVolumeBoostEnabled(changes[VOLUME_BOOST_STORAGE_KEY].newValue);
      }
      if (changes[AUTO_THEATER_STORAGE_KEY]) {
        const toggle = document.getElementById('auto-enter-theater-toggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = resolveAutoEnterTheater(changes[AUTO_THEATER_STORAGE_KEY].newValue);
      }
      if (changes[KEEP_CONTROLS_VISIBLE_STORAGE_KEY]) {
        const toggle = document.getElementById('keep-controls-visible-toggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = resolveKeepControlsVisible(changes[KEEP_CONTROLS_VISIBLE_STORAGE_KEY].newValue);
      }
    });
  }

  // Load and bind appearance controls
  renderAccentColorOptions(DEFAULT_ACCENT_COLOR);
  renderPictureAlignOptions(DEFAULT_PICTURE_ALIGN);
  await loadAndRenderAppearance();

  // Handle Form Submit
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    validationMsg.textContent = '';
    input.removeAttribute('aria-invalid');

    const inputValue = input.value;
    const domain = cleanDomain(inputValue);

    if (!domain) {
      validationMsg.textContent = t('invalidDomain');
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    try {
      const data = await safeGetStorage('blacklist');
      const blacklist = (data.blacklist || []) as string[];

      if (blacklist.includes(domain)) {
        validationMsg.textContent = t('websiteAlreadyExcluded');
        input.setAttribute('aria-invalid', 'true');
        return;
      }

      blacklist.push(domain);
      await chrome.storage.sync.set({ blacklist });

      input.value = '';
      await loadAndRenderBlacklist();
      await notifyAllTabs();
    } catch (err) {
      console.error('Error adding domain:', err);
      validationMsg.textContent = t('errorSavingSettings');
    }
  });

  // Load and render domains list
  async function loadAndRenderBlacklist(initialData?: Record<string, unknown>) {
    try {
      const data = initialData ?? await safeGetStorage('blacklist');
      let blacklist = (data.blacklist || []) as string[];
      
      // Normalize blacklist: strip www. and remove duplicates
      let normalized = false;
      const cleanedBlacklist = Array.from(new Set(blacklist.map(d => {
        const cleaned = d.toLowerCase().trim();
        if (cleaned.startsWith('www.')) {
          normalized = true;
          return cleaned.substring(4);
        }
        return cleaned;
      })));

      if (normalized || cleanedBlacklist.length !== blacklist.length) {
        await chrome.storage.sync.set({ blacklist: cleanedBlacklist });
        blacklist = cleanedBlacklist;
      }

      // Sort alphabetically
      blacklist.sort();

      countBadge.textContent = String(blacklist.length);
      countBadge.setAttribute('aria-label', `${t('excludedWebsitesTitle')}: ${blacklist.length}`);
      container.innerHTML = '';

      if (blacklist.length === 0) {
        // Render empty state
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.setAttribute('role', 'listitem');
        emptyState.innerHTML = `
          <svg aria-hidden="true" class="empty-state-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        `;
        const emptyTitle = document.createElement('h3');
        emptyTitle.dataset.i18n = 'noExclusionsYet';
        emptyTitle.textContent = t('noExclusionsYet');
        const emptyDescription = document.createElement('p');
        emptyDescription.dataset.i18n = 'noExclusionsDescription';
        emptyDescription.textContent = t('noExclusionsDescription');
        emptyState.appendChild(emptyTitle);
        emptyState.appendChild(emptyDescription);
        container.appendChild(emptyState);
        return;
      }

      // Render items as a list of compact rows
      blacklist.forEach(domain => {
        const item = document.createElement('div');
        item.className = 'exclusion-list-item';
        item.setAttribute('role', 'listitem');

        const domainSpan = document.createElement('span');
        domainSpan.className = 'domain-name';
        domainSpan.textContent = domain;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-list-btn';
        deleteBtn.dataset.i18nTitle = 'removeExclusion';
        deleteBtn.title = t('removeExclusion');
        deleteBtn.setAttribute('aria-label', `${t('removeExclusion')}: ${domain}`);
        deleteBtn.innerHTML = `
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        deleteBtn.addEventListener('click', () => removeDomain(domain));

        item.appendChild(domainSpan);
        item.appendChild(deleteBtn);
        container.appendChild(item);
      });

    } catch (err) {
      console.error('Error loading exclusion list:', err);
      const errorEl = document.createElement('div');
      errorEl.style.padding = '20px';
      errorEl.style.color = 'var(--danger-color)';
      errorEl.dataset.i18n = 'errorLoadingSettings';
      errorEl.textContent = t('errorLoadingSettings');
      container.replaceChildren(errorEl);
    }
  }

  // Remove domain from storage
  async function removeDomain(domain: string) {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const index = buttons.findIndex(button => button === document.activeElement);
    try {
      const data = await safeGetStorage('blacklist');
      let blacklist = (data.blacklist || []) as string[];
      
      blacklist = blacklist.filter(d => d !== domain);
      await chrome.storage.sync.set({ blacklist });
      
      await loadAndRenderBlacklist();
      if (index >= 0 && !container.closest('[hidden]')
          && (document.activeElement === document.body || document.activeElement === buttons[index])) {
        const remaining = container.querySelectorAll<HTMLButtonElement>('button');
        (remaining[Math.min(index, remaining.length - 1)] ?? input).focus();
      }
      await notifyAllTabs();
    } catch (err) {
      validationMsg.textContent = t('errorSavingSettings');
      console.error('Error removing domain:', err);
    }
  }

  // Clean and validate domain input (resolves urls into hostnames)
  function cleanDomain(inputVal: string) {
    let str = inputVal.trim().toLowerCase();
    if (!str) return null;

    // Check if it looks like a URL with protocol, otherwise prepend http:// to parse
    if (!/^https?:\/\//i.test(str)) {
      str = 'http://' + str;
    }

    try {
      const url = new URL(str);
      let host = url.hostname;
      
      // Basic domain check: must have at least one dot, and length > 3
      if (host && host.includes('.') && host.length > 3) {
        if (host.startsWith('www.')) {
          host = host.substring(4);
        }
        return host;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Notify all open tabs to reload their status dynamically
  async function notifyAllTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && tab.url.startsWith('http')) {
          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'statusChanged' });
          } catch (e) {
            // Ignore tabs without content script loaded
          }
        }
      }
    } catch (err) {
      console.error('Error notifying tabs:', err);
    }
  }

  function renderAccentColorOptions(selectedPreset: AccentColorPreset) {
    const grid = document.getElementById('accent-color-grid') as HTMLElement | null;
    if (!grid) return;

    if (grid.childElementCount) {
      grid.querySelectorAll<HTMLButtonElement>('[role=radio]').forEach(button => {
        const selected = button.dataset.accentColor === selectedPreset;
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('selected', selected);
      });
      return;
    }
    grid.addEventListener('keydown', event => {
      const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>('[role=radio]'));
      const index = buttons.findIndex(button => button === document.activeElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const rtl = getComputedStyle(grid).direction === 'rtl';
      const back = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
      const next = buttons[(index + (back ? -1 : 1) + buttons.length) % buttons.length];
      next.focus();
      next.click();
    });

    ACCENT_COLOR_OPTIONS.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'accent-color-btn';
      button.dataset.accentColor = option.preset;
      button.tabIndex = option.preset === selectedPreset ? 0 : -1;
      button.setAttribute('role', 'radio');
      const localizedLabel = t(`accentColor${option.preset[0].toUpperCase()}${option.preset.slice(1)}`);
      button.setAttribute('aria-label', t('useAccentColor', localizedLabel));
      button.setAttribute('aria-checked', option.preset === selectedPreset ? 'true' : 'false');
      button.title = localizedLabel;

      if (option.preset === selectedPreset) {
        button.classList.add('selected');
      }

      const swatch = document.createElement('span');
      swatch.className = 'accent-color-swatch';
      if (option.preset === 'system') {
        swatch.classList.add('system-swatch');
      } else {
        swatch.style.backgroundColor = option.swatch;
      }

      const label = document.createElement('span');
      label.className = 'accent-color-label';
      label.textContent = localizedLabel;

      button.appendChild(swatch);
      button.appendChild(label);
      button.addEventListener('click', () => {
        void saveAccentColor(option.preset);
      });

      grid.appendChild(button);
    });
  }

  async function loadAndRenderAppearance() {
    try {
      const data = await safeGetStorage([
        ACCENT_COLOR_STORAGE_KEY,
        PICTURE_ALIGN_STORAGE_KEY,
        RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY
      ]);
      const selectedPreset = resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]);
      applyAccentColorPreset(document.documentElement, selectedPreset);
      renderAccentColorOptions(selectedPreset);
      raiseOnlyWithSubtitles = resolveRaiseOnlyWithSubtitles(data[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]);
      renderPictureAlignOptions(resolvePictureAlign(data[PICTURE_ALIGN_STORAGE_KEY]));
    } catch (err) {
      console.error('Error loading appearance settings:', err);
      applyAccentColorPreset(document.documentElement, DEFAULT_ACCENT_COLOR);
      renderAccentColorOptions(DEFAULT_ACCENT_COLOR);
      renderPictureAlignOptions(DEFAULT_PICTURE_ALIGN);
    }
  }

  function pictureAlignIcon(align: PictureAlign): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 160 132');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('picture-align-icon');

    const bezel = document.createElementNS(svgNs, 'rect');
    bezel.setAttribute('x', '10');
    bezel.setAttribute('y', '10');
    bezel.setAttribute('width', '140');
    bezel.setAttribute('height', '112');
    bezel.setAttribute('rx', '10');
    bezel.setAttribute('fill', 'none');
    bezel.setAttribute('stroke', 'currentColor');
    bezel.setAttribute('stroke-width', '2');

    const stage = document.createElementNS(svgNs, 'rect');
    stage.setAttribute('x', '14');
    stage.setAttribute('y', '14');
    stage.setAttribute('width', '132');
    stage.setAttribute('height', '104');
    stage.setAttribute('rx', '6');
    stage.setAttribute('fill', '#09090b');

    const picture = document.createElementNS(svgNs, 'rect');
    picture.setAttribute('x', '22');
    picture.setAttribute('y', align === 'top' ? '18' : '34');
    picture.setAttribute('width', '116');
    picture.setAttribute('height', '64');
    picture.setAttribute('rx', '4');
    picture.setAttribute('fill', 'currentColor');
    picture.setAttribute('fill-opacity', '0.14');
    picture.setAttribute('stroke', 'currentColor');
    picture.setAttribute('stroke-width', '2');

    svg.append(bezel, stage, picture);

    if (align === 'top') {
      const bar = document.createElementNS(svgNs, 'rect');
      bar.setAttribute('x', '40');
      bar.setAttribute('y', '98');
      bar.setAttribute('width', '80');
      bar.setAttribute('height', '7');
      bar.setAttribute('rx', '3.5');
      bar.setAttribute('fill', 'currentColor');
      svg.append(bar);
    }

    return svg;
  }

  function pictureAlignButtons(grid: HTMLElement): HTMLButtonElement[] {
    return Array.from(grid.querySelectorAll<HTMLButtonElement>('.picture-align-btn'));
  }

  function syncPictureAlignButtons(grid: HTMLElement, selected: PictureAlign): boolean {
    const buttons = pictureAlignButtons(grid);
    if (buttons.length !== PICTURE_ALIGNS.length) return false;
    for (const button of buttons) {
      const align = button.dataset.pictureAlign === 'top' ? 'top' : 'center';
      const on = align === selected;
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.classList.toggle('selected', on);
      button.tabIndex = on ? 0 : -1;
      const name = button.querySelector('.picture-align-name');
      const description = button.querySelector('.picture-align-desc');
      if (name) name.textContent = t(align === 'top' ? 'pictureAlignTop' : 'pictureAlignCenter');
      if (description) description.textContent = t(align === 'top' ? 'pictureAlignTopDescription' : 'pictureAlignCenterDescription');
    }
    // Keep roving focus on the selected radio when the player changes this preference.
    const focused = buttons.find((button) => button === document.activeElement);
    if (focused?.getAttribute('aria-checked') === 'false') {
      buttons.find((button) => button.getAttribute('aria-checked') === 'true')?.focus();
    }
    return true;
  }

  function bindPictureAlignKeys(grid: HTMLElement): void {
    if (grid.dataset.keysBound === 'true') return;
    grid.dataset.keysBound = 'true';
    grid.addEventListener('keydown', (event) => {
      const buttons = pictureAlignButtons(grid);
      const index = buttons.findIndex((button) => button === document.activeElement);
      if (index < 0) return;
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === ' ' || event.key === 'Enter') next = index;
      else return;
      event.preventDefault();
      const align = buttons[next].dataset.pictureAlign === 'top' ? 'top' : 'center';
      buttons[next].focus();
      void savePictureAlign(align);
    });
  }

  function selectedPictureAlign(): PictureAlign {
    const selected = document.querySelector<HTMLButtonElement>('[data-picture-align][aria-checked="true"]');
    return selected?.dataset.pictureAlign === 'top' ? 'top' : 'center';
  }

  function syncRaisedSubtitlesControl(align: PictureAlign): void {
    const row = document.getElementById('picture-align-subtitles-row');
    const toggle = document.getElementById('picture-align-subtitles-toggle') as HTMLInputElement | null;
    if (!row || !toggle) return;
    const enabled = align === 'top';
    toggle.checked = raiseOnlyWithSubtitles;
    if (!enabled && document.activeElement === toggle) {
      document.querySelector<HTMLButtonElement>('[data-picture-align="center"]')?.focus();
    }
    toggle.disabled = !enabled;
    row.classList.toggle('is-disabled', !enabled);
  }

  function bindRaiseOnlyWithSubtitles(): void {
    const toggle = document.getElementById('picture-align-subtitles-toggle') as HTMLInputElement | null;
    if (!toggle || toggle.dataset.bound === 'true') return;
    toggle.dataset.bound = 'true';
    toggle.addEventListener('change', () => {
      if (toggle.disabled) return;
      void saveRaiseOnlyWithSubtitles(toggle.checked);
    });
  }

  function renderPictureAlignOptions(selected: PictureAlign) {
    const grid = document.getElementById('picture-align-grid') as HTMLElement | null;
    if (!grid) return;
    bindPictureAlignKeys(grid);
    bindRaiseOnlyWithSubtitles();
    syncRaisedSubtitlesControl(selected);
    if (syncPictureAlignButtons(grid, selected)) return;

    const subtitlesRow = document.getElementById('picture-align-subtitles-row');
    subtitlesRow?.remove();
    grid.textContent = '';

    PICTURE_ALIGNS.forEach(align => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picture-align-btn';
      button.dataset.pictureAlign = align;
      button.setAttribute('role', 'radio');
      button.tabIndex = align === selected ? 0 : -1;
      const name = document.createElement('span');
      name.className = 'picture-align-name';
      name.textContent = t(align === 'top' ? 'pictureAlignTop' : 'pictureAlignCenter');
      const description = document.createElement('span');
      description.className = 'picture-align-desc';
      description.textContent = t(align === 'top' ? 'pictureAlignTopDescription' : 'pictureAlignCenterDescription');
      const copy = document.createElement('span');
      copy.className = 'picture-align-copy';
      copy.append(name, description);
      button.setAttribute('aria-checked', align === selected ? 'true' : 'false');
      if (align === selected) button.classList.add('selected');
      button.append(pictureAlignIcon(align), copy);
      button.addEventListener('click', () => {
        void savePictureAlign(align);
      });
      if (align === 'top') mountRaisedCard(grid, button, subtitlesRow);
      else grid.appendChild(button);
    });
  }

  function mountRaisedCard(grid: HTMLElement, button: HTMLButtonElement, row: HTMLElement | null): void {
    if (!row) {
      grid.appendChild(button);
      return;
    }
    const card = document.createElement('div');
    card.className = 'picture-align-card';
    card.append(button, row);
    grid.appendChild(card);
  }

  async function savePictureAlign(align: PictureAlign) {
    try {
      renderPictureAlignOptions(align);

      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return;
      }

      await chrome.storage.sync.set({ [PICTURE_ALIGN_STORAGE_KEY]: align });
    } catch (err) {
      console.error('Error saving picture alignment:', err);
    }
  }

  async function saveRaiseOnlyWithSubtitles(enabled: boolean) {
    raiseOnlyWithSubtitles = enabled;
    syncRaisedSubtitlesControl(selectedPictureAlign());
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return;
      }

      await chrome.storage.sync.set({ [RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]: enabled });
    } catch (err) {
      console.error('Error saving raised subtitles setting:', err);
    }
  }

  async function saveAccentColor(preset: AccentColorPreset) {
    try {
      applyAccentColorPreset(document.documentElement, preset);
      renderAccentColorOptions(preset);

      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return;
      }

      await chrome.storage.sync.set({ [ACCENT_COLOR_STORAGE_KEY]: preset });
      await notifyAllTabs();
    } catch (err) {
      console.error('Error saving accent color setting:', err);
    }
  }

  // Removed internal declarations (moved to top of file)

  // --- Features ---
  async function loadAndRenderFeatures() {
    try {
      const data = await safeGetStorage([...FEATURE_TOGGLES.map((item) => item.key), ...mediaProviderFlagStorageKeys()]);
      for (const item of FEATURE_TOGGLES) {
        const toggle = document.getElementById(item.id) as HTMLInputElement | null;
        if (!toggle) continue;
        toggle.checked = item.resolve(data[item.key]);
      }
      const richTheaterToggle = document.getElementById('rich-theater-experience-toggle') as HTMLInputElement | null;
      if (richTheaterToggle) richTheaterToggle.checked = richTheaterExperienceEnabled(resolveMediaProviderFlags(data));
    } catch (err) {
      console.error('Error loading feature settings:', err);
    }
  }

  async function setupWhatsNew(): Promise<void> {
    const button = document.getElementById('whats-new-btn');
    if (!button) return;

    await syncWhatsNewButtonState(button);
    button.addEventListener('click', async () => {
      await openWhatsNewDialog();
      await syncWhatsNewButtonState(button);
    });

    if (await hasUnseenWhatsNew()) {
      await openWhatsNewDialog();
      await syncWhatsNewButtonState(button);
    }
  }

  function setupFeatureListeners() {
    for (const item of FEATURE_TOGGLES) {
      const toggle = document.getElementById(item.id) as HTMLInputElement | null;
      if (!toggle) continue;
      toggle.addEventListener('change', async () => {
        try {
          await chrome.storage.sync.set({ [item.key]: toggle.checked });
          await notifyAllTabs();
        } catch (err) {
          console.error('Error saving feature setting:', err);
        }
      });
    }

    const richTheaterToggle = document.getElementById('rich-theater-experience-toggle') as HTMLInputElement | null;
    richTheaterToggle?.addEventListener('change', async () => {
      try {
        const flags = mediaProviderFlagsForRichTheaterExperience(richTheaterToggle.checked);
        await chrome.storage.sync.set(mediaProviderFlagStorageUpdate(flags));
        await notifyAllTabs();
      } catch (err) {
        console.error('Error saving Rich Theater Experience setting:', err);
      }
    });

    const detailsToggle = document.getElementById('rich-theater-experience-details') as HTMLButtonElement | null;
    const richTheaterInfo = detailsToggle?.closest<HTMLElement>('.feature-info');
    const popover = document.getElementById('rich-theater-experience-popover');
    const focusDetails = () => {
      if (detailsToggle?.getAttribute('aria-expanded') === 'true' && document.activeElement === detailsToggle) popover?.focus();
    };
    popover?.addEventListener('transitionend', focusDetails);
    const setDetailsOpen = (expanded: boolean, restoreFocus = false) => {
      richTheaterInfo?.classList.toggle('rte-popover-open', expanded);
      detailsToggle?.setAttribute('aria-expanded', String(expanded));
      if (popover) popover.inert = !expanded;
      if (expanded) {
        focusDetails();
        requestAnimationFrame(focusDetails);
      } else if (restoreFocus) detailsToggle?.focus();
    };
    setDetailsOpen(false);
    detailsToggle?.addEventListener('click', () => {
      setDetailsOpen(detailsToggle.getAttribute('aria-expanded') !== 'true');
    });
    richTheaterInfo?.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || detailsToggle?.getAttribute('aria-expanded') !== 'true') return;
      event.preventDefault();
      setDetailsOpen(false, true);
    });
    richTheaterInfo?.addEventListener('focusout', event => {
      if (event.relatedTarget instanceof Node && richTheaterInfo.contains(event.relatedTarget)) return;
      setDetailsOpen(false);
    });
    document.addEventListener('click', event => {
      if (!(event.target instanceof Node) || richTheaterInfo?.contains(event.target)) return;
      setDetailsOpen(false);
    });
  }

  await setupWhatsNew();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
