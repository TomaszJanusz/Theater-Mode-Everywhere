export const MEDIA_PROVIDER_IDS = ['youtube', 'vimeo', 'patreon', 'twitch'] as const;

export type MediaProviderId = (typeof MEDIA_PROVIDER_IDS)[number];

export const MEDIA_PROVIDER_FLAG_KEYS: Record<MediaProviderId, string> = {
  youtube: 'youtubeIntegrationEnabled',
  vimeo: 'vimeoIntegrationEnabled',
  patreon: 'patreonIntegrationEnabled',
  twitch: 'twitchIntegrationEnabled'
};

export type MediaProviderFlags = Record<MediaProviderId, boolean>;

const YOUTUBE_ATTR = 'data-te-youtube-integration-off';
const VIMEO_ATTR = 'data-te-vimeo-integration-off';
const PATREON_ATTR = 'data-te-patreon-integration-off';
const TWITCH_ATTR = 'data-te-twitch-integration-off';

export function defaultMediaProviderFlags(): MediaProviderFlags {
  return { youtube: true, vimeo: true, patreon: true, twitch: true };
}

export function resolveMediaProviderFlags(data: Record<string, unknown> | null | undefined): MediaProviderFlags {
  const next = defaultMediaProviderFlags();
  for (const id of MEDIA_PROVIDER_IDS) {
    const value = data?.[MEDIA_PROVIDER_FLAG_KEYS[id]];
    if (value === false) next[id] = false;
    else if (value === true) next[id] = true;
  }
  return next;
}

export function mediaProviderFlagStorageKeys(): string[] {
  return MEDIA_PROVIDER_IDS.map((id) => MEDIA_PROVIDER_FLAG_KEYS[id]);
}

export function mediaProviderFlagsEqual(left: MediaProviderFlags, right: MediaProviderFlags): boolean {
  return MEDIA_PROVIDER_IDS.every((id) => left[id] === right[id]);
}

export function applyMediaProviderFlagAttrs(root: HTMLElement, flags: MediaProviderFlags): void {
  root.toggleAttribute(YOUTUBE_ATTR, !flags.youtube);
  root.toggleAttribute(VIMEO_ATTR, !flags.vimeo);
  root.toggleAttribute(PATREON_ATTR, !flags.patreon);
  root.toggleAttribute(TWITCH_ATTR, !flags.twitch);
}
