import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function decode(value) {
  return value.replace(/&(?:quot|apos|lt|gt|amp);/g, entity => ({
    '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&',
  })[entity]);
}

function attribute(tag, key) {
  const match = tag.match(new RegExp(`\\b${key}="([^"]*)"`));
  return match ? decode(match[1]) : '';
}

export function summarize(xmlFiles) {
  const tests = [];
  for (const xml of xmlFiles) {
    for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const [, attrs, body = ''] = match;
      const seconds = Number(attribute(attrs, 'time'));
      const failure = /<(?:failure|error)\b/.test(body);
      tests.push({
        name: attribute(attrs, 'name'),
        file: relative(process.cwd(), attribute(attrs, 'file')),
        seconds: Number.isFinite(seconds) ? seconds : 0,
        failure,
      });
    }
  }
  const row = test => `| ${[test.file, test.name].map(value => value.replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} | ${test.seconds.toFixed(3)} |\n`;
  let summary = `### Test timing report\n\n${tests.length} tests reported; ${tests.filter(test => test.failure).length} failed.\n\n`;
  if (tests.length === 0) return summary + 'No test results were produced. Check the test step if this lane was expected to run.\n';
  summary += '| File | Test | Seconds |\n| --- | --- | ---: |\n';
  summary += [...tests].sort((a, b) => b.seconds - a.seconds).slice(0, 15).map(row).join('');
  const failures = tests.filter(test => test.failure);
  if (failures.length) summary += `\n#### Failures\n\n| File | Test | Seconds |\n| --- | --- | ---: |\n${failures.map(row).join('')}`;
  return summary;
}

if (process.argv[1]?.endsWith('ci-test-summary.mjs')) {
  const directory = process.argv[2];
  const files = directory && existsSync(directory)
    ? readdirSync(directory).filter(file => file.endsWith('.xml')).map(file => readFileSync(join(directory, file), 'utf8'))
    : [];
  const summary = summarize(files);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
}
