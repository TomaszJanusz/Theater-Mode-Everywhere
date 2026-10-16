type InlineText = string | { readonly strong: string };
type AnnouncementContent = {
  readonly heading: string;
  readonly paragraph: readonly InlineText[];
  readonly items: readonly (readonly InlineText[])[];
  readonly thanks: string;
};

// Release copy is deliberately English-only, independent of the interface language.
export const WHATS_NEW_CONTENT: AnnouncementContent = {
  heading: 'Here is Theater Mode Everywhere 2.0!',
  paragraph: ["I'm delighted to announce that this is the ", { strong: 'biggest update' }, ' of this extension so far. The new version brings a more comfortable theater mode, new controls, more supported services within Rich Theater Experience, and performance improvements.'],
  items: [
    [{ strong: 'New services in Rich Theater Experience' }, ': Support for the unique features of Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix 🥳'],
    [{ strong: 'RTE chat support' }, ': Using Theater Mode Everywhere no longer means saying goodbye to the YouTube and Twitch chats. You can show them beside the video or below it, and slide the chat panel out or hide it.'],
    [{ strong: 'Captions under the video:' }, ' Choose a centered or raised picture. If you choose the latter, the video moves to the top and TME tries to use the space below it to display captions.'],
    [{ strong: 'Pinnable TME bar' }, ': Keep the controls visible, go to the previous or next video, and check the title in the player.'],
    [{ strong: 'Rich Theater Experience' }, ': Support for skip buttons, playing the next episodes and skipping ads on YouTube, Vimeo, Netflix, Disney+, Bilibili, Bilibili.tv, Tencent Video / WeTV and Crunchyroll;'],
    [{ strong: 'Rich Theater Experience' }, ': You can turn RTE on or off for individual sites and filter services by capability, including playlists. Playlist and queue navigation is available on YouTube, Vimeo Showcase, Netflix, Disney+, Bilibili, Bilibili.tv and Tencent Video / WeTV when the host provides it.'],
    [{ strong: 'Audio effects:' }, ' Adjust dialogue, loud sounds, bass and volume in the player settings. Available for all content that is not protected by DRM.'],
    [{ strong: 'SponsorBlock support:' }, ' See markers from your installed SponsorBlock extension on the YouTube theater timeline, in its own colors, while keeping its notices visible.'],
    [{ strong: 'Automatic theater mode:' }, ' A corner notice counts down the seconds before the entry; click it or press Esc to cancel, or turn the countdown off in Settings → Features.'],
    [{ strong: 'Video launcher:' }, ' Off by default; turn it on in Settings → Features → Video launcher to enter theater mode with a small button near a paused video. It avoids page and native controls and hides during playback, except for the first five seconds after a page or in-app navigation loads. Its tooltip shows your theater shortcut, such as [T]. With YouTube Rich Theater Experience, a white rhombus with an accent triangle stays in the player toolbar regardless of playback or pointer activity. When you turn AutoTheater off, TME offers to enable it.'],
    [{ strong: 'Fullscreen in theater mode:' }, ' Double-click the picture to enter or leave fullscreen without leaving theater mode.'],
    [{ strong: 'Accessibility:' }, ' Theater Mode Everywhere respects your system preferences for increased contrast, reduced transparency and reduced motion.'],
    ['The titles of the videos being played are displayed.'],
    ['You can go to the home page of the service the video is playing on.'],
    ['Theater Mode Everywhere should now use fewer resources.'],
    ['The player now has a dedicated settings menu.'],
    ['A clearer layout of the extension\'s settings page; a new "About" page has been added.'],
    ['You can change the language, and the translations have been improved.']
  ],
  thanks: 'Big thanks to liango2 for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.'
};

function appendInline(parent: HTMLElement, segments: readonly InlineText[]): void {
  for (const segment of segments) {
    if (typeof segment === 'string') parent.append(document.createTextNode(segment));
    else {
      const strong = document.createElement('strong');
      strong.textContent = segment.strong;
      parent.append(strong);
    }
  }
}

export function buildWhatsNewContent(): HTMLElement {
  const announcement = document.createElement('div');
  announcement.className = 'whats-new-announcement';
  announcement.lang = 'en';
  announcement.dir = 'ltr';
  const root = document.createElement('div');
  root.className = 'whats-new-content';
  root.lang = 'en';
  root.dir = 'ltr';

  const heading = document.createElement('h3');
  heading.className = 'whats-new-lead';
  appendInline(heading, [{ strong: WHATS_NEW_CONTENT.heading }]);
  const paragraph = document.createElement('p');
  appendInline(paragraph, WHATS_NEW_CONTENT.paragraph);
  const list = document.createElement('ul');
  list.className = 'whats-new-list';
  for (const segments of WHATS_NEW_CONTENT.items) {
    const item = document.createElement('li');
    appendInline(item, segments);
    list.append(item);
  }
  const thanks = document.createElement('p');
  thanks.className = 'whats-new-thanks';
  // The modal may place this note outside the announcement's scrolling content.
  thanks.lang = 'en';
  thanks.dir = 'ltr';
  const emphasis = document.createElement('em');
  emphasis.textContent = WHATS_NEW_CONTENT.thanks;
  thanks.append(emphasis);
  root.append(heading, paragraph, list);
  announcement.append(root, thanks);
  return announcement;
}
