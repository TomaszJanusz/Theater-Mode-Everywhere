import type { ProviderHarvest } from '../provider-api';

/** ThumbPlayer's getvinfo metadata endpoints; nothing else on the page is read. */
export function isTencentMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['h5vv.video.qq.com', 'h5vv6.video.qq.com', 'play.wetv.vip'].includes(url.hostname)
      && url.pathname === '/getvinfo';
  } catch { return false; }
}

/** getvinfo arrives as JSON, JSONP text or a fetch body; the consumers check the integration flag themselves. */
export function tencentNetworkHarvest(consumers: {
  json(url: string, data: unknown): void;
  text(url: string, body: string): void;
  response(url: string, clone: Response): void;
  enabled(): boolean;
}): ProviderHarvest {
  return {
    qualify: url => consumers.enabled() && isTencentMetadataUrl(url) ? 'tencent' : null,
    json: (_target, url, data) => consumers.json(url, data),
    text: (_target, url, text) => consumers.text(url, text),
    cloneTargets: ['tencent'],
    response: (_target, url, clone) => consumers.response(url, clone)
  };
}
