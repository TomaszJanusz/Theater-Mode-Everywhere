import { CHAT_COLUMN_SELECTOR, CHAT_SECTION_SELECTOR, CHAT_TOGGLE_SELECTOR } from '../../src/providers/twitch/chat-routes';
import { MINIPLAYER_SURFACE } from '../../src/providers/video-candidates';
import { YOUTUBE_AUTOPLAY_TOGGLE, YOUTUBE_PLAYER_SELECTOR } from '../../src/providers/youtube/launcher-placement';

import type { FixtureService } from './format';
import type { InspectOptions } from './page-inspect';
import type { SanitizeContext } from './sanitize';

/**
 * What to record from one page type. Probes are the selectors the provider itself relies on
 * (imported from the provider where it exports them); they define both what the fragment keeps
 * and what the nightly drift check compares.
 */
export interface FixtureRecipe extends Omit<InspectOptions, 'attributes'>, Omit<SanitizeContext, 'identifying'> {
  id: string;
  service: FixtureService;
  /** The page and session, for the capture metadata. Generic: never a channel, title or URL. */
  page: string;
  viewport: { width: number; height: number };
  /** Present once the host has rendered what the probes describe. */
  ready: string;
  /** Host words in URLs and titles that identify nothing (routes, the service's name). */
  publicWords: readonly string[];
  /** Page expression for the host's build id, if it exposes one. */
  hostVersion?: string;
  /** One user-like click before recording, and the selector that confirms it took effect. */
  prepare?: { click: string; until: string };
  /**
   * The `LIVE_E2E_TARGETS` page type whose public page the nightly drift check compares with
   * this recording. The target list is private; without a matching entry the check is skipped.
   */
  pageType: string;
}

const twitchChat = {
  service: 'twitch',
  viewport: { width: 1600, height: 900 },
  ready: CHAT_SECTION_SELECTOR,
  probes: {
    column: CHAT_COLUMN_SELECTOR,
    shell: '.chat-shell',
    section: CHAT_SECTION_SELECTOR,
    toggle: CHAT_TOGGLE_SELECTOR,
    video: 'video'
  },
  keepDepth: 1,
  maxChildren: 4,
  labels: ['Collapse Chat', 'Expand Chat'],
  opaque: [],
  publicWords: ['twitch', 'videos', 'directory'],
  hostVersion: 'window.__twilightBuildID',
  pageType: 'live-chat'
} as const satisfies Partial<FixtureRecipe>;

export const RECIPES: Record<string, FixtureRecipe> = {
  // The expanded-chat visibility regression: the column and its wrapper are zero-width and the
  // visible 340 px shell is a translated descendant.
  'twitch-chat-expanded': {
    ...twitchChat,
    id: 'twitch-chat-expanded',
    page: 'public live channel page, logged out, chat expanded (host default), before theater entry'
  },
  // After the viewer collapses it: the column loses its data-a-target and hides the shell's wrapper.
  'twitch-chat-collapsed': {
    ...twitchChat,
    id: 'twitch-chat-collapsed',
    page: 'public live channel page, logged out, chat collapsed with the native toggle, before theater entry',
    prepare: { click: CHAT_TOGGLE_SELECTOR, until: '.right-column--collapsed' }
  },
  // The launcher's native slot (before the autoplay toggle) and the caption track list.
  'youtube-watch-player': {
    id: 'youtube-watch-player',
    service: 'youtube',
    page: 'public watch page of a captioned video, logged out, before theater entry',
    viewport: { width: 1600, height: 900 },
    // The watch component stamps its video id after the player's controls exist.
    ready: `ytd-watch-flexy[video-id] ${YOUTUBE_AUTOPLAY_TOGGLE}`,
    probes: {
      flexy: 'ytd-watch-flexy[video-id]',
      player: YOUTUBE_PLAYER_SELECTOR,
      video: `${YOUTUBE_PLAYER_SELECTOR} video`,
      rightControls: '.ytp-right-controls',
      autoplay: YOUTUBE_AUTOPLAY_TOGGLE
    },
    keepDepth: 1,
    maxChildren: 3,
    labels: [],
    opaque: ['video-id'],
    publicWords: ['youtube', 'watch'],
    hostVersion: "window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION')",
    pageType: 'watch-captions'
  },
  // Theater on the miniplayer (TME-129): the playing player parked in the miniplayer after the
  // viewer leaves the watch page for Home, with the watch page still in the DOM, hidden.
  'youtube-miniplayer': {
    id: 'youtube-miniplayer',
    service: 'youtube',
    page: 'public watch page, logged out, then Home through the masthead logo; miniplayer showing, before theater entry',
    viewport: { width: 1600, height: 900 },
    ready: `ytd-watch-flexy[video-id] ${YOUTUBE_AUTOPLAY_TOGGLE}`,
    prepare: { click: 'ytd-masthead a#logo', until: `${MINIPLAYER_SURFACE} ${YOUTUBE_PLAYER_SELECTOR} video` },
    probes: {
      surface: MINIPLAYER_SURFACE,
      player: `ytd-miniplayer ${YOUTUBE_PLAYER_SELECTOR}`,
      video: `ytd-miniplayer ${YOUTUBE_PLAYER_SELECTOR} video`,
      hiddenWatch: 'ytd-watch-flexy[hidden]',
      autoplay: `ytd-miniplayer ${YOUTUBE_AUTOPLAY_TOGGLE}`
    },
    keepDepth: 1,
    maxChildren: 3,
    labels: [],
    opaque: ['video-id', 'miniplayer-is-active'],
    publicWords: ['youtube', 'watch'],
    hostVersion: "window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION')",
    pageType: 'watch-captions'
  }
};

export function recipeFor(id: string): FixtureRecipe {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`unknown recipe ${id}; known: ${Object.keys(RECIPES).join(', ')}`);
  return recipe;
}
