import type { PlayerChromeContext } from './runtime-context';

export type ButtonTooltipPlace = 'above' | 'below';

type TooltipPreview = { title: string; imageUrl: string };

export type ButtonTooltipBinder = (
  target: HTMLElement,
  getTooltipText: () => string,
  getPreview?: () => TooltipPreview | null,
  place?: ButtonTooltipPlace
) => void;

/** One shared control tooltip. A target at the top of the frame places it below. */
export function createButtonTooltip(ctx: PlayerChromeContext): { bind: ButtonTooltipBinder } {
  let element: HTMLDivElement | null = null;

  const hide = () => {
    if (!element) return;
    element.classList.remove('visible');
    ctx.actions.updateCaptionDock();
  };

  const bind: ButtonTooltipBinder = (target, getTooltipText, getPreview, place = 'above') => {
    target.removeAttribute('title');

    const show = () => {
      if (target.closest('.theater-menu')) return;
      if (!element?.isConnected) {
        element = document.createElement('div');
        element.className = 'theater-button-tooltip theater-backdrop-plate';
        ctx.paintOverlay(element);
        ctx.mountPlayerUi(element);
      }

      const preview = getPreview?.() ?? null;
      element.classList.toggle('theater-playlist-preview', Boolean(preview));
      element.classList.toggle('is-below', place === 'below');
      if (preview) {
        element.replaceChildren();
        const image = document.createElement('img');
        image.className = 'theater-playlist-preview-image';
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.src = preview.imageUrl;
        image.addEventListener('error', () => image.remove(), { once: true });
        const title = document.createElement('div');
        title.className = 'theater-playlist-preview-title';
        title.textContent = preview.title;
        const action = document.createElement('div');
        action.className = 'theater-playlist-preview-action';
        const actionLabel = document.createElement('span');
        actionLabel.className = 'theater-playlist-preview-action-label';
        const actionKeys = document.createElement('span');
        actionKeys.className = 'theater-playlist-preview-keys';
        actionKeys.dir = 'ltr';
        const shortcutText = getTooltipText();
        const shortcutKeysAt = shortcutText.indexOf('<kbd>');
        actionLabel.textContent = (shortcutKeysAt === -1 ? shortcutText : shortcutText.slice(0, shortcutKeysAt)).trim();
        if (shortcutKeysAt !== -1) ctx.actions.setTooltipContent(actionKeys, shortcutText.slice(shortcutKeysAt));
        action.append(actionLabel, actionKeys);
        element.append(image, title, action);
      } else {
        ctx.actions.setTooltipContent(element, getTooltipText());
      }
      element.classList.add('visible');

      const rect = target.getBoundingClientRect();
      const tooltipWidth = element.offsetWidth;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      let tooltipX = rect.left + rect.width / 2;
      const padding = 12;
      const minX = tooltipWidth / 2 + padding;
      const maxX = viewportWidth - (tooltipWidth / 2 + padding);
      if (tooltipX < minX) tooltipX = minX;
      else if (tooltipX > maxX) tooltipX = maxX;

      element.style.left = `${tooltipX}px`;
      element.style.top = `${place === 'below' ? rect.bottom + 8 : rect.top - 8}px`;
      ctx.actions.updateCaptionDock();
    };

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    target.addEventListener('click', hide);
  };

  return { bind };
}
