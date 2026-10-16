import { abandonBody } from './bounded-body';
import { fetchWithoutHarvest } from './harvest-ownership';
import { assertSafeRedirect, classifyMediaFetchUrl } from './media-url-policy';

/** All page-owned media downloads validate the final URL before reading a body. */
export async function fetchPageMedia(url: string, init: RequestInit): Promise<Response | null> {
  const request = classifyMediaFetchUrl(url, window.location.href);
  if (!request) return null;
  const response = await fetchWithoutHarvest(url, init);
  if (!response.ok || !assertSafeRedirect(response.url, request)) {
    abandonBody(response.body);
    return null;
  }
  return response;
}
