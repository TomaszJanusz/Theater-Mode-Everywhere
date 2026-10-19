import { createSvgIcon } from '../src/ui/svg-icon';
import { saveAutoTheaterEnabled } from '../src/ui/auto-theater-settings';
import { setupAppearanceChoices } from './appearance-choices';
import { observeDocumentAppearance } from '../src/appearance-runtime';
import { SPONSORBLOCK_STORAGE_KEY, resolveSponsorBlockMarkers } from '../src/ui/sponsorblock-settings';
import { createCombobox } from './combobox';
import { createChoiceGrid } from './choice-grid';
import { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_STORAGE_KEY, type Language } from '../src/language';
import { setupFeatureHighlights } from './feature-highlights';
import { HIGHLIGHT_NEW_FEATURES_STORAGE_KEY } from '../src/feature-highlights';
import { languageRuntime, observeLanguageStorage } from '../src/i18n-runtime';
import { AUTO_THEATER_STORAGE_KEY, AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY, resolveAutoEnterTheater, resolveAutoTheaterSkipCountdown } from '../src/ui/auto-theater';
import { VOLUME_BOOST_STORAGE_KEY, resolveVolumeBoostEnabled } from '../src/ui/volume-boost-settings';
/* Options script for Theater Everywhere */
import { createShortcutEditor } from './shortcut-editor';
import { setupSettingsTabs } from './tabs';
import licenseText from '../LICENSE?raw';
import { openPrivacyPolicy } from './privacy-policy';
import { KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolveKeepControlsVisible } from '../src/ui/controls-visibility';
import { resolveVideoActivator, VIDEO_ACTIVATOR_STORAGE_KEY } from '../src/ui/video-activator-settings';
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
  DEFAULT_RAISE_ONLY_WITH_SUBTITLES,
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
import { installedVersion } from '../src/feature-highlights-storage';
import { hasUnseenWhatsNew, openWhatsNewDialog } from '../src/whatsNew';
import { setupRteSettings } from './rte-settings';
import { translationIssueUrl } from '../src/translation-issue';

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
observeDocumentAppearance();

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
  { id: 'sponsorblock-toggle', key: SPONSORBLOCK_STORAGE_KEY, resolve: resolveSponsorBlockMarkers },
  { id: 'auto-enter-theater-toggle', key: AUTO_THEATER_STORAGE_KEY, resolve: resolveAutoEnterTheater },
  { id: 'auto-theater-skip-countdown-toggle', key: AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY, resolve: resolveAutoTheaterSkipCountdown },
  { id: 'video-activator-toggle', key: VIDEO_ACTIVATOR_STORAGE_KEY, resolve: resolveVideoActivator },
  { id: 'keep-controls-visible-toggle', key: KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolve: resolveKeepControlsVisible },
  { id: 'volume-boost-toggle', key: VOLUME_BOOST_STORAGE_KEY, resolve: resolveVolumeBoostEnabled }
] as const;

async function init() {
  const stopLanguageStorage = observeLanguageStorage();
  window.addEventListener('unload', stopLanguageStorage, { once: true });
  const languageRevision = languageRuntime.revision;
  const initialSettingsPromise = safeGetStorage(['blacklist', LANGUAGE_STORAGE_KEY, HIGHLIGHT_NEW_FEATURES_STORAGE_KEY]);
  const highlights = setupFeatureHighlights(initialSettingsPromise);
  const initialSettings = await initialSettingsPromise;
  await languageRuntime.set(initialSettings[LANGUAGE_STORAGE_KEY], languageRevision);
  localizeDocument();
  const stopAppearanceChoices = setupAppearanceChoices();
  window.addEventListener('unload', stopAppearanceChoices, { once: true });
  await highlights.ready;
  highlights.render();
  setupSettingsTabs(document.getElementById('settings-tabs') as HTMLElement);
  document.getElementById('license-text')!.textContent = licenseText.trim();
  document.getElementById('privacy-policy-btn')!.addEventListener('click', openPrivacyPolicy);
  const renderVersion = () => { document.getElementById('about-version')!.textContent = t('aboutVersion', installedVersion()); };
  renderVersion();
  const renderTranslationIssueLink = () => {
    const locale = languageRuntime.language === DEFAULT_LANGUAGE ? t('@@ui_locale') : languageRuntime.language;
    (document.getElementById('translation-issue-link') as HTMLAnchorElement).href = translationIssueUrl(locale, installedVersion());
  };
  renderTranslationIssueLink();
  configurePrivacyThingLogo();
  let raiseOnlyWithSubtitles = DEFAULT_RAISE_ONLY_WITH_SUBTITLES;

  const form = document.getElementById('add-domain-form') as HTMLFormElement;
  const input = document.getElementById('domain-input') as HTMLInputElement;
  const validationMsg = document.getElementById('validation-msg') as HTMLElement;
  const container = document.getElementById('blacklist-container') as HTMLElement;
  const countBadge = document.getElementById('blacklist-count') as HTMLElement;

  const shortcutEditor = createShortcutEditor(notifyAllTabs);
  const accentName = (preset: AccentColorPreset) => t(`accentColor${preset[0].toUpperCase()}${preset.slice(1)}`);
  const accentGrid = createChoiceGrid(document.getElementById('accent-color-grid')!, ACCENT_COLOR_OPTIONS.map(option => ({
    value: option.preset,
    label: () => accentName(option.preset),
    ariaLabel: () => t('useAccentColor', accentName(option.preset)),
    swatch: { color: option.swatch, system: option.preset === 'system' }
  })), preset => { void saveAccentColor(preset); });
  const languageMenu = createCombobox<Language>(document.getElementById('language-combobox') as HTMLButtonElement, [
    { value: DEFAULT_LANGUAGE, label: () => t('languageAutomatic') },
    ...LANGUAGES.map(({ locale, name }) => ({
      value: locale, label: () => name, lang: locale.replace('_', '-'), dir: locale === 'ar' ? 'rtl' as const : 'ltr' as const
    }))
  ], async language => {
    // Same promise form as every other settings write here; try/catch also covers a synchronous throw.
    try {
      await chrome.storage.sync.set({ [LANGUAGE_STORAGE_KEY]: language });
    } catch (error) {
      languageMenu.render(languageRuntime.language);
      console.error('Error saving language:', error);
    }
  });
  languageMenu.render(languageRuntime.language);
  window.addEventListener('unload', () => languageMenu.destroy(), { once: true });
  const stopLanguageRendering = languageRuntime.subscribe(() => {
    localizeDocument();
    renderVersion();
    renderTranslationIssueLink();
    languageMenu.render(languageRuntime.language);
    accentGrid.render();
    renderPictureAlignOptions(selectedPictureAlign());
    shortcutEditor.localize();
    localizeBlacklist();
  });
  window.addEventListener('unload', stopLanguageRendering, { once: true });
  await loadAndRenderBlacklist(initialSettings);
  await shortcutEditor.initialize();

  const disposeRte = await setupRteSettings(notifyAllTabs);
  window.addEventListener('unload', disposeRte, { once: true });
  highlights.render(); // Service tiles exist only now.

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
      for (const feature of FEATURE_TOGGLES) {
        if (!changes[feature.key]) continue;
        const toggle = document.getElementById(feature.id) as HTMLInputElement | null;
        if (toggle) toggle.checked = feature.resolve(changes[feature.key].newValue);
      }
    });
  }

  // Load and bind appearance controls
  accentGrid.render(DEFAULT_ACCENT_COLOR);
  renderPictureAlignOptions(DEFAULT_PICTURE_ALIGN);
  await loadAndRenderAppearance();

  // Handle Form Submit
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    setValidation();
    input.removeAttribute('aria-invalid');

    const inputValue = input.value;
    const domain = cleanDomain(inputValue);

    if (!domain) {
      setValidation('invalidDomain');
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    try {
      const data = await safeGetStorage('blacklist');
      const blacklist = (data.blacklist || []) as string[];

      if (blacklist.includes(domain)) {
        setValidation('websiteAlreadyExcluded');
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
      setValidation('errorSavingSettings');
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
      container.replaceChildren();
      localizeBlacklist();

      if (blacklist.length === 0) {
        // Render empty state
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.setAttribute('role', 'listitem');
        emptyState.append(createSvgIcon(`
          <svg aria-hidden="true" class="empty-state-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        `));
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
        deleteBtn.append(createSvgIcon(`
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `));
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

  function localizeBlacklist(): void {
    countBadge.setAttribute('aria-label', `${t('excludedWebsitesTitle')}: ${countBadge.textContent}`);
    container.querySelectorAll<HTMLElement>('.exclusion-list-item').forEach(item => {
      item.querySelector('button')?.setAttribute('aria-label', `${t('removeExclusion')}: ${item.querySelector('.domain-name')?.textContent}`);
    });
  }

  function setValidation(key = ''): void {
    validationMsg.dataset.i18n = key;
    validationMsg.textContent = key ? t(key) : '';
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
      setValidation('errorSavingSettings');
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

  async function loadAndRenderAppearance() {
    try {
      const data = await safeGetStorage([
        ACCENT_COLOR_STORAGE_KEY,
        PICTURE_ALIGN_STORAGE_KEY,
        RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY
      ]);
      const selectedPreset = resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]);
      applyAccentColorPreset(document.documentElement, selectedPreset);
      accentGrid.render(selectedPreset);
      raiseOnlyWithSubtitles = resolveRaiseOnlyWithSubtitles(data[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]);
      renderPictureAlignOptions(resolvePictureAlign(data[PICTURE_ALIGN_STORAGE_KEY]));
    } catch (err) {
      console.error('Error loading appearance settings:', err);
      applyAccentColorPreset(document.documentElement, DEFAULT_ACCENT_COLOR);
      accentGrid.render(DEFAULT_ACCENT_COLOR);
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
      accentGrid.render(preset);

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
      const data = await safeGetStorage(FEATURE_TOGGLES.map((item) => item.key));
      for (const item of FEATURE_TOGGLES) {
        const toggle = document.getElementById(item.id) as HTMLInputElement | null;
        if (!toggle) continue;
        toggle.checked = item.resolve(data[item.key]);
      }

    } catch (err) {
      console.error('Error loading feature settings:', err);
    }
  }

  async function setupWhatsNew(): Promise<void> {
    const button = document.getElementById('whats-new-btn');
    if (!button) return;

    highlights.render();
    button.addEventListener('click', async () => {
      await openWhatsNewDialog();
      highlights.render();
    });

    if (await hasUnseenWhatsNew()) {
      await openWhatsNewDialog();
      highlights.render();
    }
  }

  function setupFeatureListeners() {
    for (const item of FEATURE_TOGGLES) {
      const toggle = document.getElementById(item.id) as HTMLInputElement | null;
      if (!toggle) continue;
      toggle.addEventListener('change', async () => {
        try {
          if (item.key === AUTO_THEATER_STORAGE_KEY) await saveAutoTheaterEnabled(toggle.checked);
          else await chrome.storage.sync.set({ [item.key]: toggle.checked });
          await notifyAllTabs();
        } catch (err) {
          console.error('Error saving feature setting:', err);
        }
      });
    }


  }

  await setupWhatsNew();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
