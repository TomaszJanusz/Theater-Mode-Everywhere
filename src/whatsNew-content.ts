import { compareGenerations, type Generation } from './update-notice';

type InlineText = string | { readonly strong: string } | { readonly link: string; readonly href: string };
type AnnouncementContent = {
  /** The major.minor release that introduced these highlights. */
  readonly generation: Generation;
  readonly heading: string;
  readonly paragraph: readonly InlineText[];
  readonly items: readonly (readonly InlineText[])[];
  readonly thanks?: readonly InlineText[];
};

const RELEASE_2_0: AnnouncementContent = {
  generation: '2.0',
  heading: 'Here is Theater Mode Everywhere 2.0!',
  paragraph: ["I'm delighted to announce that this is the ", { strong: 'biggest update' }, ' of this extension so far. The new version brings a more comfortable theater mode, new controls, more supported services within Rich Theater Experience, and performance improvements.'],
  items: [
    [{ strong: 'New services in Rich Theater Experience' }, ': Support for the unique features of Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix 🥳'],
    [{ strong: 'RTE chat support' }, ': Using Theater Mode Everywhere no longer means saying goodbye to the YouTube and Twitch chats. You can show them beside the video or below it, and slide the chat panel out or hide it.'],
    [{ strong: 'Captions under the video:' }, ' The picture is raised by default while subtitles are on; you can switch to a centered picture or raise it always. In a raised layout the video moves to the top and TME tries to use the space below it to display captions.'],
    [{ strong: 'Pin controls' }, ': Keep the controls docked flush to the player edges, go to the previous or next video, and check the title in the player.'],
    [{ strong: 'Rich Theater Experience' }, ': Support for skip buttons, playing the next episodes and skipping ads on YouTube, Vimeo, Netflix, Disney+, Bilibili, Bilibili.tv, Tencent Video / WeTV and Crunchyroll;'],
    [{ strong: 'Rich Theater Experience' }, ': You can turn RTE on or off for individual services in Settings → Features, where each service tile lights up in its brand colors, and filter services by capability, including playlists. Playlist and queue navigation is available on YouTube, Vimeo Showcase, Netflix, Disney+, Bilibili, Bilibili.tv and Tencent Video / WeTV when the host provides it.'],
    [{ strong: 'Audio effects:' }, ' Adjust dialogue, loud sounds, bass (from Less to MOAAARR!, with a subwoofer that turns red at the top levels) and volume in the player settings, or scroll over the speaker or volume slider. Available for all content that is not protected by DRM.'],
    [{ strong: 'SponsorBlock support:' }, ' See markers from your installed SponsorBlock extension on the YouTube theater timeline, in its own colors, while keeping its notices visible.'],
    [{ strong: 'Automatic theater mode:' }, ' A corner notice counts down the seconds before the entry; click it or press Esc to cancel, or turn the countdown off in Settings → Features. Now also on Bilibili, Bilibili.tv and Patreon posts with a single native video.'],
    [{ strong: 'Video launcher:' }, ' Off by default; turn it on in Settings → Features → Video launcher to enter theater mode with a small button on the left edge of a paused video. It hides during playback, except for the first five seconds after a page or in-app navigation loads. Its tooltip shows your theater shortcut, such as [T]. With YouTube Rich Theater Experience, a white rhombus with an accent triangle stays in the player toolbar regardless of playback or pointer activity. When you turn AutoTheater off, TME offers to enable it.'],
    [{ strong: 'Fullscreen in theater mode:' }, ' Double-click the picture to enter or leave fullscreen without leaving theater mode. A single click now plays or pauses faster, and a quick double-click never pauses the video.'],
    [{ strong: 'Accessibility:' }, ' Choose High contrast, Reduce transparency and Reduce motion separately (Auto, On or Off) in Settings → Appearance; Auto follows your system preferences. Settings and the player also work better with screen readers.'],
    ['Settings warn you about conflicting keyboard shortcuts.'],
    ['The titles of the videos being played are displayed.'],
    ['You can go to the home page of the service the video is playing on.'],
    ['Theater Mode Everywhere should now use fewer resources.'],
    ['The player now has a dedicated settings menu, and the subtitles menu lets you search long track lists.'],
    ['A clearer layout of the extension\'s settings page; a new "About" page has been added, with the privacy policy you can read inside the extension.'],
    ['You can change the language, and the translations have been improved; spotted a mistake? Use Report a translation issue next to Language in Settings.'],
    ['And many smaller visual refinements, behavior fixes and reliability improvements throughout the extension.']
  ],
  thanks: [
    'Big thanks to ', { link: '@liango2', href: 'https://github.com/liango2' },
    ' for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.'
  ]
};

const RELEASE_2_1: AnnouncementContent = {
  generation: '2.1',
  heading: 'Here is Theater Mode Everywhere 2.1!',
  paragraph: ["I'm happy to share an update that makes ", { strong: 'the end of a video' }, ' feel finished, lets you tune each service on its own, and brings theater mode to a few more places.'],
  items: [
    [{ strong: 'A proper ending' }, ': When a video ends, a calm black screen with Replay (and Next, when a playlist has one) now replaces the frozen last frame. Services with their own next-episode step, such as Netflix and Disney+, keep theirs.'],
    [{ strong: 'YouTube recommendations' }, ': With Rich Theater Experience, the end of a YouTube video shows up to three suggestions you can pick without leaving theater mode, and YouTube\'s autoplay countdown appears right in our player, with Cancel. Not your thing? Turn off the Show recommendations switch under them.'],
    [{ strong: 'Settings for each service' }, ': Service cards in Settings → Features have a new Settings button, where you can switch YouTube recommendations on or off and choose AutoTheater for that service alone.'],
    [{ strong: 'A quick setup' }, ': A fresh install now walks you through a short setup: services, how theater mode starts, your language, the look and layout, and a few extras. Changed your mind later? Settings → About has Run setup again, and Reset to defaults for a clean start.'],
    [{ strong: 'New services in Rich Theater Experience' }, ': SOOP, iQIYI and Rakuten Viki, with episode navigation, subtitle and audio choices and AutoTheater where the service allows it. SOOP\'s own chat joins you beside the video.'],
    [{ strong: 'Audio tracks and subtitle language' }, ': Choose a dub or the original audio from the player settings on Netflix, Disney+ and YouTube, and I will remember your language for that service. While subtitles load, the corner notice already shows which language is coming.'],
    [{ strong: 'Speed keys' }, ': Press < and > to change the speed as you do on YouTube, or hold Seek Forward to play at 2x until you let go.'],
    [{ strong: 'Updates stay out of your way' }, ': A new version no longer opens a tab. A NEW badge on the toolbar icon, a note in the popup and a line at the bottom of the player menu lead you here instead; open any of them and the badge goes away.'],
    [{ strong: 'Smoother theater' }, ': Theater opens and closes with less of a freeze on large pages such as YouTube, and it no longer ends when a site briefly hides its player while switching videos.'],
    [{ strong: 'Fixes you may have noticed' }, ': AutoTheater now starts on Vimeo videos and when you expand YouTube\'s miniplayer, Disney+ subtitles keep following the dialogue after the audio track changes, Twitch chat no longer cuts off messages, and letter shortcuts work on Cyrillic, Greek, Hebrew and other non-Latin keyboards.'],
    [{ strong: 'New languages' }, ': 🇬🇧 English (UK), 🇨🇿 Čeština and 🇸🇰 Slovenčina are now in the language list in Settings.'],
    ['And a few smaller things: drag the edge of the chat to resize it, move around the player bar with W, A, S and D, theater on YouTube\'s miniplayer, and clearer keyboard shortcut names and help.']
  ],
  thanks: [
    'Big thanks to ', { link: '@wesleyel', href: 'https://github.com/wesleyel' },
    ' for the groundwork behind the playback speed keys and holding Seek Forward for 2x.'
  ]
};

/**
 * Every release's highlights, newest first. Release copy is deliberately English-only, independent of the
 * interface language. Add a release's entry at the top when it has highlights to announce.
 */
export const WHATS_NEW_RELEASES: readonly AnnouncementContent[] = [RELEASE_2_1, RELEASE_2_0];

/** Everything released after `since` (the generation last announced), or the latest release when nothing is newer. */
export function releasesSince(since?: Generation, releases = WHATS_NEW_RELEASES): readonly AnnouncementContent[] {
  const newer = since ? releases.filter(release => compareGenerations(release.generation, since) > 0) : [];
  return newer.length ? newer : releases.slice(0, 1);
}

/** Only an absolute https: address becomes a link; anything else keeps its text and loses the link. */
function httpsHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function appendInline(parent: HTMLElement, segments: readonly InlineText[]): void {
  for (const segment of segments) {
    if (typeof segment === 'string') parent.append(document.createTextNode(segment));
    else if ('strong' in segment) {
      const strong = document.createElement('strong');
      strong.textContent = segment.strong;
      parent.append(strong);
    } else {
      const href = httpsHref(segment.href);
      if (!href) {
        parent.append(document.createTextNode(segment.link));
        continue;
      }
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = segment.link;
      parent.append(link);
    }
  }
}

export function buildWhatsNewContent(since?: Generation): HTMLElement {
  const announcement = document.createElement('div');
  announcement.className = 'whats-new-announcement';
  announcement.lang = 'en';
  announcement.dir = 'ltr';
  const root = document.createElement('div');
  root.className = 'whats-new-content';
  root.lang = 'en';
  root.dir = 'ltr';

  const thanks = document.createElement('p');
  thanks.className = 'whats-new-thanks';
  // The modal may place this note outside the announcement's scrolling content.
  thanks.lang = 'en';
  thanks.dir = 'ltr';
  for (const release of releasesSince(since)) {
    const heading = document.createElement('h3');
    heading.className = 'whats-new-lead';
    appendInline(heading, [{ strong: release.heading }]);
    const paragraph = document.createElement('p');
    appendInline(paragraph, release.paragraph);
    const list = document.createElement('ul');
    list.className = 'whats-new-list';
    for (const segments of release.items) {
      const item = document.createElement('li');
      appendInline(item, segments);
      list.append(item);
    }
    root.append(heading, paragraph, list);
    if (!release.thanks) continue;
    if (thanks.childNodes.length) thanks.append(document.createElement('br'));
    const emphasis = document.createElement('em');
    appendInline(emphasis, release.thanks);
    thanks.append(emphasis);
  }
  announcement.append(root);
  if (thanks.childNodes.length) announcement.append(thanks);
  return announcement;
}
