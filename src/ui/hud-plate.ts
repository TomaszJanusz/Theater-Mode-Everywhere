/** The surface every HUD plate shares (shadow.css), so appearance settings paint them alike. */
export const HUD_PLATE_CLASS = 'theater-hud-plate';
/** How long the leaving fade runs before the node is removed; shadow.css transitions opacity over the same 0.2s. */
export const HUD_FADE_OUT_MS = 200;
/** The round buffering plate. It shares its centre, size and surface with the play/pause plate (shadow.css). */
export const LOADING_PLATE_CLASS = 'theater-loading-indicator';

/** The buffering plate, empty and hidden; `visible` shows it once it holds its ring. */
export function createLoadingPlate(): HTMLElement {
  const plate = document.createElement('div');
  plate.className = `${LOADING_PLATE_CLASS} ${HUD_PLATE_CLASS}`;
  return plate;
}

/** Puts the turning ring in the plate the first time it is needed. */
export function ensureLoadingRing(plate: HTMLElement): void {
  if (plate.firstElementChild) return;
  const ring = document.createElement('div');
  ring.className = 'theater-loading-spinner';
  ring.setAttribute('aria-hidden', 'true');
  plate.appendChild(ring);
}
