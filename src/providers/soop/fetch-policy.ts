import type { MediaFetchRequest } from '../../media-features/fetch-allowlist';

export function allowsSoopMediaFetch(request: MediaFetchRequest, base?: string): boolean {
  let parsed: URL;
  try { parsed = new URL(request.url, base); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (request.provider === 'soop' && request.kind === 'chapters') {
    return !parsed.username && !parsed.password && !parsed.port
      && parsed.hostname === 'stbbs.sooplive.com'
      && parsed.pathname === '/api/chapter/Controllers/ChapterListController.php'
      && [...parsed.searchParams.keys()].sort().join() === 'nTitleNo,szFileType'
      && /^\d{1,12}$/.test(parsed.searchParams.get('nTitleNo') ?? '')
      && /^[A-Z_]{3,12}$/.test(parsed.searchParams.get('szFileType') ?? '');
  }

  return false;
}
