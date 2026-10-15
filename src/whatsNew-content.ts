type InlineText = string | { readonly strong: string };
type AnnouncementContent = {
  readonly heading: string;
  readonly paragraph: readonly InlineText[];
  readonly items: readonly (readonly InlineText[])[];
  readonly thanks: string;
};

// Release copy is deliberately English-only, independent of the interface language.
export const WHATS_NEW_CONTENT: AnnouncementContent = {
  heading: 'Here is Theater Mode Everywhere 1.6!',
  paragraph: ["I'm delighted to announce that this is the ", { strong: 'biggest update' }, ' of this extension so far. The new version brings a more comfortable theater mode, new controls, more supported services within Rich Theater Experience, and performance improvements.'],
  items: [
    [{ strong: 'New services in Rich Theater Experience' }, ': Support for the unique features of Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix 🥳'],
    [{ strong: 'RTE chat support' }, ': Using Theater Mode Everywhere no longer means saying goodbye to the YouTube and Twitch chats. You can show them beside the video or below it, and slide the chat panel out or hide it.'],
    [{ strong: 'Captions under the video:' }, ' Choose a centered or raised picture. If you choose the latter, the video moves to the top and TME tries to use the space below it to display captions.'],
    [{ strong: 'Pinnable TME bar' }, ': Keep the controls visible, go to the previous or next video, and check the title in the player.'],
    [{ strong: 'Rich Theater Experience' }, ': Support for skip buttons, playing the next episodes and skipping ads on YouTube, Vimeo, Netflix, Disney+, Bilibili, Bilibili.tv, Tencent Video / WeTV and Crunchyroll;'],
    [{ strong: 'Rich Theater Experience' }, ': You can turn RTE on or off for individual sites.'],
    [{ strong: 'Audio effects:' }, ' Adjust dialogue, loud sounds, bass and volume in the player settings. Available for all content that is not protected by DRM.'],
    ['The titles of the videos being played are displayed.'],
    ['You can go to the home page of the service the video is playing on.'],
    ['Theater Mode Everywhere should now use fewer resources.'],
    ['The player now has a dedicated settings menu.'],
    ['A clearer layout of the extension\'s settings page; a new "About" page has been added.'],
    ['You can change the language, and the translations have been improved.']
  ],
  thanks: 'Thank you to liango2 for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.'
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
  const root = document.createElement('div');
  root.className = 'whats-new-content';
  root.lang = 'en';
  root.dir = 'ltr';
  // Include the scroll area in the modal's keyboard focus loop.
  root.tabIndex = 0;

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
  const emphasis = document.createElement('em');
  emphasis.textContent = WHATS_NEW_CONTENT.thanks;
  thanks.append(emphasis);
  root.append(heading, paragraph, list, thanks);
  return root;
}
