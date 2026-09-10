const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

export type MediaFetchRequest = {
  provider: 'youtube';
  kind: 'caption-track';
  url: string;
};

export type MediaFetchResult = {
  ok: boolean;
  body?: string;
  contentType?: string;
  error?: string;
};

function hostnameAllowed(hostname: string, allowed: RegExp[]): boolean {
  return allowed.some((pattern) => pattern.test(hostname));
}

export function isAllowedMediaFetchUrl(request: MediaFetchRequest): boolean {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  if (request.provider === 'youtube' && request.kind === 'caption-track') {
    const hostOk = hostnameAllowed(parsed.hostname, [
      /^(www\.)?youtube\.com$/i,
      /^youtu\.be$/i,
      /^(www\.)?youtube-nocookie\.com$/i
    ]);
    const pathOk = /timedtext/i.test(parsed.pathname) || /\/api\/timedtext/i.test(parsed.pathname);
    return hostOk && pathOk;
  }

  return false;
}

export function assertSafeRedirect(finalUrl: string, request: MediaFetchRequest): boolean {
  return isAllowedMediaFetchUrl({ ...request, url: finalUrl });
}

export { MAX_CAPTION_BYTES };
