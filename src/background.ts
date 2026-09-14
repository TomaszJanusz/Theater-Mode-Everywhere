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
    const isBlacklisted = blacklist.some(
      d => hostname === d || hostname.endsWith('.' + d)
    );
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

const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

function isAllowedYoutubeCaptionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostOk = /^(www\.)?youtube\.com$/i.test(parsed.hostname)
      || /^youtu\.be$/i.test(parsed.hostname)
      || /^(www\.)?youtube-nocookie\.com$/i.test(parsed.hostname);
    return hostOk && /timedtext/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAllowedMuxStoryboardUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.replace(/^www\./i, '').toLowerCase() !== 'image.mux.com') return false;
    return /\/[^/]+\/storyboard\.(vtt|json)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAllowedMuxCaptionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.replace(/^www\./i, '').toLowerCase() !== 'stream.mux.com') return false;
    return /\/[^/]+\/text\/[^/]+\.vtt$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAllowedTwitchStoryboardUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const hostOk = host === 'vod-secure.twitch.tv'
      || host === 'vod-storyboards.twitch.tv'
      || host === 'static-cdn.jtvnw.net'
      || /^d[a-z0-9]{6,}\.cloudfront\.net$/i.test(host);
    return hostOk && /\/storyboards\/[^/?#]*info\.json$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAllowedTwitchCaptionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'captions.twitch.tv' && !host.endsWith('.captions.twitch.tv')) return false;
    return /\.vtt$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAllowedDisneyCaptionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'dssott.com' && !host.endsWith('.dssott.com')) return false;
    if (/\.vtt$/i.test(parsed.pathname) || /SUBTITLE_1_WEBVTT/i.test(url)) return true;
    return /\.m3u8$/i.test(parsed.pathname) && (
      /una-ctr-all/i.test(url)
      || /composite_[^/?#]+_(NORMAL|FORCED|SDH)_/i.test(url)
    );
  } catch {
    return false;
  }
}

function isAllowedMediaBrokerUrl(url: string): boolean {
  return isAllowedYoutubeCaptionUrl(url)
    || isAllowedMuxStoryboardUrl(url)
    || isAllowedMuxCaptionUrl(url)
    || isAllowedTwitchStoryboardUrl(url)
    || isAllowedTwitchCaptionUrl(url)
    || isAllowedDisneyCaptionUrl(url);
}

async function fetchAllowlistedCaption(url: string): Promise<{ ok: boolean; body?: string; contentType?: string; error?: string }> {
  if (!isAllowedMediaBrokerUrl(url)) {
    return { ok: false, error: 'blocked' };
  }
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow' });
    if (!isAllowedMediaBrokerUrl(response.url)) {
      return { ok: false, error: 'redirect-blocked' };
    }
    if (!response.ok) return { ok: false, error: `http-${response.status}` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_CAPTION_BYTES) {
      return { ok: false, error: 'too-large' };
    }
    const contentType = response.headers.get('content-type') || '';
    const body = new TextDecoder('utf-8').decode(buffer);
    const looksLikeCaptions = /WEBVTT|#EXTM3U|<transcript|<timedtext|<text |<p\b|"events"\s*:|"tiles"\s*:|"images"\s*:/i.test(body.slice(0, 400));
    if (contentType && !/text|xml|json|vtt|srt|ttml|octet-stream|mpegurl|m3u8/i.test(contentType) && !looksLikeCaptions) {
      return { ok: false, error: 'content-type' };
    }
    return { ok: true, body, contentType };
  } catch {
    return { ok: false, error: 'fetch-failed' };
  }
}

chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message && message.action === 'theater-fetch-media') {
    fetchAllowlistedCaption(String(message.url || '')).then(sendResponse);
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

chrome.runtime.onInstalled.addListener(async (details) => {
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
