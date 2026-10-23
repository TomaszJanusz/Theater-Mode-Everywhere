import { TWITCH_CHAT_COLUMN_SELECTOR, TWITCH_CHAT_SECTION_SELECTOR } from '../../src/chat/selectors';

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
}

const TWITCH_TOGGLE = '[data-a-target="right-column__toggle-collapse-btn"]';

const twitchChat = {
  service: 'twitch',
  viewport: { width: 1600, height: 900 },
  ready: TWITCH_CHAT_SECTION_SELECTOR,
  probes: {
    column: TWITCH_CHAT_COLUMN_SELECTOR,
    shell: '.chat-shell',
    section: TWITCH_CHAT_SECTION_SELECTOR,
    toggle: TWITCH_TOGGLE,
    video: 'video'
  },
  keepDepth: 1,
  maxChildren: 4,
  labels: ['Collapse Chat', 'Expand Chat'],
  opaque: [],
  publicWords: ['twitch', 'videos', 'directory'],
  hostVersion: 'window.__twilightBuildID'
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
    prepare: { click: TWITCH_TOGGLE, until: '.right-column--collapsed' }
  }
};

export function recipeFor(id: string): FixtureRecipe {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`unknown recipe ${id}; known: ${Object.keys(RECIPES).join(', ')}`);
  return recipe;
}
