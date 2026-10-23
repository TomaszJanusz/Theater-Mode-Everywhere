import twitchChatCollapsed from '../../test/host-fixtures/twitch-chat-collapsed.json';
import twitchChatExpanded from '../../test/host-fixtures/twitch-chat-expanded.json';
import youtubeWatchPlayer from '../../test/host-fixtures/youtube-watch-player.json';

import { parseHostFixture, type HostFixture } from './format';

/** Every committed recording. A new capture is added here, so the policy test and the nightly drift check cover it. */
export const COMMITTED_FIXTURES: readonly HostFixture[] = [twitchChatExpanded, twitchChatCollapsed, youtubeWatchPlayer].map(parseHostFixture);

export function committedFixture(id: string): HostFixture {
  const fixture = COMMITTED_FIXTURES.find(candidate => candidate.id === id);
  if (!fixture) throw new Error(`no committed host fixture ${id}`);
  return fixture;
}
