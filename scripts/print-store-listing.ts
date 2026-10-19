import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHROME_LIMITS = { name: 75, short: 132, long: 16000 } as const;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeRoot = path.join(root, 'store-listings', 'chrome');

export type ChromeListing = { name: string; short: string; long: string };

/** Name and short description are the manifest locale messages; only the long description is a listing file. */
export function readChromeListing(locale: string, baseDir = root): ChromeListing {
  const messages: Record<string, { message?: string }> = JSON.parse(
    readFileSync(path.join(baseDir, '_locales', locale, 'messages.json'), 'utf8')
  );
  const name = messages.extensionName?.message;
  const short = messages.extensionDescription?.message;
  if (!name || !short) throw new Error(`${locale}: missing extensionName or extensionDescription`);
  const long = readFileSync(path.join(baseDir, 'store-listings', 'chrome', `${locale}.txt`), 'utf8').trim();
  return { name, short, long };
}

export function formatChromeListing(locale: string, listing: ChromeListing): string {
  const section = (title: string, text: string, limit: number) =>
    `### ${title} (${text.length}/${limit})\n${text}\n`;
  return [
    `===== ${locale} =====\n`,
    section('Name', listing.name, CHROME_LIMITS.name),
    section('Short description', listing.short, CHROME_LIMITS.short),
    section('Long description', listing.long, CHROME_LIMITS.long)
  ].join('\n');
}

function main(args: string[]): void {
  const available = readdirSync(chromeRoot).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
  const requested = args.includes('--all') ? available : args.filter((a) => !a.startsWith('-'));
  if (requested.length === 0) {
    console.error(`Usage: pnpm store:chrome:print -- <locale>... | --all\nLocales: ${available.join(' ')}`);
    process.exit(1);
  }
  for (const locale of requested) {
    if (!available.includes(locale)) throw new Error(`Unknown locale ${locale}`);
    console.log(formatChromeListing(locale, readChromeListing(locale)));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
