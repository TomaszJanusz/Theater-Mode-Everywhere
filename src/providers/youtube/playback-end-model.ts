/** Class state survives a post-roll emptying the content element. Live/loop/ad surfaces never end content here. */
export function youtubeContentEnded(classes: string, loop: boolean, duration: number): boolean {
  const flags = new Set(classes.split(/\s+/));
  return !loop && duration !== Infinity && flags.has('ended-mode')
    && !['ad-showing', 'ad-interrupting', 'ytp-live', 'ytp-live-dvr'].some(flag => flags.has(flag));
}
