// Shared by MAIN consumers: an extension read must not re-enter host observers.
const ownedInputs = new WeakSet<object>();
const ownedResponses = new WeakSet<Response>();

export function isOwnedHarvestInput(input: RequestInfo | URL): boolean {
  return typeof input === 'object' && ownedInputs.has(input);
}

export function markOwnedHarvestResponse(response: Response): Response {
  ownedResponses.add(response);
  return response;
}

export function isOwnedHarvestResponse(response: Response): boolean {
  return ownedResponses.has(response);
}

export async function fetchWithoutHarvest(url: string, init?: RequestInit): Promise<Response> {
  // A unique URL object preserves fetch's URL/init arguments without a URL-wide
  // exclusion that could accidentally hide a concurrent host request.
  const input = new URL(url, window.location.href);
  ownedInputs.add(input);
  return markOwnedHarvestResponse(await fetch(input, init));
}
