import { describe, expect, test } from 'vitest';

import { readTwitchChannelHeader, twitchHeaderChannel } from './channel-header';

/** The channel header's shape as read live on 2026-11-20 (a live channel and a VOD share it); class hashes dropped. */
function header(login: string, name: string, options: { badge?: boolean; avatar?: string; title?: string } = {}): HTMLElement {
  const root = document.createElement('div');
  const info = document.createElement('section');
  info.className = 'channel-info-content';
  const avatar = document.createElement('img');
  avatar.className = 'tw-image-avatar';
  avatar.src = options.avatar ?? `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-70x70.png`;
  const row = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', `/${login}`);
  const heading = document.createElement('h1');
  heading.className = 'tw-title';
  heading.textContent = name;
  link.append(heading);
  row.append(link);
  if (options.badge) {
    const badge = document.createElement('div');
    badge.className = 'tw-svg';
    badge.innerHTML = '<svg aria-label="Zweryfikowany partner" viewBox="0 0 16 16"></svg>';
    row.append(badge);
  }
  info.append(avatar, row);
  if (options.title !== undefined) {
    const title = document.createElement('p');
    title.dataset.aTarget = 'stream-title';
    title.textContent = options.title;
    info.append(title);
  }
  root.append(info);
  return root;
}

describe('Twitch channel header', () => {
  test('reads the display name, avatar and partner badge of the channel it is asked for', () => {
    expect(readTwitchChannelHeader('blastpremier', header('blastpremier', 'BLASTPremier', { badge: true, title: '  Grand  final ' }))).toEqual({
      name: 'BLASTPremier', verified: true, avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/blastpremier-profile_image-70x70.png',
      title: 'Grand final'
    });
    expect(readTwitchChannelHeader('blastpremier', header('blastpremier', 'BLASTPremier'))?.title).toBeNull();
    expect(readTwitchChannelHeader('quiet_harbor', header('Quiet_Harbor', 'QuietHarbor'))?.verified).toBe(false);
  });

  test('ignores a header that still shows another channel after in-app navigation', () => {
    expect(readTwitchChannelHeader('bottlewright', header('quiet_harbor', 'QuietHarbor'))).toBeNull();
    expect(readTwitchChannelHeader('videos', header('videos', 'Videos'))).toBeNull();
    expect(readTwitchChannelHeader('blastpremier', document.createElement('div'))).toBeNull();
    expect(twitchHeaderChannel(header('Quiet_Harbor', 'QuietHarbor'))).toBe('quiet_harbor');
    expect(twitchHeaderChannel(document.createElement('div'))).toBeNull();
  });
});
