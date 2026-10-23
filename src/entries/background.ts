import { isOpenOptionsRequest, type OptionsSection } from '../protocol/options-page';
import { createFeatureHighlightsLifecycle } from '../feature-highlights-lifecycle';
import { loadLanguageCatalog } from '../platform/locale-catalog';
import { abandonBody, readBoundedBytes } from '../platform/bounded-body';
import { resolveDomainPolicy } from '../platform/domain-policy';
import { createShortcutUpdateQueue, readShortcutUpdate } from '../ui/shortcut-updates';
import { withShortcutDefaults } from '../ui/shortcuts';
import {
  LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY,
  removeLegacyYoutubeExclusion
} from '../platform/legacy-youtube-exclusion';
import { isAllowedBrokerFetchUrl, MAX_CAPTION_BYTES } from '../platform/media-url-policy';

declare const browser: any;

const isFirefox = typeof browser !== 'undefined' && typeof browser.theme !== 'undefined';

const ICON_ACTIVE: chrome.action.TabIconDetails['path'] = {
  '16':  'icons/icon-16.png',
  '32':  'icons/icon-32.png',
  '48':  'icons/icon-48.png',
  '96':  'icons/icon-96.png',
  '128': 'icons/icon-128.png',
};

const ICON_DISABLED: chrome.action.TabIconDetails['path'] = {
  '16':  'icons/icon-16-disabled.png',
  '32':  'icons/icon-32-disabled.png',
  '48':  'icons/icon-48-disabled.png',
  '96':  'icons/icon-96-disabled.png',
  '128': 'icons/icon-128-disabled.png',
};

async function updateIconForTab(tabId: number, url: string | undefined): Promise<void> {
  if (!url || !url.startsWith('http')) {
    chrome.action.setIcon({ path: ICON_ACTIVE, tabId });
    return;
  }
  try {
    const hostname = new URL(url).hostname;
    const data = await chrome.storage.sync.get({ blacklist: [] as string[] });
    const blacklist = data.blacklist as string[];
    const isBlacklisted = resolveDomainPolicy(hostname, blacklist).effective;
    chrome.action.setIcon({ path: isBlacklisted ? ICON_DISABLED : ICON_ACTIVE, tabId });
  } catch {
    chrome.action.setIcon({ path: ICON_ACTIVE, tabId });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  updateIconForTab(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab.url);
  }
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (!changes.blacklist) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      updateIconForTab(tab.id, tab.url);
    }
  }
});

async function fetchAllowlistedCaption(url: string): Promise<{ ok: boolean; body?: string; contentType?: string; error?: string }> {
  if (!isAllowedBrokerFetchUrl(url)) {
    return { ok: false, error: 'blocked' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!isAllowedBrokerFetchUrl(response.url)) {
      abandonBody(response.body);
      return { ok: false, error: 'redirect-blocked' };
    }
    if (!response.ok) {
      abandonBody(response.body);
      return { ok: false, error: `http-${response.status}` };
    }
    const buffer = await readBoundedBytes(response, MAX_CAPTION_BYTES, controller.signal);
    if (!buffer) {
      return { ok: false, error: 'too-large' };
    }
    const contentType = response.headers.get('content-type') || '';
    const body = new TextDecoder('utf-8').decode(buffer);
    const looksLikeCaptions = /WEBVTT|#EXTM3U|<transcript|<timedtext|<text |<p\b|"events"\s*:|"tiles"\s*:|"images"\s*:|\[Script Info\]|Dialogue:|"body"\s*:/i.test(body.slice(0, 400));
    if (contentType && !/text|xml|json|vtt|srt|ttml|octet-stream|mpegurl|m3u8/i.test(contentType) && !looksLikeCaptions) {
      return { ok: false, error: 'content-type' };
    }
    return { ok: true, body, contentType };
  } catch {
    return { ok: false, error: 'fetch-failed' };
  } finally {
    clearTimeout(timeout);
  }
}

const shortcutUpdates = createShortcutUpdateQueue({
  read: async () => withShortcutDefaults((await chrome.storage.sync.get('shortcuts')).shortcuts),
  write: async shortcuts => { await chrome.storage.sync.set({ shortcuts }); }
});

const highlights = createFeatureHighlightsLifecycle(chrome.storage.local, chrome.runtime.getManifest().version, Date.now);

/**
 * Settings, optionally at one tab. An open Settings tab is reused and moved to the section (the page follows
 * `hashchange` without reloading); `openOptionsPage` cannot take a hash, so a section otherwise opens a new tab.
 */
async function openOptionsPage(section?: OptionsSection): Promise<void> {
  const file = chrome.runtime.getManifest().options_ui?.page;
  if (!section || !file) return chrome.runtime.openOptionsPage();
  const page = chrome.runtime.getURL(file);
  const url = `${page}#${section}`;
  const open = (await chrome.tabs.query({})).find(tab => tab.url?.split('#')[0] === page);
  if (open?.id === undefined) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(open.id, { url, active: true });
  await chrome.windows.update(open.windowId, { focused: true });
}

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: any) => {
  if (message?.action === 'feature-highlights') {
    const operations: Record<string, () => Promise<unknown>> = {
      read: highlights.read, acknowledge: highlights.acknowledge,
      hide: highlights.hideUntilNextVersion, restore: highlights.restoreHidden
    };
    if (_sender.id !== chrome.runtime.id || !Object.hasOwn(operations, message.operation)) return false;
    const operation = operations[message.operation]();
    operation.then(value => sendResponse(value ?? {})).catch(error => {
      console.error('[Theater Everywhere] Feature highlights storage failed:', error);
      sendResponse(null);
    });
    return true;
  }
  if (message?.action === 'get-language-catalog') {
    loadLanguageCatalog(message.locale).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (message?.action === 'update-shortcuts') {
    const request = readShortcutUpdate(message.request);
    const optionsUrl = chrome.runtime.getURL('options/options.html');
    if (_sender.url?.split(/[?#]/)[0] !== optionsUrl || !request) {
      sendResponse({ status: 'error' });
      return false;
    }
    shortcutUpdates.apply(request).then(sendResponse).catch(error => {
      console.error('[Theater Everywhere] Shortcut update failed:', error);
      sendResponse({ status: 'error' });
    });
    return true;
  }
  if (message && message.action === 'theater-fetch-media') {
    fetchAllowlistedCaption(String(message.url || '')).then(sendResponse);
    return true;
  }
  if (message && message.action === 'open-options-page') {
    if (_sender.id !== chrome.runtime.id || !isOpenOptionsRequest(message)) return false;
    openOptionsPage(message.section)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        console.error('[Theater Everywhere] Error opening options page:', error);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (message && message.action === 'getBrowserTheme') {
    if (isFirefox) {
      browser.theme.getCurrent()
        .then((theme: any) => { sendResponse({ theme }); })
        .catch((error: any) => {
          console.error('[Theater Everywhere] Error fetching theme:', error);
          sendResponse({ theme: null });
        });
      return true;
    } else {
      sendResponse({ theme: null });
    }
  }
  return false;
});

async function migrateLegacyYoutubeExclusion(): Promise<void> {
  const local = await chrome.storage.local.get(LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY);
  if (local[LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY]) return;

  const sync = await chrome.storage.sync.get({ blacklist: [] as string[] });
  const blacklist = Array.isArray(sync.blacklist) ? sync.blacklist : [];
  const migrated = removeLegacyYoutubeExclusion(blacklist);
  if (migrated.length !== blacklist.length) {
    await chrome.storage.sync.set({ blacklist: migrated });
  }
  await chrome.storage.local.set({ [LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY]: true });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    try {
      await highlights.installed(details, () => chrome.runtime.openOptionsPage());
    } catch (err) {
      console.error('[Theater Everywhere] Error updating feature highlights:', err);
    }
  }
  if (details.reason === 'update') {
    try {
      await migrateLegacyYoutubeExclusion();
    } catch (err) {
      console.error('[Theater Everywhere] Error migrating legacy YouTube exclusion:', err);
    }

    return;
  }

  if (details.reason === 'install') {
    try {
      const data = await chrome.storage.sync.get(['shortcuts', 'blacklist']);
      if (!data.shortcuts) {
        await chrome.storage.sync.set({
          shortcuts: {
            toggle: 'T',
            exit: 'Escape',
            seekBack: 'ArrowLeft',
            seekForward: 'ArrowRight',
          },
        });
      }
      if (!data.blacklist) {
        await chrome.storage.sync.set({ blacklist: [] });
      }
    } catch (err) {
      console.error('[Theater Everywhere] Error initializing defaults:', err);
    }
  }
});
