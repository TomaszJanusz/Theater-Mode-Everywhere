import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

/** Services whose host knowledge belongs in a provider, never in shared code. */
export const SERVICES = [
  'youtube', 'soop', 'netflix', 'disney', 'twitch', 'bilibili', 'bilibiliIntl', 'crunchyroll', 'patreon', 'viki', 'iqiyi', 'tencent', 'vimeo',
] as const;
export type Service = (typeof SERVICES)[number];

/**
 * What a hit is. `hostCheck` is an `is<Service>Host` identifier; `serviceId` a string equal to a provider id;
 * `domain` a string or regex naming one of the service's domains; `identifier` any other identifier carrying the
 * service's name (selector constants, session types, branches); `file` a shared-code file named after the service.
 */
export const KINDS = ['hostCheck', 'serviceId', 'domain', 'identifier', 'file'] as const;
export type Kind = (typeof KINDS)[number];

/** service -> directory -> kind -> count; only non-zero counts are present. */
export type Inventory = Record<string, Record<string, Partial<Record<Kind, number>>>>;

const SHARED_ROOTS = ['ui', 'core', 'platform', 'chat', 'media-features', 'protocol', 'providers'];

/** Lower-case word sequences that name a service inside a camelCase, snake_case or kebab-case name. */
const NAME_WORDS: Record<Service, string[][]> = {
  youtube: [['youtube'], ['you', 'tube']],
  soop: [['soop']],
  netflix: [['netflix']],
  disney: [['disney']],
  twitch: [['twitch']],
  bilibili: [['bilibili']],
  bilibiliIntl: [['bilibili', 'intl'], ['bilibili', 'tv']],
  crunchyroll: [['crunchyroll']],
  patreon: [['patreon']],
  viki: [['viki']],
  iqiyi: [['iqiyi']],
  tencent: [['tencent'], ['wetv'], ['we', 'tv']],
  vimeo: [['vimeo']],
};

const SERVICE_IDS: Record<string, Service> = {
  ...Object.fromEntries(SERVICES.map(service => [service, service])),
  'bilibili-intl': 'bilibiliIntl',
};

/** Registrable domains (hosts match on the domain or any subdomain). CDNs count: they are host knowledge too. */
const DOMAINS: Record<Service, string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com'],
  soop: ['sooplive.com'],
  netflix: ['netflix.com', 'nflxvideo.net', 'nflximg.net'],
  disney: ['disneyplus.com', 'bamgrid.com', 'dssott.com', 'disney-plus.net'],
  twitch: ['twitch.tv', 'ttvnw.net', 'jtvnw.net'],
  bilibili: ['bilibili.com', 'hdslb.com', 'biliimg.com'],
  bilibiliIntl: ['bilibili.tv', 'bstarstatic.com'],
  crunchyroll: ['crunchyroll.com', 'crunchyrollcdn.com'],
  patreon: ['patreon.com'],
  viki: ['viki.com', 'viki.io'],
  iqiyi: ['iq.com', 'iqiyi.com'],
  tencent: ['v.qq.com', 'qq.com', 'wetv.vip', 'wetvinfo.com'],
  vimeo: ['vimeo.com', 'vimeocdn.com'],
};

const DOMAIN_PATTERNS = SERVICES.map(service => ({
  service,
  pattern: new RegExp(`(?<![a-z0-9-])(?:${DOMAINS[service].map(domain => domain.replaceAll('.', '\\.')).join('|')})(?![a-z0-9-])`, 'i'),
}));

const isTestOrGenerated = (path: string) => /\.(?:test|browser\.test|component\.test|stories|d)\.[cm]?tsx?$/.test(path) || path.startsWith('src/test-utils/');

/** Words of an identifier or file name: `isYouTubeHost` -> is, you, tube, host. */
export function wordsOf(name: string): string[] {
  return (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map(word => word.toLowerCase());
}

/** Services named by a word list. Longer names win at a position, so `bilibili intl` is not also `bilibili`. */
export function servicesInWords(words: string[]): Service[] {
  const found = new Set<Service>();
  for (let index = 0; index < words.length; index += 1) {
    let best: { service: Service; length: number } | undefined;
    for (const service of SERVICES) {
      for (const sequence of NAME_WORDS[service]) {
        if (sequence.length > (best?.length ?? 0) && sequence.every((word, offset) => words[index + offset] === word)) best = { service, length: sequence.length };
      }
    }
    if (best) {
      found.add(best.service);
      index += best.length - 1;
    }
  }
  return [...found];
}

/** Directory bucket of a shared-code file, or null when the file is outside the ratchet's scope. */
export function scopeOf(path: string): string | null {
  const [src, root, next, ...rest] = path.split('/');
  if (src !== 'src' || !root || !SHARED_ROOTS.includes(root) || isTestOrGenerated(path) || !/\.[cm]?tsx?$/.test(path)) return null;
  if (root !== 'providers') return `src/${root}`;
  if (rest.length === 0) return 'src/providers';
  // A provider directory belongs to that service; navigation/, timeline/ and native/ are shared.
  return servicesInWords(wordsOf(next)).length ? null : `src/providers/${next}`;
}

const hostCheckService = (name: string): Service | undefined => {
  const middle = /^is(.+)Host$/.exec(name)?.[1];
  return middle ? servicesInWords(wordsOf(middle))[0] : undefined;
};

const domainServices = (text: string): Service[] => DOMAIN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ service }) => service);

interface Hit { service: Service; kind: Kind }

function hitsOfNode(node: ts.Node): Hit[] {
  if (ts.isIdentifier(node)) {
    const check = hostCheckService(node.text);
    if (check) return [{ service: check, kind: 'hostCheck' }];
    return servicesInWords(wordsOf(node.text)).map(service => ({ service, kind: 'identifier' as const }));
  }
  const isImportPath = ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
  if (ts.isStringLiteralLike(node) && !isImportPath) {
    const id = SERVICE_IDS[node.text];
    const hits: Hit[] = id ? [{ service: id, kind: 'serviceId' }] : [];
    return [...hits, ...domainServices(node.text).map(service => ({ service, kind: 'domain' as const }))];
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return domainServices(node.text).map(service => ({ service, kind: 'domain' as const }));
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return domainServices(node.text.replaceAll('\\.', '.')).map(service => ({ service, kind: 'domain' as const }));
  }
  return [];
}

/** Hits in one source file. Comments are not AST nodes, so prose mentioning a service never counts. */
export function detect(path: string, source: string): Hit[] {
  const hits: Hit[] = [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    hits.push(...hitsOfNode(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  // A service-named file is service code sitting in shared space, whatever it contains.
  const relative = path.split('/').slice(2).join('/').replace(/\.[^/.]+$/, '');
  for (const service of servicesInWords(wordsOf(relative))) hits.push({ service, kind: 'file' });
  return hits;
}

export function inventory(files: Iterable<{ path: string; source: string }>): Inventory {
  const result: Inventory = {};
  for (const { path, source } of files) {
    const dir = scopeOf(path);
    if (!dir) continue;
    for (const { service, kind } of detect(path, source)) {
      const dirs = (result[service] ??= {});
      const counts = (dirs[dir] ??= {});
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return sortInventory(result);
}

export function sortInventory(value: Inventory): Inventory {
  const sorted: Inventory = {};
  for (const service of Object.keys(value).sort()) {
    sorted[service] = {};
    for (const dir of Object.keys(value[service]).sort()) {
      sorted[service][dir] = Object.fromEntries(KINDS.filter(kind => value[service][dir][kind]).map(kind => [kind, value[service][dir][kind]]));
    }
  }
  return sorted;
}

/** Every file under the shared roots, as repo-relative paths with forward slashes. */
export function sharedFiles(repoRoot = '.'): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (scopeOf(path)) found.push(path);
    }
  };
  for (const root of SHARED_ROOTS) walk(`src/${root}`);
  return found.sort();
}

export function currentInventory(repoRoot = '.'): Inventory {
  return inventory(sharedFiles(repoRoot).map(path => ({ path, source: readFileSync(join(repoRoot, path), 'utf8') })));
}
