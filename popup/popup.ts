import { observeDocumentAppearance } from '../src/appearance-runtime';
import { localizeDocument, t } from '../src/i18n';
import { languageRuntime, observeLanguageStorage } from '../src/i18n-runtime';
import { LANGUAGE_STORAGE_KEY } from '../src/language';
/* Popup script for Theater Everywhere */
import { parentBlockedEntry, removeMatchingBlacklistEntry, resolveDomainPolicy } from '../src/platform/domain-policy';
import { fetchAndApplyTheme } from '../src/themeHelper';
import { renderShortcutCaps } from '../src/ui/kbd-text';
import { withShortcutDefaults } from '../src/ui/shortcuts';

import { setupPopupRte } from './rte-settings';
import { setupPopupUpdateNotice } from './update-notice';

// Apply browser theme colors immediately
fetchAndApplyTheme();
observeDocumentAppearance();

document.addEventListener('DOMContentLoaded', async () => {
  const stopLanguageStorage = observeLanguageStorage();
  window.addEventListener('unload', stopLanguageStorage, { once: true });
  const revision = languageRuntime.revision;
  let shortcuts = withShortcutDefaults(undefined);
  try {
    const data = await chrome.storage.sync.get(['shortcuts', LANGUAGE_STORAGE_KEY]);
    shortcuts = withShortcutDefaults(data.shortcuts);
    await languageRuntime.set(data[LANGUAGE_STORAGE_KEY], revision);
  } catch (error) { console.error('Error loading popup preferences:', error); }
  localizeDocument();
  const updateNotice = setupPopupUpdateNotice();
  window.addEventListener('unload', updateNotice.dispose, { once: true });

  const domainNameEl = document.getElementById('domain-name') as HTMLElement;
  const toggleEl = document.getElementById('extension-toggle') as HTMLInputElement;
  const statusDotEl = document.getElementById('status-dot') as HTMLElement;
  const statusTextEl = document.getElementById('status-text') as HTMLElement;
  const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;

  let currentDomain = '';
  let activeTabId: number | null = null;
  let domainMessage: string | null = 'loadingLabel';
  let status = { active: true, key: 'statusActive', substitution: undefined as string | undefined };
  // Dynamic domain/status text has its own owner after initialization.
  domainNameEl.removeAttribute('data-i18n');
  statusTextEl.removeAttribute('data-i18n');
  const renderShortcut = () => {
    const keyCaps = document.querySelector<HTMLElement>('.key-caps');
    if (!keyCaps) return;
    if (shortcuts.toggle) renderShortcutCaps(keyCaps, shortcuts.toggle);
    else keyCaps.textContent = t('shortcutUnassigned');
  };
  const stopLanguageRendering = languageRuntime.subscribe(() => {
    localizeDocument();
    if (domainMessage) domainNameEl.textContent = t(domainMessage);
    setUIState(status.active, status.key, status.substitution);
    renderShortcut();
    updateNotice.render();
  });
  window.addEventListener('unload', stopLanguageRendering, { once: true });
  renderShortcut();

  // 1. Get current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.id !== undefined) {
      activeTabId = tab.id;
      const url = new URL(tab.url);
      
      // Check for valid http/https pages
      if (url.protocol.startsWith('http')) {
        let domain = url.hostname;
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
        currentDomain = domain;
        domainMessage = null;
        domainNameEl.textContent = url.hostname;
        const stopRte = setupPopupRte(url.hostname);
        window.addEventListener('unload', stopRte, { once: true });

        // Load settings and update UI
        await updateStatusUI();
      } else {
        // System pages (chrome://, about://, etc.)
        domainMessage = 'systemPage';
        domainNameEl.textContent = t(domainMessage);
        toggleEl.disabled = true;
        setUIState(false, 'statusInactiveSystem');
      }
    } else {
      domainMessage = 'noActivePage';
      domainNameEl.textContent = t(domainMessage);
      toggleEl.disabled = true;
      setUIState(false, 'statusUnavailable');
    }
  } catch (err) {
    console.error('Popup initialization error:', err);
    domainMessage = 'errorLoading';
    domainNameEl.textContent = t(domainMessage);
    toggleEl.disabled = true;
  }

  // 2. Open options page
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 3. Handle toggle change
  toggleEl.addEventListener('change', async () => {
    if (!currentDomain) return;

    const isActive = toggleEl.checked;
    
    try {
      const data = await chrome.storage.sync.get({ blacklist: [] });
      let blacklist = (data.blacklist || []) as string[];

      // Normalize all stored blacklist entries to strip www.
      blacklist = blacklist.map(d => d.startsWith('www.') ? d.substring(4) : d);

      if (isActive) {
        blacklist = removeMatchingBlacklistEntry(currentDomain, blacklist);
      } else {
        // Add to blacklist to deactivate
        if (!blacklist.includes(currentDomain)) {
          blacklist.push(currentDomain);
        }
      }

      // Deduplicate
      blacklist = Array.from(new Set(blacklist));

      await chrome.storage.sync.set({ blacklist });
      
      // Update local UI
      setUIState(isActive, isActive ? 'statusActive' : 'statusDisabled');

      // Notify the active tab's content script to update its state dynamically
      if (activeTabId) {
        try {
          await chrome.tabs.sendMessage(activeTabId, { action: 'statusChanged' });
        } catch (msgErr) {
          // Content script might not be injected (e.g. extension just installed, or page loading)
          console.log('Could not send message to tab (content script inactive):', msgErr);
        }
      }
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  });

  // Helper to read storage and set toggle state
  async function updateStatusUI() {
    try {
      const data = await chrome.storage.sync.get({ blacklist: [] });
      const blacklist = (data.blacklist || []) as string[];
      
      const policy = resolveDomainPolicy(currentDomain, blacklist);
      const isActive = !policy.effective;
      toggleEl.checked = isActive;
      const parentEntry = parentBlockedEntry(policy);
      if (parentEntry) {
        setUIState(false, 'statusDisabledByParent', parentEntry);
      } else {
        setUIState(isActive, isActive ? 'statusActive' : 'statusDisabled');
      }
    } catch (err) {
      console.error('Error reading storage:', err);
    }
  }

  // Helper to change classes/texts of indicators
  function setUIState(active: boolean, key: string, substitution?: string) {
    status = { active, key, substitution };
    statusTextEl.textContent = t(key, substitution);
    if (active) {
      statusDotEl.className = 'dot active';
    } else {
      statusDotEl.className = 'dot disabled';
    }
  }
});
