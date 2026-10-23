import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { LANGUAGES } from './language';
import { translationIssueUrl } from './translation-issue';

const params = (url: string) => new URL(url).searchParams;

it('pre-fills the template, language name and version', () => {
  const url = translationIssueUrl('pl', '1.4.0');
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues/new');
  assert.equal(params(url).get('template'), 'translation-issue.yml');
  assert.equal(params(url).get('language'), 'Polski');
  assert.equal(params(url).get('version'), '1.4.0');
});

it('maps browser locale spellings to supported languages', () => {
  assert.equal(params(translationIssueUrl('en-GB', '1')).get('language'), 'English (UK)');
  assert.equal(params(translationIssueUrl('pt_BR', '1')).get('language'), 'Português (Brasil)');
  assert.equal(params(translationIssueUrl('pt-BR', '1')).get('language'), 'Português (Brasil)');
  assert.equal(params(translationIssueUrl('zh-CN', '1')).get('language'), '简体中文');
  assert.equal(params(translationIssueUrl('de_AT', '1')).get('language'), 'Deutsch');
});

it('omits the language for unsupported locales instead of sending an invalid option', () => {
  assert.equal(params(translationIssueUrl('sv', '1')).has('language'), false);
  assert.equal(params(translationIssueUrl('', '1')).has('language'), false);
});

it('the issue form offers exactly the supported languages', () => {
  const form = readFileSync(path.resolve(__dirname, '../.github/ISSUE_TEMPLATE/translation-issue.yml'), 'utf8');
  const block = form.split('id: language')[1].split(/\n {2}- type:/)[0];
  const options = [...block.matchAll(/^ {8}- (.+)$/gm)].map(match => match[1].trim().replace(/^"|"$/g, ''));
  assert.deepEqual(options, LANGUAGES.map(({ name }) => name));
});
