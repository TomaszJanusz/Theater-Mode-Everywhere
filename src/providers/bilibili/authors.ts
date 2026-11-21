import { sanitizeContentTitle, type ContentAuthor } from '../../media-features/content-title';

/** Bilibili's channel avatars; the byline admits no other image host. */
export const BILIBILI_AVATAR_HOSTS = ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com'];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const mid = (value: unknown): string | null => {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id) ? id : null;
};
/** Bilibili's verification: -1 none, 0 a person, 1 an organisation. */
const verified = (official: unknown) => {
  const type = record(official).type;
  return typeof type === 'number' && type >= 0;
};

/** The face at the card's 2x size (Bilibili's image service resizes on the path); protocol-relative and http become https. */
function face(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  const url = value.replace(/^(?:https?:)?\/\//, 'https://');
  return /^https:\/\/i\d\.hdslb\.com\/bfs\/[\w./-]+\.(?:jpe?g|png|gif|webp)$/i.test(url) ? `${url}@96w_96h_1c.webp` : null;
}

function author(id: string | null, name: unknown, avatar: unknown, official: unknown): ContentAuthor[] {
  const text = sanitizeContentTitle(name);
  return id && text
    ? [{ id, name: text.slice(0, 80), url: `https://space.bilibili.com/${id}`, avatarUrl: face(avatar), verified: verified(official), stat: null }]
    : [];
}

/**
 * Who published the video `__INITIAL_STATE__` describes, read in MAIN with its title: the joint upload's `staff[]`
 * (the creator first, as Bilibili lists them) or the single `owner`, whose verification is on `upData` when it names
 * the same account. Licensed pages (`epInfo`, no `videoData`) name a licensing account, not an author, so nothing.
 */
export function readBilibiliAuthors(state: unknown, aid: number): ContentAuthor[] {
  const data = record(state);
  const video = record(data.videoData);
  if (Number(video.aid) !== aid) return [];
  const staff = Array.isArray(video.staff) ? video.staff.slice(0, 16).map(record) : [];
  if (staff.length) return staff.flatMap(row => author(mid(row.mid), row.name, row.face, row.official));
  const owner = record(video.owner);
  const up = record(data.upData);
  const id = mid(owner.mid);
  return author(id, owner.name, owner.face, id && mid(up.mid) === id ? up.Official : null);
}

/** The authors as they crossed from MAIN; a malformed entry is dropped alone, and the byline checks hosts again. */
export function parseBilibiliAuthors(value: unknown): ContentAuthor[] {
  return (Array.isArray(value) ? value.slice(0, 16) : []).flatMap(raw => {
    const row = record(raw);
    const optional = (field: unknown) => typeof field === 'string' && field.length <= 2000 ? field : null;
    return mid(row.id) && typeof row.name === 'string' && row.name.length <= 80 && row.name
      ? [{ id: row.id as string, name: row.name, url: optional(row.url), avatarUrl: optional(row.avatarUrl), verified: row.verified === true, stat: null }]
      : [];
  });
}
