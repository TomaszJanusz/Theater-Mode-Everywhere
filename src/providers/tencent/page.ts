import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { MAX_CAPTION_BYTES } from '../../platform/bounded-body';

import { isTencentHost } from './hosts';
import { tencentRecord } from './metadata';

export function tencentEnabled(): boolean {
  return isTencentHost() && mediaProviderIntegrationEnabled('tencent');
}

export function wetvPageInfo(): Record<string, unknown> {
  try {
    const next = tencentRecord((window as any).__NEXT_DATA__);
    const data = tencentRecord(tencentRecord(next.props).pageProps).data;
    const parsed = typeof data === 'string' && data.length <= MAX_CAPTION_BYTES ? JSON.parse(data) : data;
    return tencentRecord(tencentRecord(parsed).videoInfo);
  } catch { return {}; }
}

export function tencentPageVideoId(): string | null {
  const path = window.location.pathname || '';
  const pathId = path.match(/\/([a-z0-9]{11})\.html$/i)?.[1]
    || path.match(/\/play\/[^/]+\/([a-z0-9]{11})(?:-|\/|$)/i)?.[1];
  const queryId = new URLSearchParams(window.location.search || '').get('vid');
  const info = tencentRecord((window as any).VIDEO_INFO);
  const value = pathId || queryId || info.vid || wetvPageInfo().vid;
  return typeof value === 'string' && /^[a-z0-9]{11}$/i.test(value) ? value : null;
}
