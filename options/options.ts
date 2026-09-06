/* Options script for Theater Everywhere */
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
  definePrivacyThingLogo,
  type PrivacyThingLogoElement
} from '@privacy-thing/brand';
import { localizeDocument, t } from '../src/i18n';
import { hasUnseenWhatsNew, openWhatsNewDialog, syncWhatsNewButtonState } from '../src/whatsNew';

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

interface Shortcuts {
  toggle: string;
  exit: string;
  seekBack: string;
  seekForward: string;
  cycle: string;
  playPause: string;
  frameBack: string;
  frameForward: string;
  toggleFullscreen: string;
  volumeUp: string;
  volumeDown: string;
  togglePiP: string;
  showHelp: string;
  cycleFit: string;
}

const defaultShortcuts: Shortcuts = {
  toggle: 'T',
  exit: 'Escape',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  cycle: 'Shift+T',
  playPause: 'Space',
  frameBack: '<',
  frameForward: '>',
  toggleFullscreen: 'F',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  togglePiP: 'P',
  showHelp: 'H',
  cycleFit: 'Z'
};

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

async function init() {
  localizeDocument();
  configurePrivacyThingLogo();

  const form = document.getElementById('add-domain-form') as HTMLFormElement;
  const input = document.getElementById('domain-input') as HTMLInputElement;
  const validationMsg = document.getElementById('validation-msg') as HTMLElement;
  const container = document.getElementById('blacklist-container') as HTMLElement;
  const countBadge = document.getElementById('blacklist-count') as HTMLElement;

  // Load and render blacklist on startup
  await loadAndRenderBlacklist();

  // Load and bind keyboard shortcuts on startup
  await loadAndRenderShortcuts();
  setupShortcutListeners();

  // Load and bind features toggles
  await loadAndRenderFeatures();
  setupFeatureListeners();

  // Load and bind appearance controls
  renderAccentColorOptions(DEFAULT_ACCENT_COLOR);
  await loadAndRenderAppearance();

  // Handle Form Submit
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    validationMsg.textContent = '';

    const inputValue = input.value;
    const domain = cleanDomain(inputValue);

    if (!domain) {
      validationMsg.textContent = t('invalidDomain');
      return;
    }

    try {
      const data = await safeGetStorage('blacklist');
      const blacklist = (data.blacklist || []) as string[];

      if (blacklist.includes(domain)) {
        validationMsg.textContent = t('websiteAlreadyExcluded');
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
  async function loadAndRenderBlacklist() {
    try {
      const data = await safeGetStorage('blacklist');
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
      container.innerHTML = '';

      if (blacklist.length === 0) {
        // Render empty state
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
          <svg class="empty-state-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        `;
        const emptyTitle = document.createElement('h3');
        emptyTitle.textContent = t('noExclusionsYet');
        const emptyDescription = document.createElement('p');
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

        const domainSpan = document.createElement('span');
        domainSpan.className = 'domain-name';
        domainSpan.textContent = domain;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-list-btn';
        deleteBtn.title = t('removeExclusion');
        deleteBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
      errorEl.textContent = t('errorLoadingSettings');
      container.replaceChildren(errorEl);
    }
  }

  // Remove domain from storage
  async function removeDomain(domain: string) {
    try {
      const data = await safeGetStorage('blacklist');
      let blacklist = (data.blacklist || []) as string[];
      
      blacklist = blacklist.filter(d => d !== domain);
      await chrome.storage.sync.set({ blacklist });
      
      await loadAndRenderBlacklist();
      await notifyAllTabs();
    } catch (err) {
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

    grid.textContent = '';

    ACCENT_COLOR_OPTIONS.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'accent-color-btn';
      button.dataset.accentColor = option.preset;
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
      const data = await safeGetStorage(ACCENT_COLOR_STORAGE_KEY);
      const selectedPreset = resolveAccentColorPreset(data[ACCENT_COLOR_STORAGE_KEY]);
      applyAccentColorPreset(document.documentElement, selectedPreset);
      renderAccentColorOptions(selectedPreset);
    } catch (err) {
      console.error('Error loading appearance settings:', err);
      applyAccentColorPreset(document.documentElement, DEFAULT_ACCENT_COLOR);
      renderAccentColorOptions(DEFAULT_ACCENT_COLOR);
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

  function renderShortcuts(shortcuts: Shortcuts) {
    const toggleInput = document.getElementById('shortcut-toggle') as HTMLInputElement;
    const exitInput = document.getElementById('shortcut-exit') as HTMLInputElement;
    const seekBackInput = document.getElementById('shortcut-seek-back') as HTMLInputElement;
    const seekForwardInput = document.getElementById('shortcut-seek-forward') as HTMLInputElement;
    const cycleInput = document.getElementById('shortcut-cycle') as HTMLInputElement;
    const playPauseInput = document.getElementById('shortcut-play-pause') as HTMLInputElement;
    const frameBackInput = document.getElementById('shortcut-frame-back') as HTMLInputElement;
    const frameForwardInput = document.getElementById('shortcut-frame-forward') as HTMLInputElement;
    const toggleFullscreenInput = document.getElementById('shortcut-toggle-fullscreen') as HTMLInputElement;
    const volumeUpInput = document.getElementById('shortcut-volume-up') as HTMLInputElement;
    const volumeDownInput = document.getElementById('shortcut-volume-down') as HTMLInputElement;
    const togglePiPInput = document.getElementById('shortcut-toggle-pip') as HTMLInputElement;
    const showHelpInput = document.getElementById('shortcut-show-help') as HTMLInputElement;
    const cycleFitInput = document.getElementById('shortcut-cycle-fit') as HTMLInputElement;

    if (toggleInput) toggleInput.value = shortcuts.toggle || defaultShortcuts.toggle;
    if (exitInput) exitInput.value = shortcuts.exit || defaultShortcuts.exit;
    if (seekBackInput) seekBackInput.value = shortcuts.seekBack || defaultShortcuts.seekBack;
    if (seekForwardInput) seekForwardInput.value = shortcuts.seekForward || defaultShortcuts.seekForward;
    if (cycleInput) cycleInput.value = shortcuts.cycle || defaultShortcuts.cycle;
    if (playPauseInput) playPauseInput.value = shortcuts.playPause || defaultShortcuts.playPause;
    if (frameBackInput) frameBackInput.value = shortcuts.frameBack || defaultShortcuts.frameBack;
    if (frameForwardInput) frameForwardInput.value = shortcuts.frameForward || defaultShortcuts.frameForward;
    if (toggleFullscreenInput) toggleFullscreenInput.value = shortcuts.toggleFullscreen || defaultShortcuts.toggleFullscreen;
    if (volumeUpInput) volumeUpInput.value = shortcuts.volumeUp || defaultShortcuts.volumeUp;
    if (volumeDownInput) volumeDownInput.value = shortcuts.volumeDown || defaultShortcuts.volumeDown;
    if (togglePiPInput) togglePiPInput.value = shortcuts.togglePiP || defaultShortcuts.togglePiP;
    if (showHelpInput) showHelpInput.value = shortcuts.showHelp || defaultShortcuts.showHelp;
    if (cycleFitInput) cycleFitInput.value = shortcuts.cycleFit || defaultShortcuts.cycleFit;
  }

  async function loadAndRenderShortcuts() {
    try {
      const data = await safeGetStorage('shortcuts');
      const saved = data.shortcuts || {};
      
      const shortcuts = {
        toggle: saved.toggle || defaultShortcuts.toggle,
        exit: saved.exit || defaultShortcuts.exit,
        seekBack: saved.seekBack || defaultShortcuts.seekBack,
        seekForward: saved.seekForward || defaultShortcuts.seekForward,
        cycle: saved.cycle || defaultShortcuts.cycle,
        playPause: saved.playPause || defaultShortcuts.playPause,
        frameBack: saved.frameBack || defaultShortcuts.frameBack,
        frameForward: saved.frameForward || defaultShortcuts.frameForward,
        toggleFullscreen: saved.toggleFullscreen || defaultShortcuts.toggleFullscreen,
        volumeUp: saved.volumeUp || defaultShortcuts.volumeUp,
        volumeDown: saved.volumeDown || defaultShortcuts.volumeDown,
        togglePiP: saved.togglePiP || defaultShortcuts.togglePiP,
        showHelp: saved.showHelp || defaultShortcuts.showHelp,
        cycleFit: saved.cycleFit || defaultShortcuts.cycleFit
      } as Shortcuts;
      
      renderShortcuts(shortcuts);
    } catch (err) {
      console.error('Error loading shortcuts, using defaults:', err);
      renderShortcuts(defaultShortcuts);
    }
  }

  function getShortcutString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey && e.key !== 'Control') parts.push('Ctrl');
    if (e.altKey && e.key !== 'Alt') parts.push('Alt');
    if (e.shiftKey && e.key !== 'Shift') parts.push('Shift');
    if (e.metaKey && e.key !== 'Meta') parts.push('Meta');
    
    // Add the main key
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Meta') {
      let keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (keyName === ' ') {
        keyName = 'Space';
      }
      parts.push(keyName);
    }
    
    return parts.join('+');
  }

  function setupShortcutListeners() {
    // 1. Keyboard recording listener
    const inputs = document.querySelectorAll('.shortcut-input') as NodeListOf<HTMLInputElement>;
    inputs.forEach(input => {
      input.addEventListener('keydown', async (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const isModifierOnly = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
        if (isModifierOnly) {
          const tempParts: string[] = [];
          if (e.ctrlKey) tempParts.push('Ctrl');
          if (e.altKey) tempParts.push('Alt');
          if (e.shiftKey) tempParts.push('Shift');
          if (e.metaKey) tempParts.push('Meta');
          tempParts.push('...');
          input.value = tempParts.join('+');
          return;
        }

        const shortcutStr = getShortcutString(e);
        if (!shortcutStr) return;

        input.value = shortcutStr;

        // Save to storage
        try {
          const data = await safeGetStorage('shortcuts');
          const saved = data.shortcuts || {};
          const shortcuts = {
            toggle: saved.toggle || defaultShortcuts.toggle,
            exit: saved.exit || defaultShortcuts.exit,
            seekBack: saved.seekBack || defaultShortcuts.seekBack,
            seekForward: saved.seekForward || defaultShortcuts.seekForward,
            cycle: saved.cycle || defaultShortcuts.cycle,
            playPause: saved.playPause || defaultShortcuts.playPause,
            frameBack: saved.frameBack || defaultShortcuts.frameBack,
            frameForward: saved.frameForward || defaultShortcuts.frameForward,
            toggleFullscreen: saved.toggleFullscreen || defaultShortcuts.toggleFullscreen,
            volumeUp: saved.volumeUp || defaultShortcuts.volumeUp,
            volumeDown: saved.volumeDown || defaultShortcuts.volumeDown,
            togglePiP: saved.togglePiP || defaultShortcuts.togglePiP,
            showHelp: saved.showHelp || defaultShortcuts.showHelp,
            cycleFit: saved.cycleFit || defaultShortcuts.cycleFit
          } as Shortcuts;

          const shortcutId = input.id;
          if (shortcutId === 'shortcut-toggle') shortcuts.toggle = shortcutStr;
          else if (shortcutId === 'shortcut-exit') shortcuts.exit = shortcutStr;
          else if (shortcutId === 'shortcut-seek-back') shortcuts.seekBack = shortcutStr;
          else if (shortcutId === 'shortcut-seek-forward') shortcuts.seekForward = shortcutStr;
          else if (shortcutId === 'shortcut-cycle') shortcuts.cycle = shortcutStr;
          else if (shortcutId === 'shortcut-play-pause') shortcuts.playPause = shortcutStr;
          else if (shortcutId === 'shortcut-frame-back') shortcuts.frameBack = shortcutStr;
          else if (shortcutId === 'shortcut-frame-forward') shortcuts.frameForward = shortcutStr;
          else if (shortcutId === 'shortcut-toggle-fullscreen') shortcuts.toggleFullscreen = shortcutStr;
          else if (shortcutId === 'shortcut-volume-up') shortcuts.volumeUp = shortcutStr;
          else if (shortcutId === 'shortcut-volume-down') shortcuts.volumeDown = shortcutStr;
          else if (shortcutId === 'shortcut-toggle-pip') shortcuts.togglePiP = shortcutStr;
          else if (shortcutId === 'shortcut-show-help') shortcuts.showHelp = shortcutStr;
          else if (shortcutId === 'shortcut-cycle-fit') shortcuts.cycleFit = shortcutStr;

          await chrome.storage.sync.set({ shortcuts });
          await notifyAllTabs();
        } catch (err) {
          console.error('Error saving shortcut:', err);
        }
      });
    });

    // 2. Individual reset buttons listener
    const singleResetBtns = document.querySelectorAll('.reset-single-btn') as NodeListOf<HTMLButtonElement>;
    singleResetBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const shortcutKey = btn.getAttribute('data-shortcut') as keyof Shortcuts;
        if (!shortcutKey || !defaultShortcuts[shortcutKey]) return;

        try {
          const data = await safeGetStorage('shortcuts');
          const saved = data.shortcuts || {};
          const shortcuts = {
            toggle: saved.toggle || defaultShortcuts.toggle,
            exit: saved.exit || defaultShortcuts.exit,
            seekBack: saved.seekBack || defaultShortcuts.seekBack,
            seekForward: saved.seekForward || defaultShortcuts.seekForward,
            cycle: saved.cycle || defaultShortcuts.cycle,
            playPause: saved.playPause || defaultShortcuts.playPause,
            frameBack: saved.frameBack || defaultShortcuts.frameBack,
            frameForward: saved.frameForward || defaultShortcuts.frameForward,
            toggleFullscreen: saved.toggleFullscreen || defaultShortcuts.toggleFullscreen,
            volumeUp: saved.volumeUp || defaultShortcuts.volumeUp,
            volumeDown: saved.volumeDown || defaultShortcuts.volumeDown,
            togglePiP: saved.togglePiP || defaultShortcuts.togglePiP,
            showHelp: saved.showHelp || defaultShortcuts.showHelp,
            cycleFit: saved.cycleFit || defaultShortcuts.cycleFit
          } as Shortcuts;

          shortcuts[shortcutKey] = defaultShortcuts[shortcutKey];

          await chrome.storage.sync.set({ shortcuts });
          await loadAndRenderShortcuts();
          await notifyAllTabs();
        } catch (err) {
          console.error(`Error resetting individual shortcut ${shortcutKey}:`, err);
        }
      });
    });

    // 3. Reset all to defaults button listener
    const resetBtn = document.getElementById('reset-shortcuts-btn') as HTMLButtonElement | null;
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        try {
          await chrome.storage.sync.set({ shortcuts: defaultShortcuts });
          await loadAndRenderShortcuts();
          await notifyAllTabs();
        } catch (err) {
          console.error('Error resetting shortcuts:', err);
        }
      });
    }
  }

  // --- Features (Volume Boost) ---
  async function loadAndRenderFeatures() {
    try {
      const data = await safeGetStorage('volumeBoostEnabled');
      const enabled = data.volumeBoostEnabled !== undefined ? data.volumeBoostEnabled : false;
      const toggle = document.getElementById('volume-boost-toggle') as HTMLInputElement | null;
      if (toggle) toggle.checked = enabled;
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
    const toggle = document.getElementById('volume-boost-toggle') as HTMLInputElement | null;
    if (toggle) {
      toggle.addEventListener('change', async () => {
        try {
          await chrome.storage.sync.set({ volumeBoostEnabled: toggle.checked });
          await notifyAllTabs();
        } catch (err) {
          console.error('Error saving volume boost setting:', err);
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
