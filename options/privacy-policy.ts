import policy from '../PRIVACY.md?raw';
import { openDialog } from '../src/dialog';
import { t } from '../src/i18n';
import { parseMarkdown, type Block, type Inline } from './markdown';

export const PRIVACY_POLICY_URL = 'https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/main/PRIVACY.md';

function renderInline(nodes: Inline[]): Node[] {
  return nodes.map((node): Node => {
    if (node.type === 'text') return document.createTextNode(node.text);
    if (node.type === 'code') {
      const code = document.createElement('code');
      code.textContent = node.text;
      return code;
    }
    const element = document.createElement(node.type === 'link' ? 'a' : node.type === 'strong' ? 'strong' : 'em');
    if (node.type === 'link') {
      element.setAttribute('href', node.href);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    element.append(...renderInline(node.children));
    return element;
  });
}

function renderBlock(block: Block): HTMLElement {
  if (block.type === 'list') {
    const ul = document.createElement('ul');
    for (const item of block.items) {
      const li = document.createElement('li');
      li.append(...renderInline(item));
      ul.append(li);
    }
    return ul;
  }
  // The dialog title is the page's h1, so document headings sit one level lower.
  const element = document.createElement(block.type === 'heading' ? `h${Math.min(block.level + 1, 6)}` : 'p');
  element.append(...renderInline(block.children));
  return element;
}

export function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(source)) fragment.append(renderBlock(block));
  return fragment;
}

function buildContent(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'privacy-policy';
  const article = document.createElement('div');
  article.className = 'privacy-policy-text';
  article.lang = 'en';
  article.tabIndex = 0;
  article.append(renderMarkdown(policy));
  // The document's own title (its h1, rendered as h2) repeats the dialog title.
  article.querySelector('h2')?.remove();
  const online = document.createElement('a');
  online.className = 'privacy-policy-online';
  online.href = PRIVACY_POLICY_URL;
  online.target = '_blank';
  online.rel = 'noopener noreferrer';
  online.textContent = t('privacyPolicyOpenOnline');
  root.append(article, online);
  return root;
}

/** Opens the bundled policy; the shared dialog returns focus to the trigger on close. */
export function openPrivacyPolicy(): void {
  void openDialog(() => ({
    title: t('privacyPolicy'),
    content: buildContent(),
    setup: (_overlay, dialog) => dialog.classList.add('te-dialog-privacy'),
    actions: { type: 'acknowledge', label: t('dialogClose') }
  }));
}
