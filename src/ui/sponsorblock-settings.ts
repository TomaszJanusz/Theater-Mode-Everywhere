export const SPONSORBLOCK_STORAGE_KEY = 'sponsorBlockMarkers';
export function resolveSponsorBlockMarkers(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}
