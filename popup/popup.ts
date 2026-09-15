/* Popup script for Theater Everywhere */
import { fetchAndApplyTheme } from '../src/themeHelper';
import { localizeDocument, t } from '../src/i18n';
import { parentBlockedEntry, removeMatchingBlacklistEntry, resolveDomainPolicy } from '../src/platform/domain-policy';

// Apply browser theme colors immediately
fetchAndApplyTheme();

document.addEventListener('DOMContentLoaded', async () => {
  localizeDocument();

  const domainNameEl = document.getElementById('domain-name') as HTMLElement;
  const toggleEl = document.getElementById('extension-toggle') as HTMLInputElement;
  const statusDotEl = document.getElementById('status-dot') as HTMLElement;
  const statusTextEl = document.getElementById('status-text') as HTMLElement;
  const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;

  let currentDomain = '';
  let activeTabId: number | null = null;

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
        domainNameEl.textContent = url.hostname;
        
        // Load settings and update UI
        await updateStatusUI();
      } else {
        // System pages (chrome://, about://, etc.)
        domainNameEl.textContent = t('systemPage');
        toggleEl.disabled = true;
        setUIState(false, t('statusInactiveSystem'));
      }
    } else {
      domainNameEl.textContent = t('noActivePage');
      toggleEl.disabled = true;
      setUIState(false, t('statusUnavailable'));
    }
  } catch (err) {
    console.error('Popup initialization error:', err);
    domainNameEl.textContent = t('errorLoading');
    toggleEl.disabled = true;
  }

  try {
    const data = await chrome.storage.sync.get('shortcuts');
    const toggleShortcut = (data.shortcuts && data.shortcuts.toggle) || 'T';
    const keyCapEl = document.querySelector('.key-cap') as HTMLElement | null;
    if (keyCapEl) {
      keyCapEl.textContent = toggleShortcut;
    }
  } catch (err) {
    console.error('Error loading shortcuts in popup:', err);
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
      setUIState(isActive, isActive ? t('statusActive') : t('statusDisabled'));

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
        setUIState(false, t('statusDisabledByParent', parentEntry));
      } else {
        setUIState(isActive, isActive ? t('statusActive') : t('statusDisabled'));
      }
    } catch (err) {
      console.error('Error reading storage:', err);
    }
  }

  // Helper to change classes/texts of indicators
  function setUIState(active: boolean, text: string) {
    statusTextEl.textContent = text;
    if (active) {
      statusDotEl.className = 'dot active';
    } else {
      statusDotEl.className = 'dot disabled';
    }
  }
});
