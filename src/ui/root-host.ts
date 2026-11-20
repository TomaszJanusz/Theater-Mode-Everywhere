/**
 * The player UI host as both script worlds see it. The MAIN-world bundle reads the isolated world's shadow root
 * through this module only: `./root` brings the language runtime and appearance observers that MAIN never uses.
 */
export const PLAYER_UI_HOST_ID = 'theater-everywhere-ui';

// Both script worlds must leave native button activation to the focused UI control.
export const UI_ACTIVATION_SELECTOR = '.theater-menu, .theater-service-action-host, '
  + '.theater-time-end, .theater-controls-row button, .theater-ended-curtain, .te-dialog-overlay';

export function findPlayerUiRoot(): ShadowRoot | null {
  return document.getElementById(PLAYER_UI_HOST_ID)?.shadowRoot || null;
}
