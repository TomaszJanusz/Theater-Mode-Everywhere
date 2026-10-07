/** Known host overlay controls, shared by isolated and MAIN world discovery. */
const HOST_PLAY_CLASSES = ['ytp-large-play-button', 'vjs-big-play-button', 'plyr__control--overlaid'] as const;

export const HOST_PLAY_CONTROL_SELECTOR = ['button', '[role="button"]', ...HOST_PLAY_CLASSES.map(name => `.${name}`)].join(', ');

export function isProviderPlayControl(className: string): boolean {
  const classes = className.split(/\s+/);
  return HOST_PLAY_CLASSES.some(name => classes.includes(name));
}
