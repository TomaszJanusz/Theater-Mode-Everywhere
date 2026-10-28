/** The player marks `#webplayer` with `chat_open` while its chat panel is shown. */
export function readSoopChatVisibility(root: HTMLElement): boolean | null {
  const player = root.ownerDocument.getElementById('webplayer');
  return player ? player.classList.contains('chat_open') : null;
}
