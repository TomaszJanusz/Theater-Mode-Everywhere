import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AmoListing = {
  summary: string;
  description: string;
};

export type AmoListingPayload = {
  summary: Record<string, string>;
  description: Record<string, string>;
};

type CliOptions = {
  addonId: string;
  apiKey?: string;
  apiSecret?: string;
  apiRoot: string;
  listingsRoot: string;
  dryRun: boolean;
};

const DEFAULT_API_ROOT = 'https://addons.mozilla.org/api/v5';
const HTML_ENTITY_PATTERN = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/u;
const ANGLE_BRACKET_PATTERN = /[<>]/u;

export const AMO_LOCALE_SOURCES: Readonly<Record<string, readonly string[]>> = {
  en: ['en-US'],
  de: ['de'],
  es: ['es-AR', 'es-CL', 'es-ES', 'es-MX'],
  fr: ['fr'],
  it: ['it'],
  ja: ['ja'],
  ko: ['ko'],
  pl: ['pl'],
  pt_BR: ['pt-BR'],
  ru: ['ru'],
  uk: ['uk'],
  zh_CN: ['zh-CN'],
};

const HELP = `Update AMO listing translations from store-listings/amo/*.md.

Usage:
  pnpm store:amo:update -- --addon-id <id-or-slug> --api-key <issuer> --api-secret <secret>
  pnpm store:amo:update -- --addon-id <id-or-slug> --dry-run

Options:
  --addon-id <value>    AMO numeric ID, slug, or add-on GUID (AMO_ADDON_ID)
  --api-key <value>     AMO JWT issuer / API key (AMO_JWT_ISSUER)
  --api-secret <value>  AMO JWT secret (AMO_JWT_SECRET)
  --api-root <url>      API root (default: ${DEFAULT_API_ROOT})
  --listings-root <dir> Listing source directory (default: store-listings/amo)
  --dry-run             Print locale mapping and payload without contacting AMO
  --help                Show this help

The source ar.md is intentionally not uploaded because the current AMO listing
does not contain an Arabic locale. Suggested tags are not uploaded: AMO tags are
global rather than localized.
`;

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseCliOptions(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let addonId = env.AMO_ADDON_ID?.trim() || '';
  let apiKey = env.AMO_JWT_ISSUER?.trim();
  let apiSecret = env.AMO_JWT_SECRET?.trim();
  let apiRoot = env.AMO_API_ROOT?.trim() || DEFAULT_API_ROOT;
  let listingsRoot = path.resolve(env.AMO_LISTINGS_ROOT?.trim() || 'store-listings/amo');
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case '--':
        break;
      case '--addon-id':
        addonId = requiredValue(args, index, flag);
        index += 1;
        break;
      case '--api-key':
        apiKey = requiredValue(args, index, flag);
        index += 1;
        break;
      case '--api-secret':
        apiSecret = requiredValue(args, index, flag);
        index += 1;
        break;
      case '--api-root':
        apiRoot = requiredValue(args, index, flag);
        index += 1;
        break;
      case '--listings-root':
        listingsRoot = path.resolve(requiredValue(args, index, flag));
        index += 1;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        console.log(HELP);
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${flag}\n\n${HELP}`);
    }
  }

  if (!addonId) {
    throw new Error('Missing --addon-id or AMO_ADDON_ID.');
  }
  if (!dryRun && !apiKey) {
    throw new Error('Missing --api-key or AMO_JWT_ISSUER.');
  }
  if (!dryRun && !apiSecret) {
    throw new Error('Missing --api-secret or AMO_JWT_SECRET.');
  }

  return {
    addonId,
    apiKey,
    apiSecret,
    apiRoot: apiRoot.replace(/\/+$/, ''),
    listingsRoot,
    dryRun,
  };
}

function readSection(content: string, heading: string, nextHeading?: string): string {
  const startMarker = `## ${heading}\n`;
  const start = content.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Missing section: ${heading}`);
  }

  const valueStart = start + startMarker.length;
  const end = nextHeading ? content.indexOf(`\n## ${nextHeading}\n`, valueStart) : content.length;
  if (end === -1) {
    throw new Error(`Missing section after ${heading}: ${nextHeading}`);
  }

  const value = content.slice(valueStart, end).trim();
  if (!value) {
    throw new Error(`Section is empty: ${heading}`);
  }
  return value;
}

export function parseAmoListing(content: string): AmoListing {
  return {
    summary: readSection(content, 'Summary', 'Description'),
    description: readSection(content, 'Description', 'Suggested tags'),
  };
}

export function validateAmoPayload(payload: AmoListingPayload): void {
  for (const [field, translations] of Object.entries(payload)) {
    for (const [locale, value] of Object.entries(translations)) {
      if (HTML_ENTITY_PATTERN.test(value)) {
        throw new Error(`${field}.${locale} contains an HTML entity that AMO may display literally.`);
      }
      if (ANGLE_BRACKET_PATTERN.test(value)) {
        throw new Error(`${field}.${locale} contains an angle bracket that AMO may encode as an HTML entity.`);
      }
    }
  }
}

export function buildAmoPayload(listingsRoot: string): AmoListingPayload {
  const payload: AmoListingPayload = { summary: {}, description: {} };

  for (const [sourceLocale, amoLocales] of Object.entries(AMO_LOCALE_SOURCES)) {
    const sourcePath = path.join(listingsRoot, `${sourceLocale}.md`);
    const listing = parseAmoListing(readFileSync(sourcePath, 'utf8'));

    for (const amoLocale of amoLocales) {
      payload.summary[amoLocale] = listing.summary;
      payload.description[amoLocale] = listing.description;
    }
  }

  validateAmoPayload(payload);
  return payload;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAmoJwt(apiKey: string, apiSecret: string, now = Math.floor(Date.now() / 1000)): string {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: apiKey,
    jti: randomUUID(),
    iat: now,
    exp: now + 60,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac('sha256', apiSecret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeResponseBody(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}

export async function updateAmoListings(options: CliOptions): Promise<void> {
  const payload = buildAmoPayload(options.listingsRoot);
  const locales = Object.keys(payload.summary);

  console.log(`AMO add-on: ${options.addonId}`);
  console.log(`Locales (${locales.length}): ${locales.join(', ')}`);
  console.log('Locale fan-out: es.md to es-AR, es-CL, es-ES, es-MX');
  console.log('Skipped source: ar.md (not present in the current AMO listing)');

  if (options.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log('Dry run complete; AMO was not contacted.');
    return;
  }

  const endpoint = `${options.apiRoot}/addons/addon/${encodeURIComponent(options.addonId)}/`;
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `JWT ${createAmoJwt(options.apiKey!, options.apiSecret!)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await readResponse(response);

  if (!response.ok) {
    throw new Error(`AMO listing update failed (${response.status}): ${describeResponseBody(body)}`);
  }

  console.log(`Updated ${locales.length} AMO locales successfully (${response.status}).`);
}

async function main(): Promise<void> {
  await updateAmoListings(parseCliOptions(process.argv.slice(2)));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
