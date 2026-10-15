export type MessageCatalog = Record<string, {
  message: string;
  placeholders?: Record<string, { content: string }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Check the extension resource / runtime-message boundary before using a catalog. */
export function isMessageCatalog(value: unknown): value is MessageCatalog {
  return isRecord(value) && Object.values(value).every(entry =>
    isRecord(entry) && typeof entry.message === 'string'
    && (entry.placeholders === undefined || (isRecord(entry.placeholders)
      && Object.values(entry.placeholders).every(p => isRecord(p) && typeof p.content === 'string'))));
}

/** Expand named placeholders once, as Chrome does when loading messages.json. */
export function compileCatalog(catalog: MessageCatalog): ReadonlyMap<string, string> {
  return new Map(Object.entries(catalog).map(([key, entry]) => {
    const placeholders = new Map(Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content]));
    return [key.toLowerCase(), entry.message.replace(/\$([a-z0-9_]+)\$/gi,
      (token, name: string) => placeholders.get(name.toLowerCase()) ?? token)];
  }));
}

/** Single-pass positional expansion; inserted values must never be expanded again. */
export function substituteMessage(message: string, substitutions?: string | string[]): string {
  const values = typeof substitutions === 'string' ? [substitutions] : substitutions ?? [];
  if (values.length > 9) return '';
  // Chrome consumes a run of dollar signs as one escape plus literal dollars.
  return message.replace(/\${2,}|\$([1-9])|\$[^$]|\$$/g, (token, position: string | undefined) => {
    if (token.startsWith('$$')) return token.slice(1);
    return position ? values[Number(position) - 1] ?? '' : '';
  });
}
