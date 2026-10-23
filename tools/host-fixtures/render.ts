import type { FixtureNode, HostFixture } from './format';

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'track', 'wbr']);
const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Markup of one recorded element. Recorded layout is inline, so no host stylesheet is needed. */
export function fixtureMarkup(node: FixtureNode): string {
  const attrs = Object.entries(node.attrs ?? {}).map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  const style = node.style ? ` style="${escapeAttribute(node.style)}"` : '';
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}${style}>`;
  return `<${node.tag}${attrs}${style}>${(node.children ?? []).map(fixtureMarkup).join('')}</${node.tag}>`;
}

/**
 * A standalone document for `page.setContent` at the recorded viewport. The reset keeps the
 * recorded border-box sizes authoritative: no margins, padding or flex shrinking of their own.
 */
export function fixtureDocument(fixture: HostFixture): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border:0;flex:none;min-width:0;min-height:0}</style>'
    + `</head>${fixtureMarkup(fixture.dom)}</html>`;
}
