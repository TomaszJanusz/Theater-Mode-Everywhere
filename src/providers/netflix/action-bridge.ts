export const NETFLIX_ACTION_SNAPSHOT_ID = 'theater-everywhere-netflix-timed-action';
export const NETFLIX_ACTION_EVENT = 'theater-everywhere-netflix-action';
export const NETFLIX_ACTION_ACK_EVENT = 'theater-everywhere-netflix-action-ack';
const ACTION_ID = /^intro:\d{1,12}:\d{1,9}:\d{1,9}$/;

export function validNetflixTimedActionId(id: unknown): id is string {
  return typeof id === 'string' && ACTION_ID.test(id);
}

export function readNetflixTimedAction(doc: Document, videoId: string): { id: string; label: string } | null {
  const text = doc.getElementById(NETFLIX_ACTION_SNAPSHOT_ID)?.textContent;
  if (!text || text.length > 400) return null;
  try {
    const data = JSON.parse(text);
    if (!validNetflixTimedActionId(data.id) || data.id.split(':')[1] !== videoId) return null;
    if (typeof data.label !== 'string' || !data.label.trim() || data.label.length > 80) return null;
    const age = Date.now() - data.updatedAt;
    if (!Number.isFinite(age) || age < 0 || age > 4000) return null;
    return { id: data.id, label: data.label };
  } catch { return null; }
}

/** Synchronous string-only acknowledgement works across extension worlds. */
export function requestNetflixTimedAction(id: string): boolean {
  if (!validNetflixTimedActionId(id)) return false;
  let ok = false;
  const ack = (event: Event) => { if ((event as CustomEvent).detail === `ok:${id}`) ok = true; };
  window.addEventListener(NETFLIX_ACTION_ACK_EVENT, ack);
  try { window.dispatchEvent(new CustomEvent(NETFLIX_ACTION_EVENT, { detail: id })); }
  finally { window.removeEventListener(NETFLIX_ACTION_ACK_EVENT, ack); }
  return ok;
}
