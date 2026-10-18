/** Only the manifest options page may be opened; callers cannot supply a URL or hash. */
export function isOpenOptionsRequest(value: unknown): value is { action: 'open-options-page' } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1
    && 'action' in value && value.action === 'open-options-page';
}
